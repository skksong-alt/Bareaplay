// sw.js

const CACHE_NAME = 'bareaplay-cache-v2'; // 버전을 올려서 캐시를 갱신
const urlsToCache = [
    '.',
    'css/style.css',
    'js/app.js',
    'js/store.js',
    'js/modules/playerManagement.js',
    'js/modules/teamBalancer.js',
    'js/modules/lineupGenerator.js',
    'js/modules/accounting.js',
    'js/modules/shareManagement.js',
    'manifest.json',
    'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});