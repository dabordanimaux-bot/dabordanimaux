/* =====================================================================
   ANIMAUX D'ABORD — Envoi des rappels par notification push
   ---------------------------------------------------------------------
   Ce script tourne SUR UN SERVEUR (GitHub Actions, gratuit), jamais dans
   le navigateur : il utilise une clé de service qui ne doit JAMAIS être
   publiée dans l'application.

   Il envoie, pour chaque rendez-vous confirmé et chaque rappel de vaccin :
     • la veille (J-1)  → « Rendez-vous demain à 10:30 »
     • le jour même (J-0) → « Rendez-vous aujourd'hui à 10:30 »
   … au client concerné, et un récapitulatif quotidien au cabinet.

   Chaque rappel est mémorisé dans la collection « pushLog » : relancer le
   script dix fois dans la journée n'enverra jamais deux fois le même
   message. On peut donc le programmer plusieurs fois par jour sans risque.

   Lancement local :
     FIREBASE_SERVICE_ACCOUNT="$(cat cle.json)" node scripts/envoyer-rappels.mjs
   Test à blanc (n'envoie rien, affiche seulement) :
     DRY_RUN=1 node scripts/envoyer-rappels.mjs
   ===================================================================== */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

/* ---------------------------------------------------------------- */
/*  Réglages                                                         */
/* ---------------------------------------------------------------- */
const TZ       = "Africa/Tunis";   // fuseau du cabinet
const DRY_RUN  = process.env.DRY_RUN === "1";
// À mettre à "1" UNIQUEMENT si la Cloud Function optionnelle est déployée :
// elle se charge alors de l'envoi, ce script ne fait plus que créer les
// notifications dans l'app (sinon les rappels partiraient en double).
const SANS_PUSH = process.env.SANS_PUSH === "1";
const LOG_TTL_JOURS = 60;          // durée de vie des traces d'envoi

/* ---------------------------------------------------------------- */
/*  Connexion Firebase (clé de service)                              */
/* ---------------------------------------------------------------- */
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("✗ Variable FIREBASE_SERVICE_ACCOUNT absente.");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(raw)) });
const db  = getFirestore();
const fcm = getMessaging();

/* ---------------------------------------------------------------- */
/*  Dates au format YYYY-MM-DD, dans le fuseau de la Tunisie         */
/* ---------------------------------------------------------------- */
const isoDate = (d) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);                                   // "sv-SE" produit toujours 2026-07-18

const AUJOURD_HUI = isoDate(new Date());
const DEMAIN      = isoDate(new Date(Date.now() + 86400000));

console.log(`— Rappels du ${AUJOURD_HUI} (demain : ${DEMAIN}) — fuseau ${TZ}${DRY_RUN ? " — TEST À BLANC" : ""}`);

/* ---------------------------------------------------------------- */
/*  Lecture des données                                              */
/* ---------------------------------------------------------------- */
const docsOf = async (coll, champ, valeurs) => {
  const snap = await db.collection(coll).where(champ, "in", valeurs).get();
  return snap.docs.map((d) => d.data());
};

const settings  = (await db.collection("_config").doc("settings").get()).data()?.value || {};
const CABINET   = settings.clinicName || "le cabinet";

const rdvs    = await docsOf("rdv",     "date",     [AUJOURD_HUI, DEMAIN]);
const rappels = await docsOf("records", "nextDate", [AUJOURD_HUI, DEMAIN]);

// Les animaux servent à retrouver le propriétaire et le nom de l'animal.
const animaux = new Map();
if (rappels.length) {
  const snap = await db.collection("animals").get();
  snap.forEach((d) => animaux.set(String(d.id), d.data()));
}

console.log(`  ${rdvs.length} rendez-vous et ${rappels.length} rappel(s) de soin sur les 2 jours.`);

/* ---------------------------------------------------------------- */
/*  Construction de la liste des messages à envoyer                  */
/* ---------------------------------------------------------------- */
const jobs = [];   // { cle, cible, kind, titre, texte }

/* --- 1. Rendez-vous confirmés → le client --- */
for (const r of rdvs) {
  if (r.status !== "confirme" || !r.clientId) continue;
  if (r.date === DEMAIN)
    jobs.push({ cle: `rdv_j1_${r.id}`, cible: r.clientId, kind: "rdv",
                titre: "⏰ Rendez-vous demain",
                texte: `Demain à ${r.time} — ${CABINET}` });
  if (r.date === AUJOURD_HUI)
    jobs.push({ cle: `rdv_j0_${r.id}`, cible: r.clientId, kind: "rdv",
                titre: "📅 Rendez-vous aujourd'hui",
                texte: `Aujourd'hui à ${r.time} — ${CABINET}` });
}

