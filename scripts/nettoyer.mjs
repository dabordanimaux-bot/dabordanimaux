/* =====================================================================
   ANIMAUX D'ABORD — Nettoyage horaire de la base (v1.3.2)
   ---------------------------------------------------------------------
   Lancé chaque heure par GitHub Actions (.github/workflows/nettoyage.yml),
   avec la même clé de service que le robot des rappels.

   1) Stories arrivées au bout de leurs 24 h : effacées de Firebase avec
      leurs vues et réactions (sous-collection « vues »).
   2) Comptes supprimés par la vétérinaire (collection « comptesSupprimes ») :
      l'accès e-mail + mot de passe est effacé de Firebase Authentication.
      Ensuite, l'ancien client voit « Identifiant ou mot de passe incorrect ».
      La marque est gardée 30 jours puis effacée.

   Test à blanc (n'efface rien, affiche seulement) :
     DRY_RUN=1 FIREBASE_SERVICE_ACCOUNT="$(cat cle.json)" node scripts/nettoyer.mjs
   ===================================================================== */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const DRY_RUN = process.env.DRY_RUN === "1";
const MARQUE_JOURS = 30;

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("✗ Variable FIREBASE_SERVICE_ACCOUNT absente.");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const auth = getAuth();
const maintenant = Date.now();
let erreurs = 0;

/* 1) Stories expirées (+ vues et réactions) ------------------------- */
let nStories = 0;
try {
  const expirees = await db.collection("stories").where("expiresAt", "<=", maintenant).get();
  for (const d of expirees.docs) {
    if (DRY_RUN) { console.log(`  [test] story ${d.id} à effacer (avec ses vues)`); nStories++; continue; }
    try { await db.recursiveDelete(d.ref); nStories++; }
    catch (e) { erreurs++; console.warn(`! story ${d.id} :`, e && e.message ? e.message : e); }
  }
} catch (e) { erreurs++; console.warn("! stories :", e && e.message ? e.message : e); }

/* 2) Accès des comptes supprimés par la vétérinaire ----------------- */
let nAcces = 0, nMarques = 0;
try {
  const marques = await db.collection("comptesSupprimes").get();
  for (const d of marques.docs) {
    const m = d.data() || {}, uid = d.id;
    if (!m.authOk) {
      // Sécurité : on ne touche jamais au compte de la vétérinaire.
      const prof = await db.collection("users").doc(uid).get();
      if (prof.exists && prof.data().role === "admin") { console.warn(`! ${uid} est administrateur : ignoré`); continue; }
      if (DRY_RUN) { console.log(`  [test] accès ${uid} à effacer`); nAcces++; continue; }
      try { await auth.deleteUser(uid); nAcces++; }
      catch (e) {
        if (!(e && e.code === "auth/user-not-found")) { erreurs++; console.warn(`! accès ${uid} :`, e && e.message ? e.message : e); continue; }
      }
      await d.ref.set({ authOk: true, authTs: maintenant }, { merge: true });
    } else if ((+m.ts || 0) < maintenant - MARQUE_JOURS * 86400000) {
      if (DRY_RUN) { console.log(`  [test] marque ${uid} à effacer`); nMarques++; continue; }
      await d.ref.delete(); nMarques++;
    }
  }
} catch (e) { erreurs++; console.warn("! comptes supprimés :", e && e.message ? e.message : e); }

console.log(`✓ Nettoyage — ${nStories} story(s) expirée(s) effacée(s) avec leurs vues, ` +
            `${nAcces} accès de compte(s) supprimé(s) effacé(s), ${nMarques} ancienne(s) marque(s) retirée(s).` +
            (erreurs ? ` ${erreurs} erreur(s).` : ""));
