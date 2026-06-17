// js/modules/lineupStats.js
// 라인업 포지션 집계표 (운영진 전용) — 당일 라인업에서 각 선수가
// 공격/미들/수비/GK/휴식을 각각 몇 번 맡는지 표시. 드래그로 바뀌면 자동 갱신.

let state;
let statsContainer = null;
let observer = null;
let isRendering = false;

// 포지션 → 큰 분류 매핑 (선수정보 기준: 공격 FW/LW/RW, 미들 CM/MF 등, 수비 CB/LB/RB)
const FWD = new Set(['FW', 'ST', 'CF', 'LW', 'RW', 'SS', 'LF', 'RF']);
const MID = new Set(['MF', 'CM', 'CAM', 'CDM', 'DM', 'AM', 'LM', 'RM', 'LCM', 'RCM']);
const DEF = new Set(['CB', 'LB', 'RB', 'LWB', 'RWB', 'WB', 'DF', 'SW', 'LCB', 'RCB']);

function categoryOf(pos) {
    const p = String(pos || '').toUpperCase();
    if (p === 'GK') return 'GK';
    if (FWD.has(p)) return 'FWD';
    if (MID.has(p)) return 'MID';
    if (DEF.has(p)) return 'DEF';
    return 'MID'; // 알 수 없는 포지션은 미들로 간주
}

export function init(dependencies) {
    state = dependencies.state;

    const lineupPage = document.getElementById('page-lineup');
    const lineupDisplay = document.getElementById('lineup-display');
    if (!lineupPage || !lineupDisplay) return;

    // 집계표 컨테이너를 라인업 표시 영역 '앞'에 한 번만 삽입 (관찰 대상과 분리)
    statsContainer = document.createElement('div');
    statsContainer.id = 'lineup-stats-container';
    statsContainer.className = 'mb-4';
    lineupDisplay.parentNode.insertBefore(statsContainer, lineupDisplay);

    // 라인업이 다시 그려질 때마다(생성/드래그 교체 포함) 집계표 갱신
    observer = new MutationObserver(() => {
        if (isRendering) return;
        renderStats();
    });
    observer.observe(lineupDisplay, { childList: true, subtree: true });

    renderStats();
}

function renderStats() {
    if (!statsContainer) return;
    isRendering = true;
    try {
        // 운영진 전용 + 라인업이 있을 때만 표시
        const results = state.lineupResults;
        const hasLineup = results && results.lineups && Array.isArray(results.lineups);
        if (!state.isAdmin || !hasLineup) {
            statsContainer.innerHTML = '';
            return;
        }

        const counts = {}; // name -> {FWD,MID,DEF,GK,REST,total}
        const ensure = (name) => {
            const n = String(name || '').replace(' (신규)', '').trim();
            if (!n || n === '미배정') return null;
            if (!counts[n]) counts[n] = { FWD: 0, MID: 0, DEF: 0, GK: 0, REST: 0, total: 0 };
            return counts[n];
        };

        const quarters = results.lineups.length;
        for (let q = 0; q < quarters; q++) {
            const lineup = results.lineups[q] || {};
            Object.keys(lineup).forEach(pos => {
                const cat = categoryOf(pos);
                (lineup[pos] || []).forEach(name => {
                    const c = ensure(name);
                    if (c) { c[cat] += 1; c.total += 1; }
                });
            });
            const resters = (results.resters && results.resters[q]) ? results.resters[q] : [];
            resters.forEach(name => {
                const c = ensure(name);
                if (c) c.REST += 1;
            });
        }

        const names = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'ko-KR'));
        if (names.length === 0) { statsContainer.innerHTML = ''; return; }

        const rows = names.map(n => {
            const c = counts[n];
            // 전문 GK(키퍼를 4회 이상 맡는 선수)는 색칠 대상에서 제외
            const isProGk = c.GK >= 4;
            // 전문 GK가 아니면서 특정 포지션(공격/미들/수비 중 하나)을 4회 이상 맡으면 강조
            const overloaded = !isProGk && (c.FWD >= 4 || c.MID >= 4 || c.DEF >= 4);
            const warn = overloaded ? ' style="background:#fef2f2"' : '';
            return `<tr${warn}>
                <td class="py-1.5 px-3 font-medium text-gray-900 whitespace-nowrap">${n}</td>
                <td class="py-1.5 px-3 text-center">${c.FWD || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.MID || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.DEF || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.GK || ''}</td>
                <td class="py-1.5 px-3 text-center text-gray-400">${c.REST || ''}</td>
                <td class="py-1.5 px-3 text-center font-bold">${c.total}</td>
            </tr>`;
        }).join('');

        statsContainer.innerHTML = `
            <div class="bg-white p-4 rounded-2xl shadow-lg">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-bold">📊 포지션 집계 <span class="text-xs font-normal text-gray-400">(운영진 전용 · 드래그하면 자동 갱신)</span></h3>
                </div>
                <p class="text-xs text-gray-400 mb-2">전문 GK를 제외하고, 한 포지션(공격·미들·수비)을 4회 이상 맡은 선수는 붉게 표시됩니다. 너무 치우치면 드래그로 조정하세요.</p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-600 uppercase bg-gray-50">
                            <tr>
                                <th class="py-2 px-3">이름</th>
                                <th class="py-2 px-3 text-center">공격</th>
                                <th class="py-2 px-3 text-center">미들</th>
                                <th class="py-2 px-3 text-center">수비</th>
                                <th class="py-2 px-3 text-center">GK</th>
                                <th class="py-2 px-3 text-center">휴식</th>
                                <th class="py-2 px-3 text-center">출전</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
    } finally {
        isRendering = false;
    }
}
