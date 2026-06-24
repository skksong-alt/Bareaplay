// sw.js
const CACHE_NAME = 'bareaplay-cache-v47';
const urlsToCache = [
    '/', '/index.html', '/css/style.css',
    '/js/app.js?v=5',
    '/js/store.js?v=2',
    '/js/modules/playerManagement.js?v=3',
    '/js/modules/teamBalancer.js?v=4',
    '/js/modules/lineupGenerator.js?v=2',
    '/js/modules/accounting.js?v=3',
    '/js/modules/shareManagement.js?v=2',
    '/js/modules/voteManagement.js?v=2',
    '/js/modules/lineupStats.js?v=1',
    '/manifest.json', '/favicon.ico', '/assets/icon-512.png'
];


self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const promises = urlsToCache.map(url =>
                cache.add(url).catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
            );
            return Promise.all(promises);
        })
    );
    self.skipWaiting();
});

// [수정] 네트워크 우선: 항상 최신 파일을 먼저 받고, 오프라인일 때만 저장본 사용
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    if (url.includes('googleapis.com') || url.includes('gstatic.com')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.ok && event.request.method === 'GET' && url.startsWith(self.location.origin)) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
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
        }).then(() => self.clients.claim())
    );
});
