/* =====================================================================
   ANIMAUX D'ABORD — Robot des notifications push (v1.3.8)
   ---------------------------------------------------------------------
   Ce script tourne SUR UN SERVEUR (GitHub Actions, gratuit), jamais dans
   le navigateur : il utilise une clé de service qui ne doit JAMAIS être
   publiée dans l'application.

   v1.3.8 — réveillé toutes les 5 minutes par cron-job.org (gratuit), qui
   appelle GitHub avec le mode « auto ». La programmation de GitHub reste en
   secours (GitHub la retarde souvent de plusieurs heures, voire la saute).
   Trois façons de le lancer :
     • réveil cron-job.org (mode « auto »)  → comme un lancement programmé ;
     • programmation GitHub (secours)        → idem ;
     • bouton « Run workflow » (mode « manuel », par défaut) → tout est
       envoyé tout de suite, rappels compris, + entretien.

   1) NOTIFICATIONS DE L'APP → TÉLÉPHONE
      Chaque notification créée dans l'app avec « pushed:false » est envoyée
      sur le téléphone du destinataire, puis marquée « pushed:true » :
        • client  : rendez-vous confirmé / refusé / annulé, commande mise à
                    jour, réponse du vétérinaire, nouveau conseil, carnet ;
        • cabinet : nouveau rendez-vous, nouvelle commande, question,
                    annulation, stock faible ;
        • « tous » : nouvelle astuce / actualité, nouvelle story (tous les
                    clients ; au plus une annonce de story toutes les 2 h —
                    v1.3.8 : les stories publiées pendant cette pause sont
                    gardées et annoncées ensemble dès la fin de la pause).
      Les réactions (j'aime, cœur…) restent dans la cloche de l'app.
      v1.3.8 : les notifications créées par une ANCIENNE version de l'app
      (sans le champ « pushed ») sont aussi envoyées, si elles ont moins de
      30 minutes.

   2) RAPPELS À HEURE FIXE (heure de Tunis)
        • la veille  : entre 18:00 et 22:00 → « Rendez-vous demain à 10:30 »
        • le jour J  : entre 07:30 et 12:00 → « Rendez-vous aujourd'hui… »
      + vaccins / vermifuges, et un récapitulatif pour le cabinet
        (v1.3.8 : « 2 rendez-vous confirmés · 1 demande à confirmer »).
      Lancement manuel (bouton « Run workflow ») : rappels envoyés tout de suite.

   3) ENTRETIEN DE LA BASE (toutes les 3 h)
      notifications de plus de 60 jours, traces d'envoi expirées, créneaux
      passés, stories expirées, remise en stock des commandes annulées.

   Chaque rappel est mémorisé dans « pushLog » : relancer le script ne
   renvoie jamais deux fois le même message.

   Lancement local :
     FIREBASE_SERVICE_ACCOUNT="$(cat cle.json)" node scripts/envoyer-rappels.mjs
   Test à blanc (n'envoie rien, n'écrit rien, affiche seulement) :
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
// v1.3.8 — origine du lancement :
//   • cron-job.org appelle GitHub avec le mode « auto » → lancement automatique ;
//   • bouton « Run workflow » (mode « manuel » par défaut) → rappels envoyés
//     tout de suite, sans attendre les heures d'envoi (ou FORCER=1 en local).
const EVENEMENT = process.env.GITHUB_EVENT_NAME || "";
const MODE      = String(process.env.MODE_LANCEMENT || "").trim().toLowerCase();
const MANUEL    = process.env.FORCER === "1" || (EVENEMENT === "workflow_dispatch" && MODE !== "auto");
const ORIGINE   = MANUEL ? "lancement manuel"
                : EVENEMENT === "workflow_dispatch" ? "réveil cron-job.org"
                : EVENEMENT === "schedule" ? "programmation GitHub (secours)"
                : "lancement local";
const LOG_TTL_JOURS     = 60;            // durée de vie des traces d'envoi
const FEN_VEILLE        = [18 * 60, 22 * 60];        // 18:00 → 22:00
const FEN_JOUR          = [7 * 60 + 30, 12 * 60];    // 07:30 → 12:00
const PERIME_MS         = 12 * 3600 * 1000;          // notification trop ancienne : on ne l'envoie plus
const RATTRAPAGE_MS     = 30 * 60 * 1000;            // v1.3.8 : ancienne version de l'app → 30 dernières minutes
const MAX_PAR_PERSONNE  = 3;                         // au-delà, un seul message résumé
const PAUSE_STORY_MS    = 2 * 3600 * 1000;           // au plus une annonce de story toutes les 2 h
const ENTRETIEN_MS      = 3 * 3600 * 1000;           // entretien toutes les 3 h

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
/*  Date et heure de Tunis                                           */
/* ---------------------------------------------------------------- */
const isoDate = (d) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);                                   // "sv-SE" produit toujours 2026-07-18
const hhmmTunis = (d) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d).replace(/^24:/, "00:");            // "07:35"
const enMinutes = (hhmm) => { const p = String(hhmm || "0:0").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); };

