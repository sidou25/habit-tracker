// Service worker : l'app s'ouvre même sans réseau (dernière version de la page gardée en cache).
// Les données (/api) ne passent jamais par le cache : elles viennent toujours du serveur.
const CACHE = 'habit-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// supprime les anciens caches quand une nouvelle version arrive
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// réseau d'abord (toujours la dernière version), le cache seulement hors ligne
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
        || (e.request.mode === 'navigate' ? caches.match('/') : Response.error())),
  );
});
