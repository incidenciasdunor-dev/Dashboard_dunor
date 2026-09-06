self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
  );
  return self.clients.claim();
});

self.addEventListener('fetch', () => {
  // Pass through directly to network
});

// Handle clicking on system notification in mobile status bar or desktop notification center
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a tab is already open, focus it
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            if ('navigate' in client && targetUrl !== '/') {
              client.navigate(targetUrl);
            }
            return;
          }
        }
      }
      // If not open, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle push notifications if push manager is triggered
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'DASHBOARD DUNOR';
    const options = {
      body: data.body || data.message || 'Nueva notificación del sistema',
      icon: data.icon || '/logo_dunor.png',
      badge: data.badge || '/logo_dunor.png',
      tag: data.tag || 'dunor-notification',
      vibrate: [200, 100, 200],
      data: data.data || { url: '/' },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('DASHBOARD DUNOR', {
        body: text,
        icon: '/logo_dunor.png',
        badge: '/logo_dunor.png',
        vibrate: [200, 100, 200]
      })
    );
  }
});