const MAINTENANT  = Date.now();
const AUJOURD_HUI = isoDate(new Date(MAINTENANT));
const DEMAIN      = isoDate(new Date(MAINTENANT + 86400000));
const HEURE       = hhmmTunis(new Date(MAINTENANT));
const MIN_TUNIS   = enMinutes(HEURE);
const dans = (f) => MIN_TUNIS >= f[0] && MIN_TUNIS < f[1];

console.log(`— Robot du ${AUJOURD_HUI} à ${HEURE} (Tunis) — ${ORIGINE}${DRY_RUN ? " — TEST À BLANC" : ""}`);

/* ---------------------------------------------------------------- */
/*  Textes en arabe (appareils réglés en arabe dans l'app)           */
/* ---------------------------------------------------------------- */
const TITRES_AR = {
  "Rendez-vous confirmé ✅": "تم تأكيد الموعد ✅",
  "Rendez-vous annulé": "تم إلغاء الموعد",
  "Rendez-vous refusé": "تم رفض الموعد",
  "Commande mise à jour": "تم تحديث طلبك",
  "💬 Réponse du vétérinaire": "💬 رد الطبيب البيطري",
  "💡 Nouveau conseil du vétérinaire": "💡 نصيحة جديدة من الطبيب البيطري",
  "💡 Nouvelle astuce du Dr. Asma": "💡 نصيحة جديدة من الدكتورة أسماء",
  "📰 Nouvelle actualité du cabinet": "📰 خبر جديد من العيادة",
  "📸 Nouvelle story du cabinet": "📸 قصة جديدة من العيادة",
  "⏰ Rendez-vous demain": "⏰ موعدك غدًا",
  "📅 Rendez-vous aujourd'hui": "📅 موعدك اليوم",
  "📋 Demain au cabinet": "📋 غدًا في العيادة",
  "📋 Aujourd'hui au cabinet": "📋 اليوم في العيادة",
};
const TEXTES_AR = {
  "Le Dr. Asma vous a répondu.": "الدكتورة أسماء ردّت عليك.",
  "Découvrez-la dans l'app 🐾": "اكتشفها في التطبيق 🐾",
};
const STATUTS_AR = [
  ["Prête à retirer", "جاهزة للاستلام"], ["En préparation", "قيد التحضير"],
  ["En attente", "في الانتظار"], ["Livrée", "تم التسليم"], ["Annulée", "ملغاة"],
];
function enArabe(titre, texte) {
  let t = TITRES_AR[titre] || titre;
  let b = TEXTES_AR[texte] || texte;
  STATUTS_AR.forEach(([fr, ar]) => { b = b.split(fr).join(ar); });
  b = b.replace(/^(\d+) nouvelles stories — découvrez-les dans l'app 🐾$/, "$1 قصص جديدة — اكتشفها في التطبيق 🐾")
       .replace(/ — et (\d+) autre\(s\) notification\(s\)$/, " — و$1 إشعارات أخرى")
       .replace(/ — et (\d+) autre\(s\) publication\(s\)$/, " — و$1 منشورات أخرى")
       // v1.3.8 : récapitulatif du cabinet
       // (le pluriel d'abord ; « é » n'est pas une lettre pour \b, d'où (?!s))
       .replace(/(\d+) rendez-vous confirmés/g, "$1 مواعيد تم تأكيدها")
       .replace(/(\d+) rendez-vous confirmé(?!s)/g, "$1 موعد تم تأكيده")
       .replace(/(\d+) demandes à confirmer/g, "$1 طلبات في انتظار التأكيد")
       .replace(/(\d+) demande à confirmer/g, "$1 طلب في انتظار التأكيد")
       .replace(/(\d+) rappels de vaccin/g, "$1 تذكيرات بموعد التلقيح")
       .replace(/(\d+) rappel de vaccin/g, "$1 تذكير بموعد التلقيح");
  return { titre: t, texte: b };
}

/* ---------------------------------------------------------------- */
/*  v1.3.8 — texte du récapitulatif du cabinet (identique à l'app)   */
/* ---------------------------------------------------------------- */
//   « 2 rendez-vous confirmés · 1 demande à confirmer · 1 rappel de vaccin »
function texteRecap(nbConf, nbAtt, nbVax) {
  const parts = [];
  if (nbConf) parts.push(`${nbConf} rendez-vous confirmé${nbConf > 1 ? "s" : ""}`);
  if (nbAtt)  parts.push(`${nbAtt} demande${nbAtt > 1 ? "s" : ""} à confirmer`);
  if (nbVax)  parts.push(`${nbVax} rappel${nbVax > 1 ? "s" : ""} de vaccin`);
  return parts.join(" · ");
}

/* ---------------------------------------------------------------- */
/*  Appareils (jetons) d'un destinataire                             */
/* ---------------------------------------------------------------- */
//   "admin" → les appareils du cabinet ; "tous" → tous les clients ;
//   sinon → les appareils du compte client.
const cacheJetons = new Map();
async function jetonsDe(cible) {
  if (cacheJetons.has(cible)) return cacheJetons.get(cible);
  const col = db.collection("pushTokens");
  const q = cible === "admin" ? col.where("role", "==", "admin")
          : cible === "tous"  ? col.where("role", "==", "client")
          : col.where("userId", "==", cible);
  const snap = await q.get();
  const liste = snap.docs
    .map((d) => ({ docId: d.id, token: d.data().token, lang: d.data().lang === "ar" ? "ar" : "fr" }))
    .filter((x) => !!x.token);
  cacheJetons.set(cible, liste);
  return liste;
}

/* ---------------------------------------------------------------- */
/*  Envoi d'un message à des appareils (par lots de 500)             */
/* ---------------------------------------------------------------- */
let envoyes = 0, sansAppareil = 0;
const jetonsSupprimes = new Set();

async function envoyer(appareils, { titre, texte, kind, cle, titreAr, texteAr }) {
  if (!appareils.length) { sansAppareil++; return 0; }
  if (DRY_RUN) {
    console.log(`  [test] → ${appareils.length} appareil(s) : ${titre} | ${texte}`);
    return appareils.length;
  }
  let ok = 0;
  for (const lang of ["fr", "ar"]) {
    const groupe = appareils.filter((a) => a.lang === lang);
    if (!groupe.length) continue;
    const auto = enArabe(titre, texte);
    const txt = lang === "ar" ? { titre: titreAr || auto.titre, texte: texteAr || auto.texte } : { titre, texte };
    // Message « data-only » : c'est le service worker qui compose l'affichage.
    const message = {
      data: {
        title: txt.titre, body: txt.texte, kind: kind || "",
        id: cle, tag: cle, url: "./index.html", lang
      },
      webpush: { headers: { TTL: "86400", Urgency: "high" } }
    };
    for (let i = 0; i < groupe.length; i += 500) {
      const lot = groupe.slice(i, i + 500);
      const res = await fcm.sendEachForMulticast({ ...message, tokens: lot.map((x) => x.token) });
      ok += res.successCount;
      // Ménage : on retire les appareils dont le jeton n'est plus valable
      // (app désinstallée, navigateur réinitialisé…).
      await Promise.all(res.responses.map(async (r, k) => {
        if (r.success) return;
        const code = r.error?.code || "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          await db.collection("pushTokens").doc(lot[k].docId).delete().catch(() => {});
          jetonsSupprimes.add(lot[k].docId);
        } else {
          console.warn("    ! échec envoi :", code);
        }
      }));
    }
  }
  envoyes += ok;
  return ok;
}

