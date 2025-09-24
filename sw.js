// sw.js
const CACHE_NAME = 'bareaplay-cache-v10'; // 캐시 버전 업데이트
const urlsToCache = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/store.js',
    '/js/modules/playerManagement.js',
    '/js/modules/teamBalancer.js',
    '/js/modules/lineupGenerator.js',
    '/js/modules/accounting.js',
    '/js/modules/shareManagement.js',
    '/manifest.json',
    '/favicon.ico',
    '/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        // [수정] 개별 파일 캐싱 실패가 전체를 중단시키지 않도록 방어 코드 강화
        const promises = urlsToCache.map(url => {
            return cache.add(url).catch(err => {
                console.warn(`[SW] Failed to cache ${url}:`, err);
            });
        });
        return Promise.all(promises);
      })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('firestore.googleapis.com')) {
    return; // Firestore API 요청은 네트워크를 통하도록 함
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 캐시에 있으면 캐시에서, 없으면 네트워크에서 가져옴
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
            return caches.delete(cacheName); // 이전 버전 캐시 삭제
          }
        })
      );
    })
  );
});