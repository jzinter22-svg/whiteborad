// Service Worker: يخزّن هيكل التطبيق للعمل دون اتصال.
// ملاحظة: التعرّف السحابي على الكتابة (إن فُعّل لاحقًا) لن يعمل دون اتصال.
const VERSION = 'v1';
const CACHE = `mw-shell-${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/board.js', 'js/model.js', 'js/store.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'fonts/noto-naskh-arabic-arabic-400-normal.woff2', 'fonts/noto-naskh-arabic-arabic-700-normal.woff2',
  'fonts/noto-naskh-arabic-latin-400-normal.woff2', 'fonts/noto-naskh-arabic-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mw-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// الشبكة أولًا مع الرجوع للكاش: يحصل المطوّر على آخر نسخة، ويعمل التطبيق دون اتصال.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
