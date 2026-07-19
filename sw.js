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
const CACHE_VERSION = "animaux-dabord-v12";
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

/* =====================================================================
   NOTIFICATIONS PUSH (Firebase Cloud Messaging)
   ---------------------------------------------------------------------
   Ce service worker sert AUSSI de récepteur push. Il est transmis à
   getToken({ serviceWorkerRegistration }) depuis la page : on n'utilise
   donc PAS le fichier « firebase-messaging-sw.js » par défaut de Firebase,
   qui doit obligatoirement vivre à la racine du domaine — impossible sur
   GitHub Pages quand le site est dans un sous-dossier.

   Le serveur envoie des messages « data-only » : c'est ce code qui décide
   du titre, du texte, de l'icône et de l'action au clic.
   ===================================================================== */
const PUSH_ICON  = "./icon-192.png";
const PUSH_BADGE = "./icon-192.png";

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (e) { try { payload = { data: { body: event.data.text() } }; } catch (_) {} }

  const d = payload.data || {};
  const n = payload.notification || {};   // filet de sécurité si un message « notification » est envoyé
  const title = d.title || n.title || "Animaux d'abord";
  const body  = d.body  || n.body  || "";
  const kind  = d.kind  || "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body:  body,
      icon:  PUSH_ICON,
      badge: PUSH_BADGE,
      tag:   d.tag || ("ad-" + (d.id || kind || Date.now())),
      renotify: true,
      dir:  "auto",
      lang: d.lang || "fr",
      vibrate: [80, 40, 80],
      requireInteraction: d.urgent === "1",
      data: { url: d.url || "./index.html", kind: kind, id: d.id || "" }
    })
  );
});

// Clic sur la notification : on ouvre l'app (ou on remet au premier plan
// l'onglet déjà ouvert) et on demande à l'app d'aller sur le bon écran.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const target = new URL(info.url || "./index.html", self.location.href).href;

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        try { c.postMessage({ type: "notif-click", kind: info.kind || "", id: info.id || "" }); } catch (e) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
