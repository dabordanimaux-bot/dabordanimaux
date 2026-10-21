# Publier « Animaux d'abord » sur Google Play

Le Play Store n'accepte pas un zip de site web : il faut un fichier **.aab** (Android App Bundle).
Ce dossier le fabrique automatiquement sur GitHub, à partir du site en ligne.

L'application Android est une **Trusted Web Activity** (méthode officielle de Google pour les PWA) :
elle ouvre `https://COMPTE.github.io/dabordanimaux/` en plein écran, avec le moteur de Chrome.
Firebase, le mode hors-ligne et les notifications push marchent comme sur le site.
**Toute modification de `index.html` poussée sur GitHub apparaît tout de suite dans l'app Android**, sans nouvelle publication.

> Remplacez partout `COMPTE` par votre nom d'utilisateur GitHub (en minuscules).

---

## Ce qui a été modifié dans l'application (et pourquoi)

| Modification | Pourquoi |
|---|---|
| **Supprimer mon compte** dans l'app (À propos → Mon compte), avec confirmation par mot de passe | Obligatoire sur Google Play pour toute app où l'on crée un compte |
| Page `confidentialite.html` (FR + AR) | Une politique de confidentialité est obligatoire |
| Page `suppression-compte.html` (FR + AR) | Google demande une adresse web pour supprimer son compte sans l'app |
| Liens « Politique de confidentialité » sur l'écran de connexion et dans À propos | La politique doit être accessible depuis l'app |
| Icônes refaites (même logo) : icône adaptative Android, icône monochrome pour les notifications | Icône propre sur tous les téléphones |
| `manifest.webmanifest` (id + icône monochrome), `sw.js` (cache v17) | Lecture correcte par le générateur Android |
| `android/` + `.github/workflows/android-playstore.yml` | Fabrication automatique du .aab (cible Android 16 / API 36, exigée par Google depuis le 31 août 2026) |

Quand un client supprime son compte, le cabinet reçoit une notification 🗑️.
Si les règles de sécurité Firestore ont empêché d'effacer une partie des données, la notification
le dit : il suffit alors d'ouvrir **Patients → ce client → Supprimer le compte**.

---

## Étape 1 — Mettre à jour le dépôt `dabordanimaux`

1. Envoyez **tous** les fichiers de ce zip sur le dépôt (ils remplacent les anciens).
   ⚠️ N'oubliez pas les dossiers `.github` et `android`. Sur Mac, `.github` est caché dans le Finder (Cmd + Maj + . pour l'afficher).
2. Attendez 1 à 2 minutes (GitHub Pages), puis vérifiez que cette page s'ouvre :
   `https://COMPTE.github.io/dabordanimaux/confidentialite.html`

## Étape 2 — Ajouter les 2 secrets de signature (une seule fois)

Dépôt `dabordanimaux` → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom du secret | Valeur |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | tout le contenu du fichier `upload-keystore.base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | le mot de passe écrit dans `MOT-DE-PASSE.txt` |

Ces deux fichiers sont dans le zip séparé **cle-signature-android** : ne le mettez **jamais** sur GitHub,
et gardez-en une copie de sauvegarde (clé USB, Google Drive privé…).

## Étape 3 — Fabriquer le .aab

Onglet **Actions → « Android — app Play Store » → Run workflow**. Comptez 5 à 10 minutes.
En bas de la page de l'exécution, rubrique **Artifacts**, téléchargez **app-play-store** :

- `animaux-dabord-1.0.N.aab` → à envoyer sur le Play Store
- `animaux-dabord-1.0.N-test.apk` → à installer sur votre téléphone pour tester
- `assetlinks.json` → pour l'étape 4

Le numéro de version augmente tout seul à chaque exécution.

## Étape 4 — Relier le site à l'application (sinon une barre d'adresse s'affiche en haut)

Android vérifie que le site appartient bien à l'app grâce au fichier
`https://COMPTE.github.io/.well-known/assetlinks.json`. Il doit être **à la racine du domaine**,
donc dans un deuxième dépôt nommé exactement **`COMPTE.github.io`**.

- **Si ce dépôt n'existe pas** : créez-le (public), puis envoyez le contenu du zip **depot-racine-github-io**.
  Pour être sûr que les fichiers commençant par un point soient bien créés :
  **Add file → Create new file**, tapez le nom `.well-known/assetlinks.json` (le `/` crée le dossier),
  collez le contenu, validez. Faites pareil avec un fichier vide nommé `.nojekyll`.
- **Si ce dépôt existe déjà** (autre site) : ajoutez seulement `.well-known/assetlinks.json`.
  S'il n'a pas de fichier `.nojekyll`, ajoutez dans son `_config.yml` la ligne `include: [".well-known"]`.

Vérifiez que `https://COMPTE.github.io/.well-known/assetlinks.json` affiche le texte du fichier.
Installez ensuite l'APK de test : l'app doit s'ouvrir **en plein écran, sans barre d'adresse**.

## Étape 5 — Google Play Console

1. Compte développeur sur <https://play.google.com/console> (25 $ une seule fois, vérification d'identité).
   Choisissez qui publie : vous, ou le cabinet (compte « organisation », demande un numéro D-U-N-S).
