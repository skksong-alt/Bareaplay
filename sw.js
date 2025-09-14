// sw.js

const CACHE_NAME = 'bareaplay-cache-v1';
// 오프라인 시에도 필요한 최소한의 파일 목록
const urlsToCache = [
    '.', // index.html
    'css/style.css',
    'js/app.js',
    'js/store.js',
    'js/modules/playerManagement.js',
    'js/modules/teamBalancer.js',
    'js/modules/lineupGenerator.js',
    'js/modules/accounting.js',
    'js/modules/shareManagement.js', // shareManagement 모듈 추가
    'manifest.json',
    'assets/icon-512.png' // 로컬 앱 아이콘
];

// 1. 서비스 워커 설치
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. 네트워크 요청 가로채기 (캐시 우선 전략)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 캐시에 파일이 있으면 바로 반환하고, 없으면 네트워크로 요청
        return response || fetch(event.request);
      })
  );
});

// 3. 오래된 캐시 삭제
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