/* ================================================================ */
/*  1) NOTIFICATIONS DE L'APP EN ATTENTE → TÉLÉPHONE                 */
/* ================================================================ */
let nAttente = 0, nPerimees = 0, nGroupees = 0, nAnciennes = 0, nEnPause = 0, finPauseTxt = "";
try {
  const snap = await db.collection("notifs").where("pushed", "==", false).limit(300).get();
  const aTraiter = snap.docs.slice();

  // v1.3.8 — RATTRAPAGE : un téléphone ou un onglet resté sur une ancienne
  // version de l'app crée ses notifications SANS le champ « pushed ».
  // On les envoie aussi, si elles ont moins de 30 minutes (jamais de vieux
  // messages). Les « n_… » (rappels, réactions) restent exclues plus bas.
  try {
    const dejaVu = new Set(aTraiter.map((d) => d.id));
    const recentes = await db.collection("notifs").where("ts", ">=", MAINTENANT - RATTRAPAGE_MS).limit(500).get();
    for (const d of recentes.docs) {
      const n = d.data();
      if (!n || dejaVu.has(d.id) || Object.prototype.hasOwnProperty.call(n, "pushed")) continue;
      if (String(d.id).startsWith("n_")) continue;     // « une seule fois » : jamais envoyées ici
      aTraiter.push(d); nAnciennes++;
    }
  } catch (e) {
    console.warn("  ! rattrapage des anciennes versions impossible :", e && e.message ? e.message : e);
  }
  nAttente = aTraiter.length;

  // Regroupement par destinataire
  const parCible = new Map();
  const ignorees = [];
  for (const d of aTraiter) {
    const n = d.data();
    // Sécurité : les notifications « une seule fois » (rappels, réactions)
    // ont un identifiant « n_… » : jamais envoyées par cette partie.
    if (!n || !n.target || String(d.id).startsWith("n_")) { ignorees.push({ ref: d.ref }); continue; }
    const cible = String(n.target);
    if (!parCible.has(cible)) parCible.set(cible, []);
    parCible.get(cible).push({ ref: d.ref, id: d.id, ...n });
  }

  const marquer = async (liste) => {
    if (DRY_RUN) return;
    await Promise.all(liste.map((n) =>
      n.ref.update({ pushed: true, pushedAt: Date.now() }).catch(() => {})));   // supprimée entre-temps : on ignore
  };
  await marquer(ignorees);

  for (const [cible, liste] of parCible) {
    liste.sort((a, b) => (+a.ts || 0) - (+b.ts || 0));
    const fraiches = liste.filter((n) => MAINTENANT - (+n.ts || 0) <= PERIME_MS);
    nPerimees += liste.length - fraiches.length;
    const garder = new Set();   // v1.3.8 : stories gardées pendant la pause (non marquées)

    if (cible === "tous") {
      // Annonces à tous les clients, regroupées par type.
      for (const kind of [...new Set(fraiches.map((n) => n.kind || "post"))]) {
        const items = fraiches.filter((n) => (n.kind || "post") === kind);
        const dernier = items[items.length - 1];
        if (kind === "story") {
          const refPause = db.collection("pushLog").doc("pause_story");
          const pause = await refPause.get();
          const finPause = pause.exists ? (+pause.data().ts || 0) + PAUSE_STORY_MS : 0;
          if (MAINTENANT < finPause) {
            // v1.3.8 : pendant la pause, les stories ne sont plus perdues :
            // elles restent « à envoyer » et partent ensemble à la fin de la pause.
            items.forEach((n) => garder.add(n.id));
            nEnPause += items.length;
            finPauseTxt = hhmmTunis(new Date(finPause));
            continue;
          }
          await envoyer(await jetonsDe("tous"), {
            titre: dernier.title || "📸 Nouvelle story du cabinet",
            texte: items.length > 1 ? `${items.length} nouvelles stories — découvrez-les dans l'app 🐾` : (dernier.body || ""),
            kind: "story", cle: "diff_" + dernier.id
          });
          if (!DRY_RUN) await refPause.set({ ts: MAINTENANT, expireAt: new Date(MAINTENANT + 86400000) });
        } else {
          await envoyer(await jetonsDe("tous"), {
            titre: dernier.title || "💡 Nouvelle astuce du Dr. Asma",
            texte: items.length > 1 ? `${dernier.body || ""} — et ${items.length - 1} autre(s) publication(s)` : (dernier.body || ""),
            kind: "post", cle: "diff_" + dernier.id
          });
        }
        nGroupees += items.length - 1;
      }
    } else if (fraiches.length) {
      const appareils = await jetonsDe(cible);
      if (fraiches.length <= MAX_PAR_PERSONNE) {
        for (const n of fraiches)
          await envoyer(appareils, { titre: n.title || "Animaux d'abord", texte: n.body || "", kind: n.kind, cle: String(n.id) });
      } else {
        // Trop de notifications d'un coup : un seul message résumé.
        const dernier = fraiches[fraiches.length - 1];
        await envoyer(appareils, {
          titre: dernier.title || "Animaux d'abord",
          texte: `${dernier.body || ""} — et ${fraiches.length - 1} autre(s) notification(s)`,
          kind: dernier.kind, cle: String(dernier.id)
        });
        nGroupees += fraiches.length - 1;
      }
    }
    await marquer(liste.filter((n) => !garder.has(n.id)));
  }
  console.log(`✓ Notifications — ${nAttente} en attente (dont ${nAnciennes} d'une ancienne version de l'app), ` +
              `${nPerimees} trop ancienne(s) ignorée(s), ${nGroupees} regroupée(s).`);
  if (nEnPause)
    console.log(`• Stories — ${nEnPause} nouvelle(s) story(s) gardée(s) : pause de 2 h entre deux annonces, ` +
                `annonce prévue vers ${finPauseTxt}.`);
} catch (e) {
  console.warn("! Notifications interrompues :", e && e.message ? e.message : e);
}

