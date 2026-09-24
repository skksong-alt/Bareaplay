// sw.js
const CACHE_NAME = 'bareaplay-cache-v73';
const urlsToCache = [
    '/', '/index.html', '/share.html', '/css/style.css',
    '/css/match-hub.css?v=5',
    '/css/operations.css?v=1',
    '/js/app.js?v=29',
    '/js/store.js?v=2',
    '/js/modules/playerManagement.js?v=6',
    '/js/modules/teamBalancer.js?v=10',
    '/js/modules/lineupGenerator.js?v=11',
    '/js/modules/accounting.js?v=8',
    '/js/modules/shareManagement.js?v=12',
    '/js/modules/voteManagement.js?v=23',
    '/js/modules/voteTiming.js?v=1',
    '/js/modules/shareLineupValidation.js?v=1',
    '/js/modules/lineupStats.js?v=2',
    '/js/modules/coachCore.js?v=1',
    '/js/modules/voteOrder.js?v=1',
    '/js/modules/dutyRotation.js?v=2',
    '/js/modules/refereeEducation.js?v=1',
    '/js/modules/adminWorkflow.js?v=2',
    '/js/modules/teamCycles.js?v=1',
    '/js/modules/teamCycleCore.js?v=1',
    '/js/modules/trainingLineup.js?v=1',
    '/js/modules/meetingSession.js?v=1',
    '/js/modules/optionalLibraries.js?v=1',
    '/js/boot.js?v=1',
    '/js/modules/lineupImage.js?v=1',
    '/js/modules/positionPreferences.js?v=5',
    '/js/modules/positionPreferencesCore.js?v=4',
    '/js/modules/weeklyContent.js?v=4',
    '/js/modules/votePage.js?v=13',
    '/js/modules/ratingIdentity.js?v=1',
    '/js/modules/ratingService.js?v=3',
    '/js/modules/coachWorkspace.js?v=5',
    '/js/modules/matchRecord.js?v=2',
    '/manifest.json', '/favicon.ico', '/assets/icon-512.png'
];
// Keep versioned URLs above as the cache manifest. Public visits need not download
// every admin bundle; other same-origin files are cached when actually requested.
const initialUrls=urlsToCache.filter(url=>!url.startsWith('/js/modules/') || [
    'votePage','voteManagement','voteOrder','voteTiming','weeklyContent','refereeEducation',
    'ratingIdentity','ratingService','coachCore','dutyRotation','positionPreferences',
    'positionPreferencesCore','meetingSession','optionalLibraries'
].some(name=>url.startsWith(`/js/modules/${name}.js?`)));


// [v55 보강] 페이지에서 '즉시 교체' 요청을 받으면 대기 없이 새 버전으로 전환
// (index.html 의 '새 버전 알림 배너'가 이 메시지를 보낸다)
self.addEventListener('message', (event) => {
    if (event && event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            const promises = initialUrls.map(url =>
                cache.add(url).catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
            );
            return Promise.all(promises);
        })
    );
    // Existing pages finish editing first; activation is requested by the update button.
});

// [수정] 네트워크 우선: 항상 최신 파일을 먼저 받고, 오프라인일 때만 저장본 사용
self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    if (url.includes('googleapis.com') || url.includes('gstatic.com') || new URL(url).pathname.startsWith('/api/')) return;

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
