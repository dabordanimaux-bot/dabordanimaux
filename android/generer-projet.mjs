/* =====================================================================
   ANIMAUX D'ABORD — Génération du projet Android (Google Play)
   ---------------------------------------------------------------------
   L'application Android est une « Trusted Web Activity » (TWA) : elle
   ouvre le site GitHub Pages en plein écran, dans le moteur de Chrome.
   Service worker, Firebase et notifications push fonctionnent donc
   exactement comme sur le site. C'est la méthode officielle de Google
   pour publier une PWA sur le Play Store (outil « Bubblewrap »).

   Ce script est lancé par le robot GitHub « Android — app Play Store »
   (.github/workflows/android-playstore.yml). Il lit le manifest du site
   en ligne et crée le projet dans android/build-android/.

   Réglages : android/config.json
     • packageId   : identifiant unique sur le Play Store.
                     ⚠️ NE PLUS JAMAIS LE CHANGER après la 1re publication.
     • siteUrl     : laisser vide → https://<compte>.github.io/<dépôt>/
                     (à remplir seulement avec un nom de domaine personnalisé)
   Le numéro de version augmente tout seul à chaque construction.
   ===================================================================== */
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TwaManifest, TwaGenerator, ConsoleLog } from "@bubblewrap/core";

const ici = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(ici, "config.json"), "utf8"));

// --- Adresse du site -------------------------------------------------
function adresseDuSite() {
  const forcee = (process.env.SITE_URL || config.siteUrl || "").trim();
  if (forcee) return forcee.endsWith("/") ? forcee : forcee + "/";
  const owner = (process.env.GITHUB_REPOSITORY_OWNER || "").toLowerCase();
  const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";
  if (!owner || !repo) {
    throw new Error("Adresse du site inconnue : remplir siteUrl dans android/config.json.");
  }
  // Dépôt « compte.github.io » = site à la racine du domaine.
  if (repo.toLowerCase() === owner + ".github.io") return `https://${owner}.github.io/`;
  return `https://${owner}.github.io/${repo}/`;
}

const site = adresseDuSite();
const manifestUrl = new URL("manifest.webmanifest", site).href;
const versionCode = Math.max(1, parseInt(process.env.VERSION_CODE || "1", 10));
const versionName = `${config.versionNameBase || "1.0"}.${versionCode}`;
console.log(`• Site            : ${site}`);
console.log(`• Manifest        : ${manifestUrl}`);
console.log(`• Package         : ${config.packageId}`);
console.log(`• Version         : ${versionName} (code ${versionCode})`);

// --- Manifest TWA construit à partir du manifest du site -------------
const twa = await TwaManifest.fromWebManifest(manifestUrl);
twa.packageId = config.packageId;
twa.name = config.appName || twa.name;
twa.launcherName = (config.launcherName || twa.launcherName).slice(0, 30);
twa.appVersionCode = versionCode;
twa.appVersionName = versionName;
twa.enableNotifications = true;          // les notifications push passent par l'app Android
twa.monochromeIconUrl = new URL("icon-monochrome-512.png", site).href;
twa.fallbackType = "customtabs";
twa.orientation = "portrait";
twa.minSdkVersion = 24;
twa.splashScreenFadeOutDuration = 300;
twa.navigationColor = twa.backgroundColor;   // barre de navigation crème (comme l'app)
twa.navigationDividerColor = twa.backgroundColor;
twa.signingKey = { path: "./upload.keystore", alias: "upload" };
twa.generatorApp = "animaux-dabord/generer-projet.mjs";

const erreur = twa.validate();
if (erreur) throw new Error("Manifest TWA invalide : " + erreur);

// --- Génération du projet Gradle --------------------------------------
const sortie = path.join(ici, "build-android");
await rm(sortie, { recursive: true, force: true });
await mkdir(sortie, { recursive: true });
await new TwaGenerator().createTwaProject(sortie, twa, new ConsoleLog("bubblewrap"));
await twa.saveToFile(path.join(sortie, "twa-manifest.json"));

// Informations reprises par le robot GitHub (nom des fichiers, résumé).
await writeFile(path.join(ici, "build-info.env"),
  `APP_HOST=${twa.host}\nAPP_START=${twa.startUrl}\nAPP_VERSION_NAME=${versionName}\nAPP_VERSION_CODE=${versionCode}\nAPP_PACKAGE=${config.packageId}\n`);
console.log(`✓ Projet Android créé dans android/build-android (hôte ${twa.host}, départ ${twa.startUrl})`);