/* ================================================================ */
/*  2) RAPPELS À HEURE FIXE                                          */
/* ================================================================ */
const veilleOk = MANUEL || dans(FEN_VEILLE);
const jourOk   = MANUEL || dans(FEN_JOUR);

if (veilleOk || jourOk) {
  try {
    const docsOf = async (coll, champ, valeurs) => {
      const s = await db.collection(coll).where(champ, "in", valeurs).get();
      return s.docs.map((d) => d.data());
    };
    const settings = (await db.collection("_config").doc("settings").get()).data()?.value || {};
    const CABINET  = settings.clinicName || "le cabinet";

    const dates   = [veilleOk ? DEMAIN : null, jourOk ? AUJOURD_HUI : null].filter(Boolean);
    const rdvs    = await docsOf("rdv",     "date",     dates);
    const rappels = await docsOf("records", "nextDate", dates);

    // Les animaux servent à retrouver le propriétaire et le nom de l'animal.
    const animaux = new Map();
    const idsAnimaux = [...new Set(rappels.map((r) => String(r.animalId || "")).filter(Boolean))];
    for (let i = 0; i < idsAnimaux.length; i += 100) {
      const refs = idsAnimaux.slice(i, i + 100).map((id) => db.collection("animals").doc(id));
      const docs = await db.getAll(...refs);
      docs.forEach((d) => { if (d.exists) animaux.set(String(d.id), d.data()); });
    }

    const jobs = [];   // { cle, cible, kind, titre, texte }

    /* --- Rendez-vous confirmés → le client --- */
    for (const r of rdvs) {
      if (r.status !== "confirme" || !r.clientId) continue;
      if (veilleOk && r.date === DEMAIN)
        jobs.push({ cle: `rdv_j1_${r.id}`, cible: r.clientId, kind: "rdv",
                    titre: "⏰ Rendez-vous demain", texte: `Demain à ${r.time} — ${CABINET}`,
                    texteAr: `غدًا على الساعة ${r.time} — ${CABINET}` });
      // Jour J : seulement si l'heure du rendez-vous n'est pas passée.
      if (jourOk && r.date === AUJOURD_HUI && enMinutes(r.time) > MIN_TUNIS)
        jobs.push({ cle: `rdv_j0_${r.id}`, cible: r.clientId, kind: "rdv",
                    titre: "📅 Rendez-vous aujourd'hui", texte: `Aujourd'hui à ${r.time} — ${CABINET}`,
                    texteAr: `اليوم على الساعة ${r.time} — ${CABINET}` });
    }

    /* --- Rappels de vaccin / vermifuge → le propriétaire --- */
    for (const rec of rappels) {
      const quand = rec.nextDate === DEMAIN && veilleOk ? "j1"
                  : (rec.nextDate === AUJOURD_HUI && jourOk ? "j0" : null);
      if (!quand) continue;
      const a = animaux.get(String(rec.animalId));
      if (!a || !a.ownerId) continue;
      const vaccin = rec.type === "vaccin";
      const emo    = vaccin ? "💉" : "🪱";
      jobs.push({
        cle: `vax_${quand}_${rec.id}`, cible: a.ownerId, kind: vaccin ? "vax" : "record",
        titre: quand === "j1" ? `${emo} Rappel demain pour ${a.nom}` : `${emo} C'est aujourd'hui pour ${a.nom}`,
        texte: `${rec.titre || "Rappel de soin"} — prenez rendez-vous au ${CABINET}.`,
        titreAr: quand === "j1" ? `${emo} تذكير غدًا لـ ${a.nom}` : `${emo} اليوم موعد ${a.nom}`
      });
    }

    /* --- Récapitulatif → le cabinet --- */
    for (const [tag, jour, libelle, ok] of [["j1", DEMAIN, "Demain", veilleOk], ["j0", AUJOURD_HUI, "Aujourd'hui", jourOk]]) {
      if (!ok) continue;
      // v1.3.8 : confirmés et demandes en attente comptés à part.
      const duJour = rdvs.filter((r) => r.date === jour);
      const texte  = texteRecap(duJour.filter((r) => r.status === "confirme").length,
                                duJour.filter((r) => r.status === "attente").length,
                                rappels.filter((r) => r.nextDate === jour).length);
      if (!texte) continue;
      jobs.push({ cle: `adm_${tag}_${jour}`, cible: "admin", kind: "rdv",
                  titre: `📋 ${libelle} au cabinet`, texte });
    }

    let deja = 0;
    for (const job of jobs) {
      const refLog = db.collection("pushLog").doc(job.cle);
      if ((await refLog.get()).exists) { deja++; continue; }   // déjà envoyé

      if (!DRY_RUN) {
        // Notification dans la cloche (même identifiant que celui créé par
        // l'app : jamais de doublon). Si elle existe déjà, on n'y touche pas
        // (sinon elle redeviendrait « non lue »).
        await db.collection("notifs").doc("n_" + job.cle).create({
          id: "n_" + job.cle, target: job.cible, kind: job.kind,
          title: job.titre, body: job.texte, ts: Date.now(), lu: false, pushed: true
        }).catch(() => {});
      }

      // Téléphone (texte arabe dédié pour les appareils réglés en arabe)
      await envoyer(await jetonsDe(job.cible), {
        titre: job.titre, texte: job.texte, kind: job.kind, cle: job.cle,
        titreAr: job.titreAr, texteAr: job.texteAr });

      if (!DRY_RUN) await refLog.set({
        cle: job.cle, cible: job.cible, titre: job.titre,
        envoyeLe: FieldValue.serverTimestamp(),
        expireAt: new Date(Date.now() + LOG_TTL_JOURS * 86400000)
      });
    }
    console.log(`✓ Rappels — ${rdvs.length} rendez-vous et ${rappels.length} rappel(s) de soin ; ` +
                `${jobs.length - deja} nouveau(x) rappel(s), ${deja} déjà envoyé(s).`);
  } catch (e) {
    console.warn("! Rappels interrompus :", e && e.message ? e.message : e);
  }
} else {
  console.log("• Rappels — hors des heures d'envoi (veille 18:00-22:00, jour J 07:30-12:00).");
}

