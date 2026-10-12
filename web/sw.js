// عامل خدمة بسيط لدعم الاتصال الضعيف: يحفظ ملفات الواجهة فقط، ولا يحفظ بيانات الطالبات.
const CACHE = 'tasmiyati-%VERSION%';
const ASSETS = %ASSETS%;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  // الصفحة: الشبكة أولًا، ثم النسخة المحفوظة عند انقطاع الاتصال
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return r; })
    .catch(() => caches.match('/')));
});