/* --- 2. Rappels de vaccin / vermifuge → le propriétaire --- */
for (const rec of rappels) {
  const quand = rec.nextDate === DEMAIN ? "j1" : (rec.nextDate === AUJOURD_HUI ? "j0" : null);
  if (!quand) continue;
  const a = animaux.get(String(rec.animalId));
  if (!a || !a.ownerId) continue;
  const vaccin = rec.type === "vaccin";
  const emo    = vaccin ? "💉" : "🪱";
  jobs.push({
    cle: `vax_${quand}_${rec.id}`, cible: a.ownerId, kind: vaccin ? "vax" : "record",
    titre: quand === "j1" ? `${emo} Rappel demain pour ${a.nom}`
                          : `${emo} C'est aujourd'hui pour ${a.nom}`,
    texte: `${rec.titre || "Rappel de soin"} — prenez rendez-vous au ${CABINET}.`
  });
}

/* --- 3. Récapitulatif quotidien → le cabinet --- */
for (const [tag, jour, libelle] of [["j1", DEMAIN, "Demain"], ["j0", AUJOURD_HUI, "Aujourd'hui"]]) {
  const nbRdv = rdvs.filter((r) => r.date === jour && (r.status === "confirme" || r.status === "attente")).length;
  const nbVax = rappels.filter((r) => r.nextDate === jour).length;
  if (!nbRdv && !nbVax) continue;
  const parts = [];
  if (nbRdv) parts.push(`${nbRdv} rendez-vous`);
  if (nbVax) parts.push(`${nbVax} rappel${nbVax > 1 ? "s" : ""} de vaccin`);
  jobs.push({ cle: `adm_${tag}_${jour}`, cible: "admin", kind: "rdv",
              titre: `📋 ${libelle} au cabinet`, texte: parts.join(" · ") });
}

/* ---------------------------------------------------------------- */
/*  Jetons des appareils                                             */
/* ---------------------------------------------------------------- */
const cacheJetons = new Map();
async function jetonsDe(cible) {
  if (cacheJetons.has(cible)) return cacheJetons.get(cible);
  const q = cible === "admin"
    ? db.collection("pushTokens").where("role", "==", "admin")
    : db.collection("pushTokens").where("userId", "==", cible);
  const snap = await q.get();
  const liste = snap.docs
    .map((d) => ({ docId: d.id, token: d.data().token }))
    .filter((x) => !!x.token);
  cacheJetons.set(cible, liste);
  return liste;
}

/* ---------------------------------------------------------------- */
/*  Envoi                                                            */
/* ---------------------------------------------------------------- */
let envoyes = 0, ignores = 0, sansAppareil = 0, jetonsSupprimes = 0;

for (const job of jobs) {
  const refLog = db.collection("pushLog").doc(job.cle);

  // Déjà traité lors d'une exécution précédente ? on passe.
  if ((await refLog.get()).exists) { ignores++; continue; }

  // 1) Notification dans l'app (la cloche 🔔), même identifiant que côté
  //    navigateur pour ne jamais créer de doublon.
  //    « pushed » indique à la Cloud Function optionnelle de ne pas la
  //    renvoyer une seconde fois.
  const notif = {
    id: "n_" + job.cle, target: job.cible, kind: job.kind,
    title: job.titre, body: job.texte, ts: Date.now(), lu: false,
    pushed: !SANS_PUSH
  };

  // 2) Notification sur le téléphone
  const appareils = SANS_PUSH ? [] : await jetonsDe(job.cible);
  if (!appareils.length && !SANS_PUSH) sansAppareil++;

  if (DRY_RUN) {
    console.log(`  [test] ${job.cible} ← ${job.titre} | ${job.texte} (${appareils.length} appareil(s))`);
    continue;
  }

  await db.collection("notifs").doc(notif.id).set(notif, { merge: true });

  if (appareils.length) {
    // Message « data-only » : c'est le service worker qui compose l'affichage.
    const message = {
      data: {
        title: job.titre, body: job.texte, kind: job.kind,
        id: job.cle, tag: job.cle, url: "./index.html", lang: "fr"
      },
      webpush: { headers: { TTL: "86400", Urgency: "high" } }
    };

    for (let i = 0; i < appareils.length; i += 500) {
      const lot = appareils.slice(i, i + 500);
      const res = await fcm.sendEachForMulticast({ ...message, tokens: lot.map((x) => x.token) });
      envoyes += res.successCount;

      // Ménage : on retire les appareils dont le jeton n'est plus valable
      // (app désinstallée, navigateur réinitialisé…).
      await Promise.all(res.responses.map(async (r, k) => {
        if (r.success) return;
        const code = r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          await db.collection("pushTokens").doc(lot[k].docId).delete().catch(() => {});
          jetonsSupprimes++;
        } else {
          console.warn("    ! échec envoi :", code);
        }
      }));
    }
  }

  // 3) Trace anti-doublon (supprimée automatiquement si la règle TTL est active)
  await refLog.set({
    cle: job.cle, cible: job.cible, titre: job.titre,
    envoyeLe: FieldValue.serverTimestamp(),
    expireAt: new Date(Date.now() + LOG_TTL_JOURS * 86400000)
  });
}

console.log(`✓ Terminé — ${envoyes} notification(s) envoyée(s), ${ignores} déjà traitée(s), ` +
            `${sansAppareil} destinataire(s) sans appareil enregistré, ${jetonsSupprimes} jeton(s) obsolète(s) nettoyé(s).`);
