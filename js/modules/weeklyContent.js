import { escapeHtml as esc, validVideoUrl } from './coachCore.js?v=1';
export const LESSONS = [
    { ko:'받기 전에 보고, 첫 터치를 준비하기', en:'Look before receiving; prepare your first touch',
      actionKo:'공이 오기 전 주변을 확인하고 다음 패스가 가능한 방향으로 받으세요.', actionEn:'Look around before the ball arrives. Receive towards your next passing option.',
      drillKo:'3인 패스 5분 → 수비 압박을 조금 추가한 패스 5분 → 작은 경기 5분', drillEn:'5 min passing in threes → 5 min with light pressure → 5 min small-sided game',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/global-grassroots-insights/christchurch-united.php' },
    { ko:'패스한 뒤 다시 받을 길 만들기', en:'Pass, then offer another passing angle',
      actionKo:'패스한 자리에 멈추지 말고 공 가진 동료가 볼 수 있는 곳으로 움직이세요.', actionEn:'After passing, move where the teammate on the ball can see and reach you.',
      drillKo:'3인 패스와 이동 5분 → 4대1 5분 → 4대4 5분. 초보자는 터치 제한 없이 시작하세요.', drillEn:'5 min pass and move → 5 min 4v1 → 5 min 4v4. Start without touch limits for beginners.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/12-to-15/passing-and-movement.php' },
    { ko:'공 주변에 모이지 말고 패스 각도 만들기', en:'Create passing angles instead of crowding the ball',
      actionKo:'공을 가진 동료와 너무 가까워지지 말고 옆과 뒤에서 패스 선택지를 만드세요.', actionEn:'Offer options beside and behind the ball carrier; do not crowd them.',
      drillKo:'패스 문 통과 5분 → 문 여러 개를 둔 4대4 10분. 어렵다면 문과 공간을 넓히세요.', drillEn:'5 min passing through gates → 10 min 4v4 with multiple gates. Make gates and space larger if needed.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/4-to-8/perfect-the-pass.php' },
    { ko:'동료의 움직임을 보고 함께 움직이기', en:'See your teammate and move together',
      actionKo:'동료가 공을 받으러 움직이면 다른 패스 길을 만드세요. 수비할 때도 뒤를 도와주세요.', actionEn:'When a teammate moves to receive, offer a different passing route. Cover behind them when defending.',
      drillKo:'3인 연결 5분 → 소규모 패스 게임 5분 → 자유 경기 5분. 이번 주 행동 한 가지를 반복하세요.', drillEn:'5 min combinations in threes → 5 min small passing game → 5 min free game. Repeat one weekly action.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/12-to-15/multi-team-passing-and-small-sided-game-exercises.php' }
];
export function lessonFor(date, custom = {}) {
    const day = Date.parse(`${date}T12:00:00Z`);
    const index = Number.isFinite(day) ? ((Math.floor((day - Date.UTC(2026,8,14)) / 604800000) % 4) + 4) % 4 : 0;
    return { ...LESSONS[index], ...Object.fromEntries(Object.entries(custom).filter(([,v]) => typeof v === 'string' && v.trim())) };
}
// Coach-supplied titles/links, not independently verified video summaries.
// Static defaults only: loading a page never seeds or changes Firestore content.
export const TEAM_VIDEOS = [
    {roleKo:'미드필더',roleEn:'MIDFIELD',ko:'볼만 잡으면 급해지는 이유와 여유 찾는 핵심 원리',en:'Find composure when you receive the ball',url:'https://youtu.be/0iG32VGPXMo'},
    {roleKo:'미드필더',roleEn:'MIDFIELD',ko:'중원에서 패스 줄 곳 없을 때 공간 여는 오프더볼',en:'Move off the ball to open a passing option',url:'https://youtu.be/mVadyA4s5Ag'},
    {roleKo:'풀백 · 윙백',roleEn:'FULLBACK',ko:'뚫기 힘든 사이드백의 수비 자세와 거리 조절',en:'Fullback defending: body position and distance',url:'https://youtu.be/iQ61I5pGWg8'},
    {roleKo:'센터백',roleEn:'CENTRE BACK',ko:'위험지역 걷어내기의 기본과 방향 선택',en:'Clear danger: choose the direction of your clearance',url:'https://youtu.be/mb9-khxwc5I'},
    {roleKo:'공격수',roleEn:'FORWARD',ko:'실전에서 강하고 정확한 슈팅을 만드는 기본 원리',en:'The basics of powerful, accurate shooting',url:'https://youtu.be/cRM7MVt6GS8'},
    {roleKo:'공격수',roleEn:'FORWARD',ko:'원터치 연계로 찬스 만드는 스트라이커 움직임',en:'Create chances with one-touch combinations',url:'https://youtu.be/JSIUxMPkfxc'}
];
// Reuse the existing optional string fields; plain legacy descriptions remain valid.
// Only a small, safe link format is supported, never arbitrary HTML/Markdown.
export function parseGuidelines(text = '') {
    return [...String(text).matchAll(/\[([^\]\n]{1,240})\]\((https:\/\/[^\s)]+)\)/g)]
        .map(([,title,url])=>({title,url:validVideoUrl(url)})).filter(x=>x.url).slice(0,6);
}
export function guidelinesFor(date, custom = {}, lang = 'ko') {
    const en=lang==='en', own=parseGuidelines(en?custom.segmentEn:custom.segmentKo);
    if(own.length) return own;
    const fallback=parseGuidelines(en?custom.segmentKo:custom.segmentEn);
    if(fallback.length) return fallback;
    // Previously saved single-resource lessons must not be replaced by the defaults.
    if(custom.url || custom.ko || custom.en || custom.actionKo || custom.actionEn || custom.segmentKo || custom.segmentEn) {
        const l=lessonFor(date,custom),url=validVideoUrl(l.url);
        return url?[{title:en?l.en:l.ko,url}]:[];
    }
    return TEAM_VIDEOS.map(v=>({title:en?v.en:v.ko,role:en?v.roleEn:v.roleKo,url:v.url}));
}
export function lessonHtml(date, custom, lang = 'ko') {
    const l = lessonFor(date, custom), en = lang === 'en', videos=guidelinesFor(date,custom,lang);
    const note=en?custom?.segmentEn:custom?.segmentKo;
    return `<details class="coach-card preparation-card"><summary><span class="preparation-icon" aria-hidden="true">▷</span><span class="preparation-title"><strong>${en?'Before the match':'경기 전 참고 영상'}</strong><small>${esc(date)} · ${en?`${videos.length} resources · 15-minute practice`:`참고 자료 ${videos.length}개 · 15분 연습`}</small></span><span class="preparation-chevron" aria-hidden="true">›</span></summary>
      <div class="preparation-content"><p class="preparation-description">${en?'Start with one or two that fit your position. Tap a guideline to open the video or session.':'내 포지션에 맞는 영상 1~2개부터 가볍게. 핵심 지침을 누르면 영상·훈련 자료가 열립니다.'}</p>
      <ol class="video-guidelines">${videos.map((v,i)=>`<li class="video-guideline"><span class="video-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div>${v.role?`<small>${esc(v.role)}</small>`:''}<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${esc(v.title)}</a></div></li>`).join('')}</ol>
      ${note && !parseGuidelines(note).length?`<p class="coach-note">${esc(note)}</p>`:''}
      <div class="practice-block"><h3>${en?'After warm-up · 15-minute practice':'준비운동 후 · 15분 연습 아이디어'}</h3><p>${esc(en ? l.drillEn : l.drillKo)}</p></div></div></details>`;
}
export function addCoachStyles() {
    if (document.getElementById('coach-css')) return;
    const style = document.createElement('style'); style.id = 'coach-css';
    style.textContent = `.coach-wrap{max-width:600px;margin:auto;padding:16px;font-family:Inter,'Noto Sans KR',sans-serif;color:#172b3a}.coach-card{background:white;border:1px solid #dde6e4;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 3px 14px #102a2306}.coach-card h2{font-size:1.2rem;font-weight:800;margin:0 0 12px}.coach-card p{margin:8px 0;line-height:1.6}.coach-card label{display:block;margin:10px 0 4px;font-weight:600}.coach-card input,.coach-card select,.coach-card textarea{border:1px solid #b9c9c4;border-radius:8px;padding:10px;width:100%;box-sizing:border-box;color:#172b3a;background:white}.coach-card input[type=checkbox]{width:auto}.coach-card button,.coach-button{border:1px solid #bccdc7;border-radius:8px;padding:10px 14px;cursor:pointer;background:#f2f7f5;color:#173b32;margin:4px 3px 4px 0;font-weight:700}.coach-card button:disabled{opacity:.45;cursor:wait}.coach-card .coach-primary{background:#087f63;color:white;border-color:#087f63}.coach-note{font-size:.82rem;color:#556b66}.coach-eyebrow{font-size:.72rem;letter-spacing:.1em;color:#087f63;font-weight:800}.coach-link{color:#087f63;text-decoration:underline;font-weight:700}.coach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.coach-table{border-collapse:collapse;width:100%;font-size:.83rem}.coach-table td,.coach-table th{padding:8px;border-bottom:1px solid #e0e7e5;text-align:left;white-space:nowrap}.coach-selected{background:#cceee3!important;border-color:#087f63!important}.coach-status{min-height:24px;color:#087f63;font-weight:700}.coach-error{color:#b42318}.coach-card summary{cursor:pointer;font-weight:700}.coach-card button:focus-visible,.coach-card a:focus-visible{outline:3px solid #d7901d;outline-offset:2px}`;
    document.head.append(style);
}
