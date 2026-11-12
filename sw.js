// Service worker: gjør appen tilgjengelig offline og installerbar.
// Øk versjonen ved hver publisering for å tvinge oppdatering.
const VERSION = 'v1';
const CACHE = '3dkalk-' + VERSION;
const CORE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/app.js', './js/lib.js', './js/store.js', './js/calc.js', './js/util.js', './js/schema.js', './js/model.js',
  './js/components.js', './js/crud.js', './js/backup.js', './js/firebase-config.js',
  './js/pages/products.js', './js/pages/packages.js', './js/pages/inventory.js', './js/pages/scan.js',
  './js/pages/labels.js', './js/pages/misc.js',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdn.sheetjs.com', 'www.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('3dkalk-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Nettverk først (får alltid nyeste versjon), cache ved frakobling
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
  } else if (CDN_HOSTS.includes(url.hostname) && /\.(m?js|css)$/.test(url.pathname)) {
    // Versjonerte biblioteker: cache først
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
