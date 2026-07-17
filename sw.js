/* =====================================================================
   Service Worker — Animaux d'abord (PWA)
   ---------------------------------------------------------------------
   • Rend l'application installable et utilisable HORS-LIGNE.
   • Navigation (page) : réseau d'abord, repli sur le cache (index.html).
   • Fichiers locaux (icônes, manifest) : cache d'abord + mise à jour en fond.
   • Requêtes externes (Firebase / Firestore, Google Fonts, CDN) : laissées
     au réseau, JAMAIS interceptées → la synchro cloud temps réel fonctionne.
   Pense à incrémenter CACHE_VERSION à chaque mise à jour du site.
   ===================================================================== */
const CACHE_VERSION = "animaux-dabord-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png",
  "./icon-maskable-512.png",
  "./logo-mark.png",
  "./pet-dog.png",
  "./pet-cat.png"
];

// Installation : pré-cache de la coquille de l'application.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {}) // si une ressource manque, on n'échoue pas l'installation
  );
});

// Activation : suppression des anciens caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // On ne gère que les requêtes GET de même origine.
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin) return; // Firebase, gstatic, Google Fonts, CDN → réseau direct

  // Navigation (ouverture de page) : réseau d'abord, repli hors-ligne.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Autres fichiers locaux : cache d'abord, puis mise à jour en arrière-plan.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
