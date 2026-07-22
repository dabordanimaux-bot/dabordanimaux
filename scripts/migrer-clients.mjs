/* =====================================================================
   migrer-clients.mjs  —  MIGRATION UNIQUE (à lancer UNE SEULE fois)
   ---------------------------------------------------------------------
   Objectif : faire passer les anciens comptes clients (qui avaient leur
   mot de passe en clair dans Firestore) vers Firebase Authentication,
   SANS rien perdre :
     • on réutilise l'ancien id comme identifiant Firebase (uid)
       -> toutes les données (animaux, RDV, questions...) restent liées ;
     • on garde le MÊME mot de passe -> le client se reconnecte comme avant ;
     • on retire le mot de passe du profil Firestore (fini l'exposition).

   Ce script ignore automatiquement :
     • le compte administrateur ;
     • les comptes déjà migrés (ceux qui n'ont plus de champ "password").

   Il est SANS DANGER à relancer : un compte déjà migré est simplement sauté.
   ===================================================================== */

import admin from "firebase-admin";
import { readFileSync } from "node:fs";

// --- 1) Clé de service : deux modes possibles ---
//    • GitHub Actions : lue depuis la variable secrète FIREBASE_SERVICE_ACCOUNT
//    • En local        : lue depuis le fichier serviceAccountKey.json (à côté de ce script)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("Clé de service : chargée depuis la variable d'environnement.");
} else {
  serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
  console.log("Clé de service : chargée depuis serviceAccountKey.json.");
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db   = admin.firestore();
const auth = admin.auth();

// --- 2) Même logique que credEmail() dans l'application ---
//    "+216 95 063 068", "95063068", "216 95063068"  ->  "95063068"
function phoneKey(s){ const d = String(s || "").replace(/\D/g, ""); return d.replace(/^216/, ""); }
function credEmail(tel){ const k = phoneKey(tel); return (k || "sans-numero") + "@dabordanimaux.app"; }

// --- Confidentialité des journaux ---
//    Ce script peut tourner dans GitHub Actions, dont les journaux sont
//    PUBLICS si le dépôt est public. On n'affiche donc jamais les noms ni
//    les numéros en clair : seulement un numéro d'ordre et un masque.
function masque(tel){
  const k = phoneKey(tel);
  return k ? ("*".repeat(Math.max(0, k.length - 2)) + k.slice(-2)) : "(sans numéro)";
}

// --- 3) Parcours de tous les profils ---
const snap = await db.collection("users").get();
let migres = 0, ignores = 0, erreurs = 0, n = 0;

console.log(`\n${snap.size} profil(s) trouvé(s) dans "users".\n`);

for (const docu of snap.docs) {
  const u = docu.data();
  const ancienId = docu.id;

  // On saute l'admin et les profils déjà migrés (sans mot de passe).
  if (u.role === "admin" || !u.password) { ignores++; continue; }

  n++;
  const etiquette = `Client ${n} (${masque(u.tel)})`;   // aucun nom, numéro masqué

  if (!u.tel) {
    console.log(`  !   ${etiquette} : pas de téléphone -> ignoré`);
    ignores++; continue;
  }

  const email = credEmail(u.tel);
  const motDePasse = String(u.password);

  if (motDePasse.length < 6) {
    console.log(`  !   ${etiquette} : mot de passe trop court pour Firebase (min 6) -> ignoré`);
    erreurs++; continue;
  }

  // (a) Créer le compte Firebase Auth en RÉUTILISANT l'ancien id comme uid.
  try {
    await auth.createUser({ uid: ancienId, email, password: motDePasse });
    console.log(`  OK  ${etiquette} : compte créé`);
  } catch (e) {
    if (e.code === "auth/uid-already-exists" || e.code === "auth/email-already-exists") {
      console.log(`  ->  ${etiquette} : compte déjà existant, profil mis à jour.`);
    } else {
      console.log(`  KO  ${etiquette} : ${e.code || e.message}`);
      erreurs++; continue;
    }
  }

  // (b) Réécrire le profil SANS mot de passe (même id, données conservées).
  await db.collection("users").doc(ancienId).set({
    id: ancienId,
    role: "client",
    tel: u.tel,
    nom: u.nom || "",
    createdAt: u.createdAt || Date.now()
  });

  migres++;
}

console.log(`\n----------------------------------------`);
console.log(`Terminé.  Migrés : ${migres}   |   Ignorés : ${ignores}   |   Erreurs : ${erreurs}`);
console.log(`----------------------------------------\n`);
process.exit(0);
