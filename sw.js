// AgendaMia Service Worker v1.0
// Gestisce notifiche locali programmate

const CACHE_NAME = 'agendamia-v1';
const ASSETS = ['./index.html', './manifest.json'];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS).catch(() => {}))
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch (cache-first per assets, network-first altrimenti) ─────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── Notifiche programmate ─────────────────────────────────────────────────────
// Struttura: Map<tag, timeoutId>
const timers = new Map();

function cancellaTimer(tag) {
  if (timers.has(tag)) {
    clearTimeout(timers.get(tag));
    timers.delete(tag);
  }
}

function programmaNotifica({ tag, title, body, timestamp }) {
  cancellaTimer(tag); // evita duplicati

  const delay = timestamp - Date.now();
  if (delay <= 0) return; // già passata

  const id = setTimeout(async () => {
    timers.delete(tag);
    try {
      await self.registration.showNotification(title, {
        body,
        tag,
        icon: './icons/icon-192.png',
        badge: './icons/icon-96.png',
        vibrate: [200, 100, 200],
        requireInteraction: false,
        data: { url: './' }
      });
    } catch (err) {
      // showNotification può fallire se il permesso è stato revocato
      console.warn('[SW] showNotification error:', err);
    }
  }, delay);

  timers.set(tag, id);
}

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  const msg = e.data;
  if (!msg || !msg.tipo) return;

  switch (msg.tipo) {
    // Rimpiazza TUTTE le notifiche programmate
    // Payload: { tipo: 'SCHEDULE_NOTIFICHE', notifiche: [ {tag, title, body, timestamp}, … ] }
    case 'SCHEDULE_NOTIFICHE': {
      // Cancella tutti i timer esistenti
      for (const [tag] of timers) cancellaTimer(tag);

      const lista = Array.isArray(msg.notifiche) ? msg.notifiche : [];
      lista.forEach(n => {
        if (n.tag && n.title && n.timestamp) programmaNotifica(n);
      });
      break;
    }

    // Cancella una singola notifica per tag
    // Payload: { tipo: 'CANCEL_NOTIFICA', tag: '...' }
    case 'CANCEL_NOTIFICA': {
      if (msg.tag) {
        cancellaTimer(msg.tag);
        self.registration.getNotifications({ tag: msg.tag })
          .then(ns => ns.forEach(n => n.close()));
      }
      break;
    }

    // Ping di debug
    case 'PING': {
      e.source && e.source.postMessage({ tipo: 'PONG', timers: [...timers.keys()] });
      break;
    }
  }
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Se c'è già una finestra aperta, portala in primo piano
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      // Altrimenti apri una nuova finestra
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
