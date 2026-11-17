const CACHE_SHELL = 'gps-terrestre-shell-v5';
const CACHE_TILES = 'gps-terrestre-tiles-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './static/css/app.css',
  './static/js/geo_utils.js',
  './static/js/app.js',
  './static/icons/icon-192.png',
  './static/icons/icon-512.png',
  './static/vendor/leaflet.css',
  './static/vendor/leaflet.js',
  './static/vendor/MarkerCluster.css',
  './static/vendor/MarkerCluster.Default.css',
  './static/vendor/leaflet.markercluster.js',
  './static/vendor/togeojson.umd.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_TILES)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return (
    url.includes('tile.openstreetmap.org') ||
    url.includes('tile.opentopomap.org') ||
    url.includes('arcgisonline.com') ||
    url.includes('cyclosm') ||
    url.includes('tile.waymarkedtrails.org')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (isTileRequest(req.url)) {
    event.respondWith(
      caches.open(CACHE_TILES).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const resp = await fetch(req);
          if (resp && (resp.ok || resp.type === 'opaque')) {
            cache.put(req, resp.clone());
          }
          return resp;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // App shell: Network first, fallback to cache
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok && req.url.startsWith(self.location.origin)) {
          const copy = resp.clone();
          caches.open(CACHE_SHELL).then((cache) => cache.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
