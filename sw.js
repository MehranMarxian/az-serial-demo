// AZ SERIAL service worker: instant app-shell loads + offline-cached OCR/barcode engines.
// API calls always go to the network (data must be live and authoritative).
const VERSION = 'azs-v5';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/logo.svg',
  './js/theme-init.js', './js/app.js', './js/api.js', './js/i18n.js', './js/i18n-ar.js', './js/ui.js', './js/icons.js',
  './js/jalali.js', './js/components.js', './js/datepicker.js', './js/scanner.js', './js/demo-api.js',
  './js/views/auth.js', './js/views/register.js', './js/views/history.js', './js/views/admin.js', './js/views/my-activity.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'azs-vendor').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  // Large, immutable vendor files (OCR engine, fonts, ZXing): cache-first, kept across versions.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open('azs-vendor').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App shell: network-first so deployments show up immediately, cache as offline fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(async () => (await caches.match(e.request)) || caches.match('./index.html')));
});
