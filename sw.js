// Service worker: cho phép cài app, mở nhanh, và mở hồ sơ khi bấm thông báo nhắc lịch.
const VERSION = 'giano-cskh-v1';
const SHELL = [
  './', 'index.html', 'share.html', 'config.js', 'css/app.css', 'js/app.js', 'js/store.js', 'js/util.js',
  'vendor/supabase-2.45.4.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Chỉ xử lý file của chính app; dữ liệu khách (Supabase) luôn đi thẳng lên cloud, không lưu cache.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Mạng trước, mất mạng thì dùng bản đã lưu → luôn có bản mới nhất khi có 4G/5G.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
