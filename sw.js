/* Klimm — Service Worker RAÍZ (repo klimm-mx.github.io)
 * Scope "/" => controla TODO el sitio: la app (hub), /solon/* y /luca/*.
 * Vive aparte: NO toca el código de solon ni de luca; solo los enlaza.
 *
 * REGLA DE ORO: nunca servir datos viejos.
 *   - El backend (otro origen, Render) pasa DIRECTO, jamás se cachea.
 *   - Cualquier página/herramienta (navegación) es RED-PRIMERO: siempre
 *     trae lo último. Así, cuando mejores una herramienta, se ve al instante
 *     sin trucos de caché. El caché solo entra si el iPhone está sin internet.
 *   - Solo el "cascarón" (hub, íconos, manifest) se guarda para abrir offline.
 *
 * Para publicar una versión nueva del SW: sube VERSION. Se activa solo al
 * volver a abrir la app (skipWaiting + clients.claim), sin quedar atorado.
 */
const VERSION = 'v3';
const CACHE = 'klimm-' + VERSION;
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/solon/panel_f1.html'   // el Agente: pre-guardado para que abra YA en celular
];

self.addEventListener('install', (event) => {
  // Guardar cada archivo por separado (allSettled): si uno falla, el resto igual
  // queda en caché (addAll es atómico y abortaría todo por un solo fallo).
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;             // no-GET pasa directo
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // backend/otros orígenes: directo

  // Navegación (abrir la app o cualquier herramienta): CACHÉ PRIMERO + refresco
  // en segundo plano (stale-while-revalidate). Abre AL INSTANTE aunque el celular
  // esté lento o sin señal; se actualiza sola por detrás para la próxima vez.
  // No muestra datos viejos: el HTML es el cascarón; los leads los pide el panel
  // en vivo con su propia llamada al backend.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      // Revalidación en segundo plano (no se espera si ya hay caché).
      const red = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      // Caché primero (instantáneo). Si no hay caché, esperar la red. Si tampoco,
      // caer al hub para no dejar pantalla en blanco.
      return cached
          || (await red)
          || (await cache.match('/index.html'))
          || (await cache.match('/'));
    })());
    return;
  }

  // Estáticos del cascarón (íconos, manifest): caché primero, red de respaldo.
  event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});

/* ===== Globo (badge) en el ícono =====
   Un contador guardado en IndexedDB (compartido con la página). Sube con cada
   lead y la página lo pone en 0 al abrir la app. Así, si el vendedor no oyó la
   notificación, el número queda pegado en el ícono hasta que entre a atender. */
function _idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('klimm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function _kvGet(k) {
  return _idb().then((db) => new Promise((res) => {
    const t = db.transaction('kv', 'readonly').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result || 0);
    t.onerror = () => res(0);
  }));
}
function _kvSet(k, v) {
  return _idb().then((db) => new Promise((res) => {
    const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    t.onsuccess = () => res();
    t.onerror = () => res();
  }));
}

/* ===== Notificaciones ===== */
// Se dispara cuando el backend envía un push (Paso 1B — VAPID).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data && event.data.text ? event.data.text() : '' }; }

  const title = data.title || 'Klimm · Agente';
  const options = {
    body: data.body || 'Nuevo lead sin atender',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'klimm-lead',
    renotify: true,
    data: { url: data.url || '/solon/panel_f1.html' } // al tocar, abre el Agente
  };

  event.waitUntil((async () => {
    // 1) Mostrar la notificación (sonido + pantalla bloqueada + centro de notis).
    await self.registration.showNotification(title, options);
    // 2) Subir el globo del ícono (persiste aunque no oiga la notificación).
    try {
      const n = (await _kvGet('badge')) + 1;
      await _kvSet('badge', n);
      if (self.navigator && self.navigator.setAppBadge) {
        await self.navigator.setAppBadge(n);
      }
    } catch (_) { /* si el badge no está soportado, la notificación igual salió */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/solon/panel_f1.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf('panel_f1.html') !== -1 && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
