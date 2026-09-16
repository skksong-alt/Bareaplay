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
export function lessonHtml(date, custom, lang = 'ko') {
    const l = lessonFor(date, custom), en = lang === 'en';
    const url = validVideoUrl(l.url);
    return `<section class="coach-card"><p class="coach-eyebrow">${en ? 'THIS WEEK · ONE ACTION' : '이번 주 · 행동 하나'}</p>
      <h2>${esc(en ? l.en : l.ko)}</h2><p>${esc(en ? l.actionEn : l.actionKo)}</p>
      ${url ? `<a class="coach-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">▶ ${en ? 'Open video / coaching session' : '영상·훈련 자료 보기'}</a>` : ''}
      <p class="coach-note">${esc(en ? l.segmentEn || 'Watch the demonstration that matches this action. FIFA youth sessions are adapted here for adult beginners.' : l.segmentKo || '이번 행동에 해당하는 시범 장면을 참고하세요. FIFA 유소년 자료를 성인 초보팀에 맞춰 활용합니다.')}</p>
      <details><summary>${en ? '15-minute practice idea (after warm-up)' : '준비운동 후 15분 연습 아이디어'}</summary><p>${esc(en ? l.drillEn : l.drillKo)}</p></details></section>`;
}
export function addCoachStyles() {
    if (document.getElementById('coach-css')) return;
    const style = document.createElement('style'); style.id = 'coach-css';
    style.textContent = `.coach-wrap{max-width:600px;margin:auto;padding:16px;font-family:Inter,'Noto Sans KR',sans-serif;color:#172b3a}.coach-card{background:white;border:1px solid #dde6e4;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 3px 14px #102a2306}.coach-card h2{font-size:1.2rem;font-weight:800;margin:0 0 12px}.coach-card p{margin:8px 0;line-height:1.6}.coach-card label{display:block;margin:10px 0 4px;font-weight:600}.coach-card input,.coach-card select,.coach-card textarea{border:1px solid #b9c9c4;border-radius:8px;padding:10px;width:100%;box-sizing:border-box;color:#172b3a;background:white}.coach-card input[type=checkbox]{width:auto}.coach-card button,.coach-button{border:1px solid #bccdc7;border-radius:8px;padding:10px 14px;cursor:pointer;background:#f2f7f5;color:#173b32;margin:4px 3px 4px 0;font-weight:700}.coach-card button:disabled{opacity:.45;cursor:wait}.coach-card .coach-primary{background:#087f63;color:white;border-color:#087f63}.coach-note{font-size:.82rem;color:#556b66}.coach-eyebrow{font-size:.72rem;letter-spacing:.1em;color:#087f63;font-weight:800}.coach-link{color:#087f63;text-decoration:underline;font-weight:700}.coach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.coach-table{border-collapse:collapse;width:100%;font-size:.83rem}.coach-table td,.coach-table th{padding:8px;border-bottom:1px solid #e0e7e5;text-align:left;white-space:nowrap}.coach-selected{background:#cceee3!important;border-color:#087f63!important}.coach-status{min-height:24px;color:#087f63;font-weight:700}.coach-error{color:#b42318}.coach-card summary{cursor:pointer;font-weight:700}.coach-card button:focus-visible,.coach-card a:focus-visible{outline:3px solid #d7901d;outline-offset:2px}`;
    document.head.append(style);
}
