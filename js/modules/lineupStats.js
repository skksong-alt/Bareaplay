// js/modules/lineupStats.js
// 라인업 포지션 집계표 (운영진 전용) — 당일 라인업에서 각 선수가
// 공격/미들/수비/GK/휴식을 각각 몇 번 맡는지 표시. 드래그로 바뀌면 자동 갱신.

import { positionGroup } from './coachCore.js?v=2';
let state;
let statsContainer = null;
let observer = null;
let isRendering = false;

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

        const quarters = state.quarterCount===4?4:6;
        for (let q = 0; q < quarters; q++) {
            const lineup = results.lineups[q] || {};
            Object.keys(lineup).forEach(pos => {
                const group = positionGroup(pos, results.formations?.[q]);
                const cat = group === 'ATT' ? 'FWD' : group === 'MID' ? 'MID' : group;
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
            return `<tr>
                <td class="py-1.5 px-3 font-medium text-gray-900 whitespace-nowrap">${n}</td>
                <td class="py-1.5 px-3 text-center">${c.FWD || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.MID || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.DEF || ''}</td>
                <td class="py-1.5 px-3 text-center">${c.GK || ''}</td>
                <td class="py-1.5 px-3 text-center text-gray-400">${c.REST || ''}</td>
                <td class="py-1.5 px-3 text-center font-bold">${c.total}</td>
            </tr>`;
        }).join('');

        const expanded=!!statsContainer.querySelector('details')?.open;
        statsContainer.innerHTML = `
            <details class="lineup-stats-details" ${expanded?'open':''}>
                <summary>선수별 역할 횟수 · ${quarters}쿼터 집계</summary>
                <p class="text-xs text-gray-400 mb-2">실제 출전 시간이 아닌 배정 횟수입니다. 한 포지션을 꾸준히 훈련하는 것은 정상이며, 선수 의견과 팀 상황을 함께 확인하세요. 휴식에는 심판이 포함됩니다.</p>
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
            </details>`;
    } finally {
        isRendering = false;
    }
}