console.log(`✓ Envoi — ${envoyes} notification(s) envoyée(s) sur les téléphones, ` +
            `${sansAppareil} destinataire(s) sans appareil enregistré, ${jetonsSupprimes.size} jeton(s) obsolète(s) nettoyé(s).`);

/* ================================================================ */
/*  3) ENTRETIEN DE LA BASE (toutes les 3 h)                         */
/* ================================================================ */
const NOTIFS_JOURS = 60;            // notifications plus anciennes : effacées

// Supprime par lots de 400 (une requête = au plus `max` documents par passage).
async function supprimer(requete, libelle, max = 2000) {
  let total = 0;
  while (total < max) {
    const snap = await requete.limit(400).get();
    if (snap.empty) break;
    if (DRY_RUN) { console.log(`  [test] ${snap.size} ${libelle} à supprimer`); return snap.size; }
    const lot = db.batch();
    snap.docs.forEach((d) => lot.delete(d.ref));
    await lot.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

try {
  const refEtat = db.collection("_robot").doc("etat");
  const etat = (await refEtat.get()).data() || {};
  if (!MANUEL && etat.entretienLe && MAINTENANT - etat.entretienLe < ENTRETIEN_MS) {
    console.log("• Entretien — déjà fait il y a moins de 3 h.");
  } else {
    const nNotifs   = await supprimer(db.collection("notifs").where("ts", "<", MAINTENANT - NOTIFS_JOURS * 86400000), "notification(s) ancienne(s)");
    const nLogs     = await supprimer(db.collection("pushLog").where("expireAt", "<", new Date()), "trace(s) d'envoi expirée(s)");
    const nCreneaux = await supprimer(db.collection("creneaux").where("date", "<", AUJOURD_HUI), "créneau(x) passé(s)");
    // Une story est effacée AVEC ses vues et réactions (sous-collection).
    let nStories = 0;
    for (const d of (await db.collection("stories").where("expiresAt", "<=", MAINTENANT).get()).docs) {
      if (DRY_RUN) { console.log(`  [test] story ${d.id} à effacer`); nStories++; continue; }
      await db.recursiveDelete(d.ref); nStories++;
    }

    // Commandes annulées dont le stock avait été déduit : on le remet (une seule fois).
    let nStock = 0;
    const annulees = await db.collection("orders").where("status", "==", "annulee").get();
    for (const d of annulees.docs) {
      const o = d.data();
      if (!o.stockDeduit || o.stockRendu) continue;
      if (DRY_RUN) { console.log(`  [test] remise en stock de la commande ${d.id}`); continue; }
      await db.runTransaction(async (tx) => {
        const frais = await tx.get(d.ref);
        if (!frais.exists || !frais.data().stockDeduit || frais.data().stockRendu) return;
        const lignes = (frais.data().items || []).filter((it) => it && it.id && +it.qty > 0);
        const prods = await Promise.all(lignes.map((it) => tx.get(db.collection("products").doc(String(it.id)))));
        prods.forEach((p, k) => {
          if (p.exists && p.data().stock != null) tx.update(p.ref, { stock: FieldValue.increment(Math.round(+lignes[k].qty) || 0) });
        });
        tx.update(d.ref, { stockRendu: true });
      });
      nStock++;
    }
    if (!DRY_RUN) await refEtat.set({ entretienLe: MAINTENANT }, { merge: true });
    console.log(`✓ Entretien — ${nNotifs} notification(s) > ${NOTIFS_JOURS} j, ${nLogs} trace(s) d'envoi, ` +
                `${nCreneaux} créneau(x) passé(s), ${nStories} story(s) expirée(s) supprimé(s) ; ${nStock} commande(s) remise(s) en stock.`);
  }
} catch (e) {
  // L'entretien ne doit jamais faire échouer l'envoi des notifications.
  console.warn("! Entretien interrompu :", e && e.message ? e.message : e);
}
