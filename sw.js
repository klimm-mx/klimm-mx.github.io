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
const VERSION = 'v1';
const CACHE = 'klimm-' + VERSION;
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
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

  // Navegación (abrir la app o cualquier herramienta): RED PRIMERO.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Estáticos del cascarón (íconos, manifest): caché primero, red de respaldo.
  event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});

/* ===== Notificaciones ===== */
// Se dispara cuando el backend envía un push (Paso 1B — VAPID). Ya queda listo.
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
  event.waitUntil(self.registration.showNotification(title, options));
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