2. **Créer une application** : nom « Animaux d'abord », langue Français, Application, Gratuite.
3. **Contenu de l'application** (menu « Règles et programmes ») :
   - Politique de confidentialité : `https://COMPTE.github.io/dabordanimaux/confidentialite.html`
   - Accès à l'application : « certaines fonctionnalités sont limitées » → créez dans l'app un compte client de test
     (numéro + mot de passe) et donnez-le à Google.
   - Annonces : non. Public cible : **18 ans et plus**.
   - Classification du contenu : remplissez le questionnaire (pas de violence, pas de contenu sensible).
   - Suppression de compte : `https://COMPTE.github.io/dabordanimaux/suppression-compte.html`
   - Sécurité des données : voir le tableau plus bas.
   - Applications de santé : l'app concerne la santé des **animaux** ; aucune fonctionnalité de santé humaine.
4. **Fiche Play Store** (textes plus bas) : icône `play-store-icon-512.png`, image `play-feature-graphic-1024x500.png`,
   et au moins 2 captures (`play-screen-*.png`, réalisées avec des données de démonstration).
5. **Tests → Test fermé** : créez une version, envoyez le `.aab`, acceptez la **signature des applications par Google Play**.
   Compte personnel créé après le 13/11/2023 : Google exige **12 testeurs inscrits pendant 14 jours d'affilée**
   avant de pouvoir demander l'accès à la **Production**.

## Étape 6 — Après le premier envoi : l'empreinte de Google (important)

Google re-signe l'app avec sa propre clé. Pour que la version installée depuis le Play Store s'ouvre sans barre d'adresse :

1. Play Console → **Tester et publier → Intégrité de l'application → Signature de l'application** :
   copiez l'empreinte **SHA-256** du « Certificat de la clé de signature d'application ».
2. Collez-la dans `android/config.json`, champ `"playAppSigningSha256"`, puis relancez le robot (étape 3).
3. Remplacez `.well-known/assetlinks.json` du dépôt `COMPTE.github.io` par le nouveau `assetlinks.json`
   (il contient alors les 2 empreintes).

---

## Sécurité des données — réponses à donner

- L'application collecte des données : **Oui**. Chiffrées pendant le transfert : **Oui**. Suppression possible : **Oui**.
- Données partagées avec des tiers : **Non** (Firebase et GitHub sont des prestataires, ce n'est pas du « partage »).

| Catégorie Google | Type | Obligatoire ? | Finalités |
|---|---|---|---|
| Informations personnelles | Nom | Oui | Fonctionnement de l'app, Gestion du compte |
| Informations personnelles | Numéro de téléphone | Oui | Fonctionnement de l'app, Gestion du compte |
| Informations personnelles | ID utilisateur | Oui | Gestion du compte |
| Photos et vidéos | Photos | Non (facultatif) | Fonctionnement de l'app |
| Messages | Autres messages dans l'application | Non | Fonctionnement de l'app |
| Activité dans l'application | Autre contenu généré par l'utilisateur (animaux, RDV, commandes) | Oui | Fonctionnement de l'app |
| Activité dans l'application | Interactions avec l'application | Oui | Analyse |
| Position | Position approximative (déduite par Google Analytics) | Oui | Analyse |
| Appareil ou autres identifiants | Identifiants d'appareil | Oui | Fonctionnement de l'app (notifications), Analyse |

---

## Textes de la fiche Play Store

**Titre (30 caractères max)** : `Animaux d'abord`

**Description courte (80 max)** :
`Carnet de santé, rendez-vous et boutique du Cabinet Vétérinaire de Manouba.`

**Description complète** :

```
Animaux d'abord est l'application du Cabinet Vétérinaire de Manouba (Dr. Asma Gnaoui).

🩺 Carnet de santé de vos animaux
Vaccins, consultations, ordonnances, analyses et pesées : tout l'historique de chaque animal, tenu à jour par la vétérinaire.

📅 Rendez-vous en ligne
Choisissez un créneau libre et recevez la confirmation directement sur votre téléphone.

🔔 Rappels automatiques
Vaccins, vermifuges et rendez-vous : une notification la veille et le jour même.

🛍️ Boutique du cabinet
Alimentation, hygiène, santé et accessoires sélectionnés par le Dr. Asma. Commandez et récupérez au cabinet.

💬 Questions et conseils
Posez vos questions à la vétérinaire et recevez des conseils personnalisés.

📍 Infos pratiques
Horaires, itinéraire, appel et WhatsApp en un geste. Urgences 24h/24, 7j/7.

L'application est disponible en français et en arabe.
```

**Arabe (traduction de la fiche, facultative)** — description courte :
`دفتر صحة حيوانك، المواعيد والمتجر — العيادة البيطرية بمنوبة.`

---

## Mises à jour futures

- **Modification du site** (`index.html`, etc.) : poussez sur GitHub, c'est tout. Pensez à augmenter `CACHE_VERSION` dans `sw.js`.
- **Nouveau .aab** seulement si vous changez le nom, les icônes ou la couleur, ou quand Google relève le niveau d'API exigé
  (chaque année fin août) : mettez à jour la version de `@bubblewrap/core` dans `android/package.json`, relancez le robot,
  envoyez le nouveau `.aab` dans Play Console.
- ⚠️ Ne changez **jamais** `packageId` (`tn.dabordanimaux.app`) après la première publication, et ne perdez pas la clé.
