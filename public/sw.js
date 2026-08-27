const CACHE_VERSION = 'v2.0.0';
const CACHE_NAME = `timetable-manager-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames.map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  if (/\.(png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});

// ── 웹 푸시 ──
// FCM은 data-only로 보내고 여기서 직접 표시한다.
// ponytail: SW에 firebase SDK를 importScripts 하지 않으려는 것. notification 블록이 섞여 와도 읽도록 둘 다 본다.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const d = payload.data || payload.notification || payload;
  event.waitUntil(
    self.registration.showNotification(d.title || '근력학교', {
      body: d.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: d.tag || 'default',
      data: { url: d.url || './' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = new URL(event.notification.data?.url || './', scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(scope));
      if (!open) return self.clients.openWindow(target);
      // focus()는 이미 떠 있는 화면을 그대로 두므로, 어디로 갈지는 메시지로 알려준다
      const postId = new URL(target).searchParams.get('post');
      const page = new URL(target).searchParams.get('page');
      open.postMessage({ type: 'notificationClick', postId, page });
      return open.focus();
    })
  );
});
