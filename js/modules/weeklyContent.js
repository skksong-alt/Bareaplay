import { escapeHtml as esc, validVideoUrl } from './coachCore.js?v=1';
import { refereeLessonHtml } from './refereeEducation.js?v=1';
export const LESSONS = [
    { ko:'받기 전에 보고, 첫 터치를 준비하기', en:'Look before receiving; prepare your first touch',
      actionKo:'공이 오기 전 주변을 확인하고 다음 패스가 가능한 방향으로 받으세요.', actionEn:'Look around before the ball arrives. Receive towards your next passing option.',
      drillKo:'준비 | 6명씩 한 조, 공 2개와 콘 4개. 약 15×20m 공간을 잡고 옆 조와 간격을 둡니다. 준비운동을 마친 뒤 시작하며, 설명·교대 시간도 각 5분에 포함합니다.\n0–5분 · 받기 전 확인 | 3명씩 두 그룹으로 나눠 5~7m 삼각형 패스. 공이 오기 전에 고개를 돌려 다음 동료를 확인하고, 몸을 비스듬히 열어 그쪽으로 첫 터치합니다. 터치 수는 제한하지 않습니다.\n5–10분 · 가벼운 압박 | 공 하나로 4명이 패스하고 2명은 패스 길만 막습니다. 수비는 처음엔 걷고, 몸싸움 없이 공을 가로채세요. 1분마다 수비를 바꾸고 막히면 공간을 넓힙니다.\n10–15분 · 3대3 연결 | 같은 공간에서 3대3. 세 번 연속 패스하면 1점, 공을 빼앗기면 상대가 이어갑니다. 점수보다 받기 전에 확인했는지를 봅니다.\n감독 한마디 | “공 오기 전에 한 번 보고!” 잘한 장면을 바로 칭찬하고, 공을 놓치면 지적보다 한 번 더 시범을 보여주세요.',
      drillEn:'SETUP | Groups of 6, 2 balls and 4 cones in roughly 15×20m, with space between groups. Start after warming up; explanations and rotations are included in each 5-minute block.\n0–5 MIN · Look first | Two groups of three pass around 5–7m triangles. Look towards the next teammate before receiving, open your body and take your first touch that way. No touch limit.\n5–10 MIN · Light pressure | Use one ball for 4v2. Defenders initially walk and intercept passing lanes without body contact. Rotate defenders each minute; enlarge the area if needed.\n10–15 MIN · 3v3 | Three consecutive passes earn a point. After a turnover, the other team continues. Notice looking before receiving, not just the score.\nCOACH CUE | “Look before it arrives!” Praise a good example immediately. Demonstrate again when someone struggles.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/global-grassroots-insights/christchurch-united.php' },
    { ko:'패스한 뒤 다시 받을 길 만들기', en:'Pass, then offer another passing angle',
      actionKo:'패스한 자리에 멈추지 말고 공 가진 동료가 볼 수 있는 곳으로 움직이세요.', actionEn:'After passing, move where the teammate on the ball can see and reach you.',
      drillKo:'준비 | 8명씩 한 조, 공 4개와 콘 10개. 약 20×25m 안에 폭 2m짜리 콘 문 3개를 만들고 서로 떨어뜨려 놓습니다. 준비운동 후 시작하며 교대·설명도 15분에 포함합니다.\n0–5분 · 패스 후 한 걸음 | 2명씩 5~7m 떨어져 패스합니다. 패스한 사람은 옆으로 2~3걸음 움직여 다시 받을 각도를 만들고, 동료는 새 위치로 패스합니다. 네 쌍은 서로 다른 구역을 씁니다.\n5–10분 · 문을 통과하는 패스 | 공 하나로 4대4. 콘 문 사이로 패스해 동료가 받으면 1점입니다. 문 앞에 서서 기다리지 말고 패스 길을 열어주세요.\n10–15분 · 다른 길 찾기 | 같은 게임을 이어가되 득점한 문에는 연속 득점할 수 없습니다. 막힌 쪽을 고집하지 않고 옆·뒤 동료를 통해 다른 문으로 이동합니다.\n감독 한마디 | “패스했으면 다시 보여줘!” 초보자는 터치 제한 없이, 수비 압박은 가볍게 시작합니다. 패스가 계속 끊기면 문과 공간을 넓히세요.',
      drillEn:'SETUP | Groups of 8, 4 balls and 10 cones. In roughly 20×25m, place three 2m-wide gates well apart. Warm up first; explanations count within the 15 minutes.\n0–5 MIN · Move after passing | Four pairs work in separate areas, 5–7m apart. After each pass, move two or three steps sideways to offer a new return angle.\n5–10 MIN · Pass through a gate | Play 4v4 with one ball. A completed pass through any gate earns a point. Move to create the passing lane rather than waiting in front of the gate.\n10–15 MIN · Find another route | Continue, but do not score through the same gate twice in a row. Use teammates beside and behind you to reach a different gate.\nCOACH CUE | “Pass, then show again!” Begin with no touch limit and light pressure. Widen gates and the area if passes keep breaking down.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/12-to-15/passing-and-movement.php' },
    { ko:'공 주변에 모이지 말고 패스 각도 만들기', en:'Create passing angles instead of crowding the ball',
      actionKo:'공을 가진 동료와 너무 가까워지지 말고 옆과 뒤에서 패스 선택지를 만드세요.', actionEn:'Offer options beside and behind the ball carrier; do not crowd them.',
      drillKo:'준비 | 8명씩 한 조, 공 4개와 콘 8개. 약 20×25m 공간에 폭 2m짜리 문 4개를 넉넉히 떨어뜨려 만듭니다. 준비운동 후 시작하고 설명·이동 시간을 각 구간에 포함합니다.\n0–5분 · 정확한 짧은 패스 | 2명씩 문 하나를 사이에 두고 5~7m 거리에서 패스합니다. 디딤발을 목표 쪽에 놓고 발 안쪽으로 동료가 받기 편한 공을 보내세요. 빠르기보다 정확하게 5번 연결하는 것이 목표입니다.\n5–10분 · 다음 문으로 이동 | 두 사람이 패스로 문을 통과하면 비어 있는 다른 문으로 천천히 이동합니다. 이동 전에 고개를 들어 다른 조와 겹치지 않는 길을 고릅니다.\n10–15분 · 4대4 패스 게임 | 공 하나로 경기합니다. 문 사이로 보낸 공을 동료가 받아야 1점이고, 혼자 드리블로 통과한 것은 점수가 아닙니다. 공 주변에 몰리지 않고 멀리 있는 문도 활용하세요.\n감독 한마디 | “공 말고 빈 공간도 보자!” 어려우면 문을 넓히거나 패스 거리를 줄입니다. 익숙해져도 모두에게 원터치를 강요하지 않습니다.',
      drillEn:'SETUP | Groups of 8, 4 balls and 8 cones. Place four 2m-wide gates well apart in roughly 20×25m. Warm up first; explanations and transitions are included.\n0–5 MIN · Accurate short passes | Work in pairs, 5–7m apart across a gate. Point your standing foot towards the target and use the inside of the foot. Aim for five comfortable passes, not maximum speed.\n5–10 MIN · Find the next gate | After a completed pass through a gate, walk to another free gate together. Look up and avoid crossing another pair’s path.\n10–15 MIN · 4v4 passing game | Use one ball. A pass through a gate that a teammate receives earns a point; dribbling through does not. Spread out and use gates away from the ball.\nCOACH CUE | “See the space, not just the ball!” Widen gates or shorten distances if needed. Do not impose one-touch play on everyone.',
      url:'https://www.fifatrainingcentre.com/en/practice/grassroots/4-to-8/perfect-the-pass.php' },
    { ko:'동료의 움직임을 보고 함께 움직이기', en:'See your teammate and move together',
      actionKo:'동료가 공을 받으러 움직이면 다른 패스 길을 만드세요. 수비할 때도 뒤를 도와주세요.', actionEn:'When a teammate moves to receive, offer a different passing route. Cover behind them when defending.',
      drillKo:'준비 | 9명씩 한 조를 3명씩 세 팀으로 나눕니다. 공 3개, 조끼, 콘으로 약 18×24m 공간을 만들고 길이를 세 구역으로 나눕니다. 준비운동 후 시작하며 설명·교대 시간을 포함해 15분입니다.\n0–5분 · 부르고 연결하기 | 팀마다 공 하나로 삼각형 패스. 받을 선수는 이름을 부르거나 손으로 받을 방향을 알려주고, 나머지 선수는 다음 패스 길을 만듭니다.\n5–10분 · 가운데를 통과하기 | 양 끝 구역에 한 팀씩, 가운데에 수비 팀을 둡니다. 끝 구역 안에서 공을 돌리다 가운데를 가로질러 반대 팀에 연결하면 1점입니다. 수비는 자기 구역에서 땅볼 패스만 가로채고, 1분마다 수비 팀을 바꿉니다.\n10–15분 · 짧은 3대3 | 두 팀이 경기하고 한 팀은 옆에서 대기합니다. 세 번 연속 패스하면 1점. 1분마다 한 팀씩 교대해 전원이 비슷하게 참여합니다.\n감독 한마디 | “동료가 움직이면 다른 길을 열자!” 공 가진 사람 옆·뒤에서 도와주도록 칭찬하세요. 막히면 수비 한 명을 바깥 패스 도우미로 바꾸고 순환합니다.',
      drillEn:'SETUP | Groups of 9 in three teams of three. Use 3 balls, bibs and cones in roughly 18×24m divided into three zones along its length. Warm up first; explanations and rotations count within the 15 minutes.\n0–5 MIN · Call and connect | Each team passes in a triangle with its own ball. Call or signal where you want the pass; the third player offers the next route.\n5–10 MIN · Through the middle | Put one team in each end zone and defenders in the middle. Circulate at an end, then connect to the opposite team for a point. Defenders intercept ground passes inside their zone. Rotate the defending team each minute.\n10–15 MIN · Short 3v3 rounds | Two teams play while one waits safely outside. Three passes earn a point. Rotate one team each minute so everyone participates similarly.\nCOACH CUE | “A teammate moves; open another route!” Praise support beside and behind the ball. If needed, move one defender outside as a passing helper and rotate that role.',
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
    const hasCustomDrill=typeof custom?.[en?'drillEn':'drillKo']==='string' && custom[en?'drillEn':'drillKo'].trim();
    const source=validVideoUrl(lessonFor(date).url);
    return `<details class="coach-card preparation-card"><summary><span class="preparation-icon" aria-hidden="true">▷</span><span class="preparation-title"><strong>${en?'Before the match':'경기 전 참고 영상'}</strong><small>${esc(date)} · ${en?`${videos.length} resources · 15-minute practice`:`참고 자료 ${videos.length}개 · 15분 연습`}</small></span><span class="preparation-chevron" aria-hidden="true">›</span></summary>
      <div class="preparation-content"><p class="preparation-description">${en?'Understand every role, play better together. Watch all the videos before the match and bring one idea to try together. Tap a guideline to watch.':'다른 포지션을 이해하면 우리 팀의 플레이도 더 좋아집니다. 경기 전 영상들을 두루 살펴보고, 함께 실천할 한 가지를 찾아보세요. 핵심 지침을 누르면 영상이 열립니다.'}</p>
      <ol class="video-guidelines">${videos.map((v,i)=>`<li class="video-guideline"><span class="video-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div>${v.role?`<small>${esc(v.role)}</small>`:''}<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${esc(v.title)}</a></div></li>`).join('')}</ol>
      ${note && !parseGuidelines(note).length?`<p class="coach-note">${esc(note)}</p>`:''}
      ${refereeLessonHtml(date,lang)}
      <div class="practice-block"><h3>${en?'After warm-up · 15-minute practice':'준비운동 후 · 15분 연습 아이디어'}</h3><div class="practice-instructions">${String(en?l.drillEn:l.drillKo).split('\n').filter(s=>s.trim()).map(s=>{const divider=s.indexOf(' | ');return divider<0?`<p>${esc(s)}</p>`:`<p><strong>${esc(s.slice(0,divider))}</strong><br>${esc(s.slice(divider+3))}</p>`;}).join('')}</div>${!hasCustomDrill?`<a class="practice-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${en?'Adapted for adult beginners from FIFA training ideas · View source':'FIFA 훈련 원리를 성인 초보팀의 15분 연습으로 재구성 · 참고 원문'} ↗</a>`:''}</div></div></details>`;
}
export function addCoachStyles() {
    if (document.getElementById('coach-css')) return;
    const style = document.createElement('style'); style.id = 'coach-css';
    style.textContent = `.coach-wrap{max-width:600px;margin:auto;padding:16px;font-family:Inter,'Noto Sans KR',sans-serif;color:#172b3a}.coach-card{background:white;border:1px solid #dde6e4;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 3px 14px #102a2306}.coach-card h2{font-size:1.2rem;font-weight:800;margin:0 0 12px}.coach-card p{margin:8px 0;line-height:1.6}.coach-card label{display:block;margin:10px 0 4px;font-weight:600}.coach-card input,.coach-card select,.coach-card textarea{border:1px solid #b9c9c4;border-radius:8px;padding:10px;width:100%;box-sizing:border-box;color:#172b3a;background:white}.coach-card input[type=checkbox]{width:auto}.coach-card button,.coach-button{border:1px solid #bccdc7;border-radius:8px;padding:10px 14px;cursor:pointer;background:#f2f7f5;color:#173b32;margin:4px 3px 4px 0;font-weight:700}.coach-card button:disabled{opacity:.45;cursor:wait}.coach-card .coach-primary{background:#087f63;color:white;border-color:#087f63}.coach-note{font-size:.82rem;color:#556b66}.coach-eyebrow{font-size:.72rem;letter-spacing:.1em;color:#087f63;font-weight:800}.coach-link{color:#087f63;text-decoration:underline;font-weight:700}.coach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.coach-table{border-collapse:collapse;width:100%;font-size:.83rem}.coach-table td,.coach-table th{padding:8px;border-bottom:1px solid #e0e7e5;text-align:left;white-space:nowrap}.coach-selected{background:#cceee3!important;border-color:#087f63!important}.coach-status{min-height:24px;color:#087f63;font-weight:700}.coach-error{color:#b42318}.coach-card summary{cursor:pointer;font-weight:700}.coach-card button:focus-visible,.coach-card a:focus-visible{outline:3px solid #d7901d;outline-offset:2px}`;
    document.head.append(style);
}
