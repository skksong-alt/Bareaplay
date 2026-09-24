// js/modules/accounting.js
import { ensureLibrary } from './optionalLibraries.js?v=1';
import { createSaveQueue } from './saveQueue.js?v=1';
import { doc, getDocs, collection, setDoc, deleteDoc, addDoc, serverTimestamp, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
let saveQueue;
let attendanceDate, checklistContainer, recordBtn, logBody, logFoot, memoArea, adminLoginBtn, accountingChart;
let incomeTabBtn, expenseTabBtn, incomeLogSection, expenseLogSection, expenseForm, expenseLogBody, expenseLogFoot;
let totalBalanceEl, filterStartDateEl, filterEndDateEl, filterPeriodSelectEl, excelDownloadBtn;
let checkAllBtn, uncheckAllBtn;
// [추가] 현장 수금 체크 모드 상태/엘리먼트
let collectMode = false, collectHidePaid = false;
let collectModeBtn, collectBar, collectHideBtn;
let grassToggle, recordDateJump, deleteRangeBtn;
let chartInstance = null;
let memoDoc;
// [v59 추가] 지출 로그 정렬 상태 (null = 기본: 최신 등록순)
let expenseSortKey = null;   // 'date' | 'item' | 'amount' | null
let expenseSortDir = 1;      // 1 = 오름차순, -1 = 내림차순

// [추가] UTC 밀림 방지용 현지(두바이/기기) 날짜 문자열
function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// [추가] 한글 인코딩(NFC/NFD) 차이로 같은 이름이 다르게 인식되는 것을 방지
function normName(s) {
    return (s == null ? '' : String(s)).normalize('NFC').trim();
}

// [추가] 회비 유형 + 구장(인조/천연)에 따른 자동 금액 계산
//  - 운영진(admin): 항상 0
//  - 학생(student): 인조 25 / 천연 35
//  - 일반(normal)·게스트: 인조 50 / 천연 70
function computeFee(name, isGrass) {
    const key = normName(name);
    let p = state.playerDB[name] || state.playerDB[key];
    if (!p) {
        const found = Object.keys(state.playerDB).find(k => normName(k) === key);
        if (found) p = state.playerDB[found];
    }
    const type = (p && p.feeType) ? p.feeType : 'normal';
    if (type === 'admin') return 0;
    if (type === 'student') return isGrass ? 35 : 25;
    return isGrass ? 70 : 50;
}

// [추가] 선수의 회비 유형 조회 (운영진=무료 판별용)
function feeTypeOf(name) {
    const key = normName(name);
    let p = state.playerDB[name] || state.playerDB[key];
    if (!p) {
        const found = Object.keys(state.playerDB).find(k => normName(k) === key);
        if (found) p = state.playerDB[found];
    }
    return (p && p.feeType) ? p.feeType : 'normal';
}

// [추가] 노쇼(통보 없이 불참) 상태 표식 — 회비/패널티 계산엔 영향 없음, 누적 통계용
const NOSHOW = 'N';
// [추가] 특정 선수의 누적 노쇼 횟수 (전체 기간)
function noShowCount(name) {
    const key = normName(name);
    return (state.attendanceLog || []).filter(l => normName(l.name) === key && l.paymentStatus === NOSHOW).length;
}

// [v58 추가] 💳 납부방식 (현금/카림/이체/기타) — attendance 문서의 payMethod 필드
const PAY_METHODS = [['cash', '현금'], ['careem', '카림'], ['transfer', '이체'], ['etc', '기타']];
function payMethodLabel(v) {
    const f = PAY_METHODS.find(m => m[0] === v);
    return f ? f[1] : '';
}

function getStatusColor(status) {
    switch (status) {
        case "●": return "bg-green-100 text-green-800";
        case "△": return "bg-yellow-100 text-yellow-800";
        case "✕": return "bg-red-100 text-red-800";
        case NOSHOW: return "bg-orange-100 text-orange-800";
        default: return "bg-gray-100";
    }
}

function renderFullPlayerChecklist() {
    if (!checklistContainer) return;
    checklistContainer.innerHTML = '';
    // [v58] 수동 추가 입력칸의 자동완성 목록 갱신 (등록 선수 전체)
    const __dl = document.getElementById('attendee-name-datalist');
    if (__dl) __dl.innerHTML = Object.keys(state.playerDB || {}).sort((a, b) => a.localeCompare(b, 'ko-KR')).map(nm => `<option value="${window.esc(nm)}"></option>`).join('');
    const selectedDate = attendanceDate.value;

    const loggedAttendees = state.attendanceLog
                                .filter(log => log.date === selectedDate)
                                .map(log => log.name);
    const loggedAttendeesSet = new Set(loggedAttendees.map(normName));

    let playerNames;
    let checkStatusSet;

    if (state.currentAttendees && state.currentAttendees.length > 0) {
        // ① 이 기기에서 방금 팀배정을 한 경우 (메모리에 명단 있음)
        playerNames = [...state.currentAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = new Set(playerNames.map(normName));
    } else if (loggedAttendees.length > 0) {
        // ② 이미 이 날짜로 저장된 출석 기록이 있는 경우 (그 기록을 그대로 표시)
        playerNames = [...loggedAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = loggedAttendeesSet;
    } else if (
        selectedDate && selectedDate === state.meetingDate &&
        Array.isArray(state.initialAttendeeOrder) && state.initialAttendeeOrder.length > 0
    ) {
        // ③ [Q1] 다른 기기(현장 휴대폰)에서도 팀배정 명단이 출석 후보로 자동 표시되도록,
        //        Firestore로 동기화된 initialAttendeeOrder(= 팀배정에 입력한 명단)를 사용.
        //        선택 날짜가 그 명단이 속한 '모임 날짜'와 같을 때만 적용(과거 날짜에 오늘 명단이 새지 않도록).
        //        전원 체크된 상태로 띄워 → '선택한 날짜 출석 저장'만 누르면 바로 기록됨.
        playerNames = [...new Set(state.initialAttendeeOrder.map(normName).filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = new Set(playerNames.map(normName));
    } else {
        playerNames = [...loggedAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = loggedAttendeesSet;
    }

    if (playerNames.length === 0) {
        checklistContainer.innerHTML = '<p class="text-gray-500 text-sm">표시할 참석자가 없습니다.<br>팀 배정기에서 명단을 가져오거나, 다른 날짜를 선택해주세요.</p>';
        return;
    }

    playerNames.forEach(name => {
        const isChecked = checkStatusSet.has(normName(name));
        const div = document.createElement('div');
        div.className = 'flex items-center';
        const __nc = noShowCount(name);
        const __badge = __nc > 0 ? ` <span class="ml-1 text-xs font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded" title="누적 노쇼 횟수">노쇼 ${__nc}</span>` : '';
        div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" ${isChecked ? 'checked' : ''} ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900">${name}</label>${__badge}`;
        checklistContainer.appendChild(div);
    });
}

// [추가] '기록 있는 날 바로가기' 드롭다운 채우기 (달력 점 표시의 가벼운 대안)
function populateDateJump() {
    if (!recordDateJump) return;
    const dateCount = {};
    state.attendanceLog.forEach(l => { if (l.date) dateCount[l.date] = (dateCount[l.date] || 0) + 1; });
    state.expenseLog.forEach(l => { if (l.date && !(l.date in dateCount)) dateCount[l.date] = 0; });
    const dates = Object.keys(dateCount).sort((a, b) => b.localeCompare(a)); // 최신순
    const cur = attendanceDate.value;
    recordDateJump.innerHTML =
        `<option value="">📌 기록 있는 날 바로가기 (${dates.length}일)</option>` +
        dates.map(d => `<option value="${d}" ${d === cur ? 'selected' : ''}>${d} · 참석 ${dateCount[d]}명</option>`).join('');
}

function renderAttendanceLogTable(logs) {
    if(!logBody) return;
    logBody.innerHTML = '';
    logFoot.innerHTML = '';

    const sortedLogs = logs.map(log=>({...log,...saveQueue?.pending(`attendance:${log.id}`)})).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name, 'ko-KR'));

    if (sortedLogs.length === 0) {
        logBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">해당 기간의 출석 로그가 없습니다.</td></tr>`;
        updateCollectBar(0, 0, 0, 0);
        updatePaySummaryBar(null); // [v59] 기록 없으면 수금 요약 숨김
        return;
    }

    let totalAmount = 0;
    // [추가] 수금 현황 집계
    let cPaid = 0, cPartial = 0, cNoshow = 0, cCollected = 0;
    // [v59 추가] 납부방식별 수금액 집계 (완납·일부만, payMethod 미지정은 'none')
    const paySums = {};
    // [추가] 운영진(무료) 제외한 '실제 수금 대상' 집계 → 진행바가 운영진 때문에 부풀지 않게
    let payEligible = 0, payDone = 0;
    sortedLogs.forEach((log, index) => {
        totalAmount += Number(log.paymentAmount || 0);
        const st = log.paymentStatus;
        if (st === '●') cPaid++;
        else if (st === '△') cPartial++;
        else if (st === NOSHOW) cNoshow++;
        if (st === '●' || st === '△') {
            const __amt = Number(log.paymentAmount || 0);
            cCollected += __amt;
            const __mk = log.payMethod || 'none';
            paySums[__mk] = (paySums[__mk] || 0) + __amt; // [v59] 방식별 합산
        }
        // 노쇼·운영진(무료)은 수금 대상에서 제외
        if (st !== NOSHOW && feeTypeOf(log.name) !== 'admin') {
            payEligible++;
            if (st === '●') payDone++;
        }

        // [추가] 수금모드 '안 낸 사람만 보기': 완납/일부/노쇼는 숨김
        if (collectMode && collectHidePaid && (st === '●' || st === NOSHOW)) return;

        const docId = log.id;
        const row = document.createElement('tr');
        // [추가] 수금모드용 상태 클래스 + 행에 data-id (탭 토글용)
        let stateClass = 'cstate-none';
        if (st === '●') stateClass = 'cstate-paid';
        else if (st === '△') stateClass = 'cstate-partial';
        else if (st === NOSHOW) stateClass = 'cstate-noshow';
        else if (st === '✕') stateClass = 'cstate-unpaid';
        row.className = 'bg-white border-b ' + stateClass;
        row.dataset.id = docId;
        const __nc = noShowCount(log.name);
        const __badge = __nc > 0 ? ` <span class="text-xs font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded" title="누적 노쇼 횟수">노쇼 ${__nc}</span>` : '';
        // [추가] 수금모드: 이름 옆에 현재 상태 칩(탭 안내)
        let cPill = '';
        if (collectMode) {
            if (st === '●') cPill = '<span class="collect-pill paid">완납</span>';
            else if (st === '△') cPill = '<span class="collect-pill partial">일부</span>';
            else if (st === NOSHOW) cPill = '<span class="collect-pill noshow">노쇼</span>';
            else cPill = '<span class="collect-pill unpaid">미수금</span>';
        }
        // [추가] 이름 옆 ✕ 버튼으로 이 한 건만 삭제
        row.innerHTML = `
            <td data-label="#" class="py-2 px-4 font-medium text-gray-700">${index + 1}</td> <td data-label="날짜" class="py-2 px-4">${log.date}</td>
            <td data-label="이름" class="py-2 px-4 font-medium text-gray-900">${log.name}${cPill}${__badge}<button data-id="${docId}" class="delete-log-btn ml-2 text-red-500 hover:text-red-700 font-bold admin-control" title="이 기록 삭제" ${!state.isAdmin ? 'disabled' : ''}>✕</button></td>
            <td data-label="납부 상태"><select data-id="${docId}" class="log-status-select p-1 border rounded-md ${getStatusColor(log.paymentStatus)} admin-control" ${!state.isAdmin ? 'disabled': ''}><option value="" ${!log.paymentStatus ? 'selected' : ''}></option><option value="●" ${log.paymentStatus === '●' ? 'selected' : ''}>● 완납</option><option value="△" ${log.paymentStatus === '△' ? 'selected' : ''}>△ 일부</option><option value="✕" ${log.paymentStatus === '✕' ? 'selected' : ''}>✕ 미납</option><option value="N" ${log.paymentStatus === NOSHOW ? 'selected' : ''}>N 노쇼</option></select></td>
            <td data-label="납부액"><input type="number" data-id="${docId}" class="log-amount-input w-24 p-1 border rounded-md admin-control" placeholder="납부액" value="${log.paymentAmount || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
            <td data-label="납부방식"><div class="pay-method-group">${PAY_METHODS.map(([v, label]) => `<button type="button" data-id="${docId}" data-method="${v}" class="pay-method-btn${log.payMethod === v ? ' active pm-' + v : ''}" ${!state.isAdmin ? 'disabled' : ''}>${label}</button>`).join('')}</div></td>
            <td data-label="비고"><input type="text" data-id="${docId}" data-name="${window.esc(log.name)}" class="log-note-input w-full p-1 border rounded-md admin-control" placeholder="비고 입력..." value="${window.esc((log.note && String(log.note).trim()) ? log.note : ((state.playerNotes && state.playerNotes[normName(log.name)]) || ''))}" ${!state.isAdmin ? 'disabled': ''}></td>
        `;
        logBody.appendChild(row);
    });
    logFoot.innerHTML = `<tr><td colspan="4" class="py-2 px-4 text-right">조회 기간 합계</td><td class="py-2 px-4 font-bold">${totalAmount.toLocaleString()}</td><td class="py-2 px-4" colspan="2"></td></tr>`;

    // [추가] 수금 진행바 갱신 (노쇼·운영진 제외한 실제 수금 대상 기준)
    updateCollectBar(payDone, payEligible, cCollected, payEligible - payDone);
    // [v59 추가] 납부방식별 수금 요약 바 갱신 (실시간 자동)
    updatePaySummaryBar(paySums, cCollected);
}

// [v59 추가] 💳 납부방식별 수금 요약 바 — 완납/일부로 기록된 납부액을 현금/카림/이체/기타(+미지정)별로 자동 합산해 표시
function updatePaySummaryBar(sums, total) {
    const bar = document.getElementById('pay-summary-bar');
    const chips = document.getElementById('pay-summary-chips');
    if (!bar || !chips) return;
    if (!sums) { bar.classList.add('hidden'); chips.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    const dotColors = { cash: '#059669', careem: '#16a34a', transfer: '#2563eb', etc: '#7c3aed', none: '#9ca3af' };
    const chip = (label, amt, color) =>
        `<span class="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded px-2 py-0.5 text-xs font-semibold text-gray-700"><span class="inline-block w-2 h-2 rounded-full" style="background:${color}"></span>${label} <b>${Number(amt).toLocaleString()}</b></span>`;
    let html = '';
    PAY_METHODS.forEach(([v, label]) => {
        const amt = Number(sums[v] || 0);
        if (amt > 0) html += chip(label, amt, dotColors[v]);
    });
    if (Number(sums.none || 0) > 0) html += chip('미지정', sums.none, dotColors.none);
    if (!html) {
        chips.innerHTML = '<span class="text-xs text-emerald-700">아직 수금된 금액이 없습니다. (완납 ●을 누르면 여기에 자동 합산)</span>';
        return;
    }
    html += `<span class="inline-flex items-center gap-1 bg-emerald-600 text-white rounded px-2 py-0.5 text-xs font-bold">합계 ${Number(total || 0).toLocaleString()} Dhs</span>`;
    chips.innerHTML = html;
}

// [추가] 수금 진행바 텍스트/게이지 갱신
function updateCollectBar(done, eligible, collected, remain) {
    if (!collectBar) return;
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('collect-done', done);
    setTxt('collect-total', eligible);
    setTxt('collect-amount', Number(collected || 0).toLocaleString());
    setTxt('collect-remain', remain < 0 ? 0 : remain);
    const fill = document.getElementById('collect-progress-fill');
    if (fill) fill.style.width = (eligible > 0 ? Math.round(done / eligible * 100) : 0) + '%';
}

// [추가] 행 탭 → 완납 토글 (취소 시 미수금). 일부/금액은 이후 드롭다운·입력으로 세부수정 가능
function applyCollectToggle(docId) {
    if (!state.isAdmin) return;
    const log = (state.attendanceLog || []).find(l => l.id === docId);
    if (!log) return;
    let field;
    if (log.paymentStatus === '●') {
        log.paymentStatus = '';
        log.paymentAmount = 0;
        field = { paymentStatus: '', paymentAmount: 0 };
    } else {
        const fee = computeFee(log.name, !!log.grass);
        log.paymentStatus = '●';
        log.paymentAmount = fee;
        field = { paymentStatus: '●', paymentAmount: fee };
    }
    renderForDate();
    if (window._collectSave) window._collectSave(docId, field);
}

// [v58 추가] ➕ 기타 수입 로그 렌더 (incomes 컬렉션 — 후원금·이월금 등)
function renderExtraIncomeLog(logs) {
    const body = document.getElementById('extra-income-log-body');
    const foot = document.getElementById('extra-income-log-foot');
    if (!body || !foot) return;
    body.innerHTML = '';
    foot.innerHTML = '';
    const sorted = (logs || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    if (sorted.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">기타 수입 기록이 없습니다.</td></tr>`;
        return;
    }
    let total = 0;
    sorted.forEach(log => {
        total += Number(log.amount || 0);
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        row.innerHTML = `
            <td data-label="날짜" class="py-2 px-4">${log.date || ''}</td>
            <td data-label="항목" class="py-2 px-4 font-medium text-gray-900">${window.esc(log.item || '')}</td>
            <td data-label="금액" class="py-2 px-4">${Number(log.amount || 0).toLocaleString()}</td>
            <td data-label="관리"><button data-id="${log.id}" class="delete-extra-income-btn text-red-500 hover:underline admin-control" ${!state.isAdmin ? 'disabled' : ''}>삭제</button></td>
        `;
        body.appendChild(row);
    });
    foot.innerHTML = `<tr><td colspan="2" class="py-2 px-4 text-right">합계</td><td class="py-2 px-4 font-bold">${total.toLocaleString()}</td><td></td></tr>`;
}

// [v58 추가] 기타 수입 입력 (지출과 동일한 형태 · incomes 컬렉션에 저장)
async function handleExtraIncomeSubmit(e) {
    e.preventDefault();
    if (!state.isAdmin) { window.showNotification('관리자만 입력할 수 있습니다.', 'error'); return; }
    const dateEl = document.getElementById('extra-income-date');
    const itemEl = document.getElementById('extra-income-item');
    const amountEl = document.getElementById('extra-income-amount');
    const item = itemEl.value.trim();
    const amount = amountEl.value;
    if (!item || !amount) { window.showNotification('항목과 금액을 모두 입력해주세요.', 'error'); return; }
    try {
        await addDoc(collection(db, "incomes"), {
            item,
            amount: Number(amount),
            date: dateEl.value || attendanceDate.value || localDateStr(),
            createdAt: serverTimestamp()
        });
        window.showNotification('기타 수입이 추가되었습니다.');
        itemEl.value = ''; amountEl.value = '';
    } catch (error) {
        console.error("Error adding extra income: ", error);
        window.showNotification('기타 수입 추가에 실패했습니다. (Firestore의 incomes 규칙 확인)', 'error');
    }
}

// [v59 추가] 지출 로그 정렬 UI 갱신 — PC 헤더 화살표 + 모바일 정렬 버튼 활성 표시
function updateExpenseSortUI() {
    document.querySelectorAll('#expense-log-head .expense-sort-ind').forEach(el => {
        if (el.dataset.ind === expenseSortKey) {
            el.textContent = expenseSortDir === 1 ? '▲' : '▼';
            el.classList.remove('text-gray-400');
            el.classList.add('text-indigo-600');
        } else {
            el.textContent = '⇅';
            el.classList.add('text-gray-400');
            el.classList.remove('text-indigo-600');
        }
    });
    document.querySelectorAll('#expense-sort-mobile .expense-sort-mbtn').forEach(btn => {
        const on = (btn.dataset.sort || null) === expenseSortKey || (!btn.dataset.sort && !expenseSortKey);
        btn.classList.toggle('bg-indigo-600', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('border-indigo-600', on);
        btn.classList.toggle('bg-white', !on);
        if (on && btn.dataset.sort) btn.textContent = btn.textContent.replace(/ [▲▼]$/, '') + (expenseSortDir === 1 ? ' ▲' : ' ▼');
        else btn.textContent = btn.textContent.replace(/ [▲▼]$/, '');
    });
}

// [v59 추가] 정렬 키 토글: 같은 컬럼 클릭 시 오름차순 → 내림차순 → 기본(최신 등록순) 순환
function toggleExpenseSort(key) {
    if (!key) { expenseSortKey = null; expenseSortDir = 1; }
    else if (expenseSortKey === key) {
        if (expenseSortDir === 1) expenseSortDir = -1;
        else { expenseSortKey = null; expenseSortDir = 1; }
    } else { expenseSortKey = key; expenseSortDir = 1; }
    renderExpenseLog(state.expenseLog || []);
}

function renderExpenseLog(logs) {
    if(!expenseLogBody) return;
    expenseLogBody.innerHTML = '';
    expenseLogFoot.innerHTML = '';

    // [v59 수정] 정렬 상태에 따라 정렬 (기본: 최신 등록순 / 헤더 클릭: 해당 컬럼 오름·내림차순)
    const sortedLogs = (logs || []).slice().sort((a, b) => {
        if (!expenseSortKey) return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        let r = 0;
        if (expenseSortKey === 'date') r = String(a.date || '').localeCompare(String(b.date || ''));
        else if (expenseSortKey === 'item') r = String(a.item || '').localeCompare(String(b.item || ''), 'ko-KR');
        else if (expenseSortKey === 'amount') r = Number(a.amount || 0) - Number(b.amount || 0);
        if (r === 0) r = (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
        return r * expenseSortDir;
    });
    updateExpenseSortUI(); // [v59] 헤더 화살표(▲▼)·모바일 버튼 상태 갱신

    if (sortedLogs.length === 0) {
        expenseLogBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">해당 기간의 지출 로그가 없습니다.</td></tr>`;
        return;
    }

    let totalAmount = 0;
    sortedLogs.forEach(log => {
        totalAmount += log.amount;
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        row.innerHTML = `
            <td data-label="날짜" class="py-2 px-4">${log.date}</td>
            <td data-label="항목" class="py-2 px-4 font-medium text-gray-900">${log.item}</td>
            <td data-label="금액" class="py-2 px-4">${log.amount.toLocaleString()}</td>
            <td data-label="관리"><button data-id="${log.id}" class="delete-expense-btn text-red-500 hover:underline admin-control" ${!state.isAdmin ? 'disabled' : ''}>삭제</button></td>
        `;
        expenseLogBody.appendChild(row);
    });
    expenseLogFoot.innerHTML = `<tr><td colspan="2" class="py-2 px-4 text-right">조회 기간 합계</td><td class="py-2 px-4 font-bold">${totalAmount.toLocaleString()}</td><td></td></tr>`;
}

function switchAccountingTab(activeTab) {
    const tabs = [incomeTabBtn, expenseTabBtn];
    const sections = [incomeLogSection, expenseLogSection];

    tabs.forEach((tab, index) => {
        const isActive = tab === activeTab;
        tab.classList.toggle('active', isActive);
        sections[index].classList.toggle('hidden', !isActive);
    });
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const itemEl = document.getElementById('expense-item');
    const amountEl = document.getElementById('expense-amount');
    const item = itemEl.value.trim();
    const amount = amountEl.value;

    if (!item || !amount) {
        window.showNotification('항목과 금액을 모두 입력해주세요.', 'error');
        return;
    }

    try {
        await addDoc(collection(db, "expenses"), {
            item: item,
            amount: Number(amount),
            date: attendanceDate.value || localDateStr(),
            createdAt: serverTimestamp()
        });
        window.showNotification('지출 내역이 추가되었습니다.');
        expenseForm.reset();
    } catch (error) {
        console.error("Error adding expense: ", error);
        window.showNotification('지출 내역 추가에 실패했습니다.', 'error');
    }
}

function calculateAndRenderTotalBalance() {
    const totalIncome = state.attendanceLog.reduce((sum, log) => sum + Number(log.paymentAmount || 0), 0);
    const totalExtra = (state.extraIncomeLog || []).reduce((sum, log) => sum + Number(log.amount || 0), 0); // [v58] 기타 수입
    const totalExpense = state.expenseLog.reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const balance = totalIncome + totalExtra - totalExpense;
    totalBalanceEl.textContent = `${balance.toLocaleString()} Dhs`;
}

let chartLoad=null;
function renderAccountingChart() {
    if(!accountingChart) return;
    if(document.getElementById('page-accounting')?.classList.contains('hidden'))return;
    if(!window.Chart){
        if(!chartLoad)chartLoad=ensureLibrary('Chart').then(()=>{chartLoad=null;renderAccountingChart();}).catch(()=>{
            chartLoad=null;window.showNotification('차트를 불러오지 못했습니다. 금액·장부는 그대로 확인할 수 있습니다.','error');
        });
        return;
    }
    const ctx = accountingChart.getContext('2d');

    const monthlyData = {};
    const processLog = (log, type) => {
        if (!log.date) return;
        const month = log.date.substring(0, 7);
        monthlyData[month] = (monthlyData[month] || { income: 0, expense: 0 });
        if(type === 'income') monthlyData[month].income += Number(log.paymentAmount || 0);
        else if(type === 'expense') monthlyData[month].expense += log.amount;
    };

    state.attendanceLog.forEach(log => processLog(log, 'income'));
    // [v58] 기타 수입도 월별 수입에 합산 (amount 필드 사용)
    (state.extraIncomeLog || []).forEach(log => {
        if (!log.date) return;
        const month = log.date.substring(0, 7);
        monthlyData[month] = (monthlyData[month] || { income: 0, expense: 0 });
        monthlyData[month].income += Number(log.amount || 0);
    });
    state.expenseLog.forEach(log => processLog(log, 'expense'));

    const sortedMonths = Object.keys(monthlyData).sort().slice(-6);
    const labels = sortedMonths;
    const incomeData = sortedMonths.map(month => monthlyData[month].income);
    const expenseData = sortedMonths.map(month => monthlyData[month].expense);

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: '수입', data: incomeData, backgroundColor: 'rgba(54, 162, 235, 0.6)' },
                { label: '지출', data: expenseData, backgroundColor: 'rgba(255, 99, 132, 0.6)' }
            ]
        },
        options: {
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { labels: { color: 'black' } } }
        }
    });
}

// [전면 개편] 5개 시트(요약·인별집계·월별집계·상세회비·상세지출)로 완성도 높은 엑셀 생성
async function downloadExcel(incomeLogs, expenseLogs, startDate, endDate, extraLogs = []) {
    try {await ensureLibrary('XLSX');}catch(error){window.showNotification(error.message,'error');return;}
    const totalIncome = incomeLogs.reduce((s, l) => s + Number(l.paymentAmount || 0), 0);
    const totalExtra = (extraLogs || []).reduce((s, l) => s + Number(l.amount || 0), 0); // [v58] 기타 수입
    const totalExpense = expenseLogs.reduce((s, l) => s + Number(l.amount || 0), 0);
    const balance = totalIncome + totalExtra - totalExpense;
    const unpaidCount = incomeLogs.filter(l => l.paymentStatus === '✕').length;
    const partialCount = incomeLogs.filter(l => l.paymentStatus === '△').length;

    const wb = XLSX.utils.book_new();

    // 시트1: 요약
    const summaryAoa = [
        ['BareaPlay 회계 요약'],
        ['조회 기간', `${startDate || '전체'} ~ ${endDate || '전체'}`],
        ['생성일', localDateStr()],
        [],
        ['항목', '금액 (Dhs)'],
        ['회비 수입', totalIncome],
        ['기타 수입', totalExtra],
        ['총 수입', totalIncome + totalExtra],
        ['총 지출', totalExpense],
        ['잔액', balance],
        [],
        ['참석 연인원(건)', incomeLogs.length],
        ['미납(✕) 건수', unpaidCount],
        ['일부납부(△) 건수', partialCount],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
    summarySheet['!cols'] = [{ wch: 18 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "요약");

    // 시트2: 인별 집계
    const perPerson = {};
    incomeLogs.forEach(l => {
        const k = l.name || '(이름없음)';
        if (!perPerson[k]) perPerson[k] = { name: k, count: 0, paid: 0, full: 0, partial: 0, unpaid: 0, noshow: 0 };
        perPerson[k].count += 1;
        perPerson[k].paid += Number(l.paymentAmount || 0);
        if (l.paymentStatus === '●') perPerson[k].full += 1;
        else if (l.paymentStatus === '△') perPerson[k].partial += 1;
        else if (l.paymentStatus === '✕') perPerson[k].unpaid += 1;
        else if (l.paymentStatus === NOSHOW) perPerson[k].noshow += 1;
    });
    const perPersonRows = Object.values(perPerson)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))
        .map(p => ({
            '이름': p.name, '참석 횟수': p.count, '총 납부액': p.paid,
            '완납(●)': p.full, '일부(△)': p.partial, '미납(✕)': p.unpaid, '노쇼(N)': p.noshow
        }));
    const perPersonSheet = XLSX.utils.json_to_sheet(perPersonRows.length ? perPersonRows : [{ '이름': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, perPersonSheet, "인별 집계");

    // 시트3: 월별 집계
    const monthly = {};
    incomeLogs.forEach(l => { const m = (l.date || '').substring(0, 7); if (m) { monthly[m] = monthly[m] || { income: 0, expense: 0 }; monthly[m].income += Number(l.paymentAmount || 0); } });
    (extraLogs || []).forEach(l => { const m = (l.date || '').substring(0, 7); if (m) { monthly[m] = monthly[m] || { income: 0, expense: 0 }; monthly[m].income += Number(l.amount || 0); } }); // [v58]
    expenseLogs.forEach(l => { const m = (l.date || '').substring(0, 7); if (m) { monthly[m] = monthly[m] || { income: 0, expense: 0 }; monthly[m].expense += Number(l.amount || 0); } });
    const monthlyRows = Object.keys(monthly).sort().map(m => ({
        '월': m, '수입': monthly[m].income, '지출': monthly[m].expense, '잔액': monthly[m].income - monthly[m].expense
    }));
    const monthlySheet = XLSX.utils.json_to_sheet(monthlyRows.length ? monthlyRows : [{ '월': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, monthlySheet, "월별 집계");

    // 시트4: 상세 - 회비
    const incomeData = incomeLogs
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name, 'ko-KR'))
        .map(log => ({ '날짜': log.date, '이름': log.name, '납부 상태': log.paymentStatus, '납부액': Number(log.paymentAmount || 0), '납부방식': payMethodLabel(log.payMethod), '비고': (log.note && String(log.note).trim()) ? log.note : ((state.playerNotes && state.playerNotes[normName(log.name)]) || '') }));
    const incomeSheet = XLSX.utils.json_to_sheet(incomeData.length ? incomeData : [{ '날짜': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, incomeSheet, "상세-회비");

    // 시트5: 상세 - 지출
    const expenseData = expenseLogs
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(log => ({ '날짜': log.date, '항목': log.item, '금액': Number(log.amount || 0) }));
    const expenseSheet = XLSX.utils.json_to_sheet(expenseData.length ? expenseData : [{ '날짜': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, expenseSheet, "상세-지출");

    // [v58] 시트6: 상세 - 기타 수입
    const extraData = (extraLogs || [])
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(log => ({ '날짜': log.date, '항목': log.item, '금액': Number(log.amount || 0) }));
    const extraSheet = XLSX.utils.json_to_sheet(extraData.length ? extraData : [{ '날짜': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, extraSheet, "상세-기타수입");

    XLSX.writeFile(wb, `BareaPlay_회계_${localDateStr()}.xlsx`);
    window.showNotification("엑셀 파일이 다운로드되었습니다. (6개 시트)");
}

// [추가] 현재 보기 모드: 'day'(선택한 날짜) | 'all'(전체) | 'range'(기간 지정)
let viewMode = 'day';

// [추가] 보기 모드에 따른 실제 조회 범위 계산
function effectiveRange() {
    if (viewMode === 'all') return ['', ''];
    if (viewMode === 'range') return [filterStartDateEl.value, filterEndDateEl.value];
    const d = attendanceDate.value;            // 'day'
    return [d, d];
}

// [추가] 보기 모드 버튼/범위 표시 UI 갱신
function updateViewModeUI() {
    const map = { day: 'view-day-btn', all: 'view-all-btn', range: 'view-range-btn' };
    Object.entries(map).forEach(([mode, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const on = (mode === viewMode);
        btn.classList.toggle('bg-indigo-600', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('text-gray-600', !on);
        btn.classList.toggle('bg-white', !on);
    });
    const picker = document.getElementById('range-picker');
    if (picker) picker.classList.toggle('hidden', viewMode !== 'range');
    // [모바일] '선택한 날짜' 모드에선 상단 제목에 이미 날짜가 있으므로, 카드마다 반복되는 날짜를 숨긴다.
    if (incomeLogSection) incomeLogSection.classList.toggle('mode-day', viewMode === 'day');
    const label = document.getElementById('log-range-label');
    if (label) {
        const [s, e] = effectiveRange();
        if (viewMode === 'all') label.textContent = '— 전체';
        else if (viewMode === 'day') label.textContent = s ? `— ${s}` : '';
        else label.textContent = `— ${s || '처음'} ~ ${e || '끝'}`;
    }
}

export function renderForDate() {
    if(state.accountingReady===false)return;
    const [startDate, endDate] = effectiveRange();

    const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));

    renderAttendanceLogTable(filteredAttendance);
    renderExtraIncomeLog(state.extraIncomeLog || []); // [v58]
    renderExpenseLog(state.expenseLog);

    calculateAndRenderTotalBalance();
    renderAccountingChart();
    populateDateJump();
    updateViewModeUI();

    const selectedDate = attendanceDate.value;
    if(selectedDate) renderFullPlayerChecklist();
}

export function autoFillAttendees(names) {
    state.currentAttendees = names;
    const today = localDateStr();
    attendanceDate.value = today;
    viewMode = 'day';   // 팀배정에서 넘어오면 오늘 날짜 보기로

    renderFullPlayerChecklist();
    renderForDate();
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;
    state.currentAttendees = [];
    if (!state.playerNotes) state.playerNotes = {};
    if (!state.extraIncomeLog) state.extraIncomeLog = []; // [v58] 기타 수입

    const pageElement = document.getElementById('page-accounting');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 space-y-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">출석 기록 관리</h2><button id="admin-login-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1 px-3 rounded-lg">관리자 로그인</button></div><div class="mb-3"><label for="attendance-date" class="block text-md font-semibold text-gray-700 mb-2">날짜 선택</label><input type="date" id="attendance-date" class="w-full p-2 border rounded-lg"></div><div class="mb-3"><select id="record-date-jump" class="w-full p-2 border rounded-lg bg-white text-sm text-gray-700"><option value="">📌 기록 있는 날 바로가기</option></select></div><div class="mb-4"><label class="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer admin-control"><input type="checkbox" id="grass-toggle" class="w-4 h-4 text-emerald-600 rounded"><span class="text-sm font-semibold text-emerald-800">🌱 천연잔디 날 (일반 70 / 학생 35)</span></label><p class="text-xs text-gray-400 mt-1">체크 후 저장하면 이 날의 회비가 천연잔디 금액으로 자동 입력됩니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label class="block text-md font-semibold text-gray-700">참석자 선택</label><div class="space-x-2"><button id="check-all-btn" class="text-xs text-indigo-600 hover:underline admin-control" disabled>모두 선택</button><button id="uncheck-all-btn" class="text-xs text-gray-500 hover:underline admin-control" disabled>모두 해제</button></div></div><div id="attendance-checklist" class="max-h-60 overflow-y-auto border rounded-lg p-3 space-y-2"></div><div class="flex space-x-2 mt-2"><input type="text" id="manual-attendee-name" list="attendee-name-datalist" class="flex-grow bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 admin-control" placeholder="수동 추가 (늦참자·게스트)..."><datalist id="attendee-name-datalist"></datalist><button type="button" id="manual-attendee-add-btn" class="text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-4 py-2 admin-control">추가</button></div></div><button id="record-attendance-btn" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 shadow-lg admin-control" disabled>선택한 날짜 출석 저장</button></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">💰 총 잔액</h2><p id="total-balance" class="text-4xl font-bold text-indigo-600">0 Dhs</p></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📊 월별 요약</h2><div class="w-full"><canvas id="accountingChart"></canvas></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">운영진 공유사항</h2><textarea id="memo-area" class="w-full p-3 border rounded-lg admin-control bg-gray-50" rows="5" placeholder="미납자 정보, 주요 공지 등..." disabled></textarea><p class="text-xs text-gray-500 mt-2">메모는 자동으로 저장됩니다.</p>
    </div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="border-b border-gray-200 mb-4"><nav class="flex -mb-px space-x-6" aria-label="Tabs"><button id="income-tab-btn" class="accounting-tab active text-indigo-600 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💰 회비 (수입)</button><button id="expense-tab-btn" class="accounting-tab text-gray-500 hover:text-gray-700 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💸 지출</button></nav></div><div id="income-log-section"><div class="mb-4"><div class="flex flex-wrap justify-between items-center gap-2 mb-2"><h2 class="text-2xl font-bold">회비 로그 <span id="log-range-label" class="text-base font-normal text-gray-500"></span></h2><div class="flex gap-2"><button id="collect-mode-btn" class="text-sm text-white bg-indigo-600 hover:bg-indigo-700 font-bold py-1.5 px-3 rounded-lg admin-control" disabled>수금 체크</button><button id="accounting-excel-download-btn" class="text-sm text-white bg-green-600 hover:bg-green-700 font-bold py-1.5 px-3 rounded-lg">엑셀</button><button id="delete-range-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1.5 px-3 rounded-lg admin-control" disabled>이 범위 삭제</button></div></div><div class="flex flex-wrap items-center gap-2"><div class="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm"><button id="view-day-btn" class="view-mode-btn px-3 py-1.5 font-medium">선택한 날짜</button><button id="view-all-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">전체</button><button id="view-range-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">기간 지정</button></div><div id="range-picker" class="hidden flex items-center gap-1"><input type="date" id="filter-start-date" class="p-1.5 border rounded-md text-sm bg-white"><span class="text-gray-400">~</span><input type="date" id="filter-end-date" class="p-1.5 border rounded-md text-sm bg-white"><select id="filter-period-select" class="p-1.5 border rounded-md bg-white text-sm"><option value="custom">직접 지정</option><option value="1m">최근 1개월</option><option value="3m">최근 3개월</option><option value="6m">최근 6개월</option><option value="all">전체</option></select></div></div></div><div id="pay-summary-bar" class="hidden mb-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50"><div class="flex flex-wrap items-center gap-2"><span class="text-sm font-bold text-emerald-900">\uD83D\uDCB3 수금 현황</span><div id="pay-summary-chips" class="flex flex-wrap items-center gap-1.5"></div></div><p class="mt-1 text-[11px] text-emerald-700">완납\u00B7일부 납부액이 납부방식별로 자동 합산됩니다. \u2018미지정\u2019은 납부방식 버튼을 아직 안 누른 금액입니다.</p></div><div id="collect-bar" class="hidden mb-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50"><div class="flex flex-wrap items-center justify-between gap-2"><div class="text-sm font-semibold text-indigo-900">걷음 <span id="collect-done">0</span> / <span id="collect-total">0</span>명 · 걷은 금액 <span id="collect-amount">0</span> Dhs · 미수금 <span id="collect-remain">0</span>명</div><button id="collect-hide-btn" class="text-xs font-semibold text-indigo-700 bg-white border border-indigo-300 rounded px-2 py-1">안 낸 사람만 보기</button></div><div class="mt-2 h-2 w-full bg-indigo-100 rounded overflow-hidden"><div id="collect-progress-fill" class="h-full bg-indigo-600 rounded" style="width:0%"></div></div><p class="mt-1.5 text-xs text-indigo-700">표에서 이름 줄을 <b>탭하면 완납</b>(자동 금액)으로 기록됩니다. 다시 탭하면 취소. 일부만 받았으면 상태를 <b>△ 일부</b>로 두고 비고에 상세를 적으세요.</p></div><div class="overflow-x-auto max-h-[80vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">#</th> <th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">이름</th><th scope="col" class="py-3 px-4">납부 상태</th><th scope="col" class="py-3 px-4">납부액</th><th scope="col" class="py-3 px-4">납부방식</th><th scope="col" class="py-3 px-4">비고</th></tr></thead><tbody id="accounting-log-body"></tbody><tfoot id="accounting-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div><div class="mt-6 border-t pt-4"><h3 class="text-lg font-bold mb-1">➕ 기타 수입 <span class="text-sm font-normal text-gray-400">(후원금·이월금 등 회비 외 수입)</span></h3><p class="text-xs text-gray-400 mb-3">여기에 입력한 수입은 총 잔액·월별 차트·엑셀에 자동 반영됩니다. (회비 기록과는 분리 저장)</p><form id="extra-income-form" class="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4 items-end"><div><label for="extra-income-date" class="block text-sm font-medium">날짜</label><input type="date" id="extra-income-date" class="mt-1 w-full p-2 border rounded-lg bg-gray-50"></div><div><label for="extra-income-item" class="block text-sm font-medium">항목</label><input type="text" id="extra-income-item" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" placeholder="예: 후원금 (홍길동)" required></div><div><label for="extra-income-amount" class="block text-sm font-medium">금액</label><input type="number" id="extra-income-amount" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 admin-control" disabled>수입 추가</button></form><div class="overflow-x-auto max-h-[40vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">항목</th><th scope="col" class="py-3 px-4">금액</th><th scope="col" class="py-3 px-4">관리</th></tr></thead><tbody id="extra-income-log-body"></tbody><tfoot id="extra-income-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div></div><div id="expense-log-section" class="hidden"><h2 class="text-2xl font-bold mb-4">지출 로그</h2><form id="expense-form" class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6 items-end"><div class="sm:col-span-2"><label for="expense-item" class="block text-sm font-medium">항목</label><input type="text" id="expense-item" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><div><label for="expense-amount" class="block text-sm font-medium">금액</label><input type="number" id="expense-amount" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><button type="submit" class="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 admin-control" disabled>지출 추가</button></form><div id="expense-sort-mobile" class="md:hidden flex flex-wrap items-center gap-1.5 mb-2"><span class="text-xs font-semibold text-gray-500">정렬:</span><button type="button" data-sort="" class="expense-sort-mbtn text-xs border rounded px-2 py-1">최신 등록</button><button type="button" data-sort="date" class="expense-sort-mbtn text-xs border rounded px-2 py-1">날짜</button><button type="button" data-sort="item" class="expense-sort-mbtn text-xs border rounded px-2 py-1">항목</button><button type="button" data-sort="amount" class="expense-sort-mbtn text-xs border rounded px-2 py-1">금액</button></div><div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm text-left text-gray-500"><thead id="expense-log-head" class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" data-sort="date" class="py-3 px-4 cursor-pointer select-none hover:bg-gray-100" title="클릭해서 정렬">날짜 <span class="expense-sort-ind text-gray-400" data-ind="date">⇅</span></th><th scope="col" data-sort="item" class="py-3 px-4 cursor-pointer select-none hover:bg-gray-100" title="클릭해서 정렬">항목 <span class="expense-sort-ind text-gray-400" data-ind="item">⇅</span></th><th scope="col" data-sort="amount" class="py-3 px-4 cursor-pointer select-none hover:bg-gray-100" title="클릭해서 정렬">금액 <span class="expense-sort-ind text-gray-400" data-ind="amount">⇅</span></th><th scope="col" class="py-3 px-4">관리</th></tr></thead><tbody id="expense-log-body"></tbody><tfoot id="expense-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div></div></div>`;

    attendanceDate = document.getElementById('attendance-date');
    checklistContainer = document.getElementById('attendance-checklist');
    recordBtn = document.getElementById('record-attendance-btn');
    logBody = document.getElementById('accounting-log-body');
    logFoot = document.getElementById('accounting-log-foot');
    memoArea = document.getElementById('memo-area');
    adminLoginBtn = document.getElementById('admin-login-btn');
    memoDoc = doc(db, "memos", "accounting_memo");
    const playerNotesDoc = doc(db, "playerNotes", "all");
    accountingChart = document.getElementById('accountingChart');
    incomeTabBtn = document.getElementById('income-tab-btn');
    expenseTabBtn = document.getElementById('expense-tab-btn');
    incomeLogSection = document.getElementById('income-log-section');
    expenseLogSection = document.getElementById('expense-log-section');
    expenseForm = document.getElementById('expense-form');
    expenseLogBody = document.getElementById('expense-log-body');
    expenseLogFoot = document.getElementById('expense-log-foot');
    checkAllBtn = document.getElementById('check-all-btn');
    uncheckAllBtn = document.getElementById('uncheck-all-btn');
    totalBalanceEl = document.getElementById('total-balance');
    filterStartDateEl = document.getElementById('filter-start-date');
    filterEndDateEl = document.getElementById('filter-end-date');
    filterPeriodSelectEl = document.getElementById('filter-period-select');
    excelDownloadBtn = document.getElementById('accounting-excel-download-btn');
    grassToggle = document.getElementById('grass-toggle');
    recordDateJump = document.getElementById('record-date-jump');
    deleteRangeBtn = document.getElementById('delete-range-btn');
    collectModeBtn = document.getElementById('collect-mode-btn');
    collectBar = document.getElementById('collect-bar');
    collectHideBtn = document.getElementById('collect-hide-btn');

    const today = localDateStr();
    if(attendanceDate) attendanceDate.value = today;

   if(attendanceDate) attendanceDate.addEventListener('change', () => {
        state.currentAttendees = [];
        // 날짜를 바꾸면 자동으로 '선택한 날짜' 보기로 전환 (그 날 기록만 표시)
        viewMode = 'day';
        renderForDate();
    });

    // [추가] 기록 있는 날 바로가기 → 그 날짜 + '선택한 날짜' 보기로 이동
    if (recordDateJump) recordDateJump.addEventListener('change', () => {
        const d = recordDateJump.value;
        if (!d) return;
        state.currentAttendees = [];
        attendanceDate.value = d;
        viewMode = 'day';
        renderForDate();
    });

    // [추가] 보기 모드 버튼 (선택한 날짜 / 전체 / 기간 지정)
    const viewDayBtn = document.getElementById('view-day-btn');
    const viewAllBtn = document.getElementById('view-all-btn');
    const viewRangeBtn = document.getElementById('view-range-btn');
    if (viewDayBtn) viewDayBtn.addEventListener('click', () => { viewMode = 'day'; renderForDate(); });
    if (viewAllBtn) viewAllBtn.addEventListener('click', () => { viewMode = 'all'; renderForDate(); });
    if (viewRangeBtn) viewRangeBtn.addEventListener('click', () => {
        viewMode = 'range';
        if (!filterStartDateEl.value) filterStartDateEl.value = attendanceDate.value;
        if (!filterEndDateEl.value) filterEndDateEl.value = attendanceDate.value;
        renderForDate();
    });

    if(adminLoginBtn) adminLoginBtn.addEventListener('click', window.promptForAdminPassword);
    if(incomeTabBtn) incomeTabBtn.addEventListener('click', () => switchAccountingTab(incomeTabBtn));
    if(expenseTabBtn) expenseTabBtn.addEventListener('click', () => switchAccountingTab(expenseTabBtn));
    if(expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
    // [v59 추가] 지출 로그 정렬 — PC: 헤더 클릭 / 모바일: 정렬 버튼
    const expenseLogHead = document.getElementById('expense-log-head');
    if (expenseLogHead) expenseLogHead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (th) toggleExpenseSort(th.dataset.sort);
    });
    const expenseSortMobile = document.getElementById('expense-sort-mobile');
    if (expenseSortMobile) expenseSortMobile.addEventListener('click', (e) => {
        const btn = e.target.closest('.expense-sort-mbtn');
        if (btn) toggleExpenseSort(btn.dataset.sort || null);
    });
    // [v58] 기타 수입 폼 + 삭제
    const extraIncomeForm = document.getElementById('extra-income-form');
    if (extraIncomeForm) extraIncomeForm.addEventListener('submit', handleExtraIncomeSubmit);
    const extraIncomeBody = document.getElementById('extra-income-log-body');
    if (extraIncomeBody) extraIncomeBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-extra-income-btn');
        if (!btn || !state.isAdmin) return;
        if (confirm('이 기타 수입 내역을 정말 삭제하시겠습니까?')) {
            await deleteDoc(doc(db, 'incomes', btn.dataset.id));
            window.showNotification('기타 수입 내역이 삭제되었습니다.');
        }
    });
    const extraIncomeDate = document.getElementById('extra-income-date');
    if (extraIncomeDate && !extraIncomeDate.value) extraIncomeDate.value = localDateStr();
    if(checkAllBtn) checkAllBtn.addEventListener('click', () => checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true));
    if(uncheckAllBtn) uncheckAllBtn.addEventListener('click', () => checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false));

    if(filterStartDateEl) filterStartDateEl.addEventListener('change', () => { viewMode = 'range'; renderForDate(); });
    if(filterEndDateEl) filterEndDateEl.addEventListener('change', () => { viewMode = 'range'; renderForDate(); });
    if(filterPeriodSelectEl) filterPeriodSelectEl.addEventListener('change', (e) => {
        const period = e.target.value;
        viewMode = 'range';
        const today = new Date();
        let startDate = new Date();
        if (period === 'all') {
            filterStartDateEl.value = '';
            filterEndDateEl.value = '';
        } else if (period === 'custom') {
            // 직접 지정: 입력칸 값을 그대로 사용
        } else {
            if (period === '1m') startDate.setMonth(today.getMonth() - 1);
            else if (period === '3m') startDate.setMonth(today.getMonth() - 3);
            else if (period === '6m') startDate.setMonth(today.getMonth() - 6);
            filterStartDateEl.value = localDateStr(startDate);
            filterEndDateEl.value = localDateStr(today);
        }
        renderForDate();
    });
    excelDownloadBtn.addEventListener('click', () => {
        const [startDate, endDate] = effectiveRange();
        const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        const filteredExpenses = state.expenseLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        const filteredExtra = (state.extraIncomeLog || []).filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate)); // [v58]
        downloadExcel(filteredAttendance, filteredExpenses, startDate, endDate, filteredExtra);
    });

    // [추가] 현재 보기 범위의 회비 기록 전체 삭제
    if (deleteRangeBtn) deleteRangeBtn.addEventListener('click', async () => {
        if (!state.isAdmin) return;
        const [startDate, endDate] = effectiveRange();
        const targets = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        if (targets.length === 0) { window.showNotification('삭제할 회비 기록이 없습니다.', 'error'); return; }
        const rangeText = (startDate || endDate) ? `${startDate || '처음'} ~ ${endDate || '끝'}` : '전체 기간';
        if (!confirm(`[${rangeText}]의 회비 기록 ${targets.length}건을 모두 삭제합니다.\n정말 진행하시겠습니까? (되돌릴 수 없습니다)`)) return;
        try { await saveQueue.flush(); } catch(error) { window.showNotification(error.message,'error');return; }
        const promises = targets.map(log => deleteDoc(doc(db, "attendance", log.id)));
        await Promise.all(promises);
        window.showNotification(`${targets.length}건의 회비 기록이 삭제되었습니다.`);
    });

const manualAttendeeName = document.getElementById('manual-attendee-name');
    const manualAttendeeAddBtn = document.getElementById('manual-attendee-add-btn');

    if (manualAttendeeAddBtn) {
        manualAttendeeAddBtn.addEventListener('click', () => {
            const name = manualAttendeeName.value.trim();
            if (!name) return;

            if (document.getElementById(`check-${name}`)) {
                window.showNotification('이미 목록에 있습니다.', 'error');
                return;
            }

            const div = document.createElement('div');
            div.className = 'flex items-center';
            div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" checked ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900">${name} (수동)</label>`;

            const placeholder = checklistContainer.querySelector('p');
            if (placeholder) placeholder.remove();

            checklistContainer.appendChild(div);
            manualAttendeeName.value = '';
        });
    }
    if(expenseLogBody) {
        expenseLogBody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-expense-btn')) {
                const docId = e.target.dataset.id;
                if (confirm('이 지출 내역을 정말 삭제하시겠습니까?')) {
                    await deleteDoc(doc(db, 'expenses', docId));
                    window.showNotification('지출 내역이 삭제되었습니다.');
                }
            }
        });
    }

    if(recordBtn) recordBtn.addEventListener('click', async () => {
        if(!state.isAdmin || state.accountingReady===false) return;
        const date = attendanceDate.value;
        if (!date) { window.showNotification('날짜를 선택해주세요.', 'error'); return; }
        const isGrass = !!(grassToggle && grassToggle.checked);

        // [수정] 이름을 NFC로 통일해 비교 → 한글 인코딩 차이로 인한 중복 추가 방지
        const checkedBoxes = checklistContainer.querySelectorAll('input[type=checkbox]:checked');
        const currentlyCheckedNames = Array.from(checkedBoxes).map(cb => normName(cb.value));
        const checkedSet = new Set(currentlyCheckedNames);

        // 해당 날짜의 기존 로그를 '정규화된 이름 -> 실제 문서 id 목록'으로 정리
        const existingByName = {};
        state.attendanceLog.filter(log => log.date === date).forEach(log => {
            const key = normName(log.name);
            if (!existingByName[key]) existingByName[key] = [];
            existingByName[key].push(log.id);
        });

        const additions = [];

        // 1) 체크된 이름 중 기존에 없는 것만 새로 추가
        currentlyCheckedNames.forEach(name => {
            if (!existingByName[name]) {
                const docId = `${date}_${name}`;
                // [Q3] 기본값: 운영진 포함 전원 '미납(✕)·0원'으로 불러오기 → 현장에서 수금 체크 탭으로 완납 처리
                //      (직전까지 쓰던 선수별 carry-forward 비고는 그대로 이어받아 표시)
                const carryNote = (state.playerNotes && state.playerNotes[normName(name)]) || '';
                const newLog = { date, name, paymentStatus: '✕', paymentAmount: 0, note: carryNote, grass: isGrass };
                additions.push({ref:doc(db, "attendance", docId),data:newLog});
            }
        });

        // Checklist adds only. Never remove unchecked/duplicate/paid historical records.
        recordBtn.disabled=true;
        try {
            await saveQueue.flush();
            await runTransaction(db,async tx=>{
                const snapshots=await Promise.all(additions.map(item=>tx.get(item.ref)));
                additions.forEach((item,i)=>{if(!snapshots[i].exists())tx.set(item.ref,item.data);});
            });
            const retained=Object.keys(existingByName).filter(name=>!checkedSet.has(name)||existingByName[name].length>1).length;
            window.showNotification(`${date} 체크한 출석을 추가했습니다. 기존 납부·출석 기록은 유지됩니다.${retained?' 체크 해제·중복 기록은 회비표에서 확인하세요.':''}`);
        } catch { window.showNotification('출석을 저장하지 못했습니다. 선택은 유지됩니다. 다시 시도하세요.','error'); }
        finally { recordBtn.disabled=false; }
    });

    const saveStatus=document.createElement('div');
    saveStatus.className='ledger-save-status'; saveStatus.setAttribute('role','status');
    const saveLabel=document.createElement('span'), retry=document.createElement('button');
    retry.type='button'; retry.textContent='다시 저장'; retry.hidden=true; saveLabel.textContent='모든 변경 저장됨';
    saveStatus.append(saveLabel,retry); pageElement.prepend(saveStatus);
    saveQueue=createSaveQueue(async(key,patch)=>{
        if(!state.isAdmin) throw new Error('관리자 로그인이 필요합니다.');
        if(key.startsWith('attendance:')) {
            const ref=doc(db,'attendance',key.slice(11));
            await runTransaction(db,async tx=>{
                const snap=await tx.get(ref);
                if(!snap.exists())throw new Error('기록이 없어 다시 생성하지 않았습니다.');
                tx.set(ref,patch,{merge:true});
            });
        } else if(key.startsWith('note:')) {
            const name=key.slice(5);
            await runTransaction(db,async tx=>{
                const snap=await tx.get(playerNotesDoc), notes={...(snap.exists()?snap.data().notes:{})};
                if(patch.text.trim())notes[name]=patch.text.trim(); else delete notes[name];
                tx.set(playerNotesDoc,{...(snap.exists()?snap.data():{}),notes});
            });
        } else await setDoc(memoDoc,patch,{merge:true});
    },entries=>{
        const failed=entries.some(e=>e.status==='error');
        saveLabel.textContent=failed?'저장 실패 · 변경 내용은 이 화면에 보관 중입니다. 새로고침하지 마세요.':entries.length?`${entries.length}건 저장 중 · 화면을 닫지 마세요`:'모든 변경 저장됨';
        saveStatus.dataset.status=failed?'error':entries.length?'pending':'saved'; retry.hidden=!failed;
        logBody?.querySelectorAll('tr[data-id]').forEach(row=>{
            const item=entries.find(e=>e.key===`attendance:${row.dataset.id}`);
            row.dataset.saveStatus=item?.status||'saved';
            row.title=item?.status==='error'?'저장 실패 · 상단에서 다시 저장':item?'저장 중':'';
        });
    });
    window.flushAccountingSave=()=>saveQueue.flush(); window.hasUnsavedAccounting=()=>saveQueue.dirty();
    retry.onclick=()=>saveQueue.flush().catch(error=>window.showNotification(error.message,'error'));
    const debouncedUpdate=(docId,patch)=>{
        if(!state.isAdmin)return;
        const record=state.attendanceLog.find(log=>log.id===docId); if(record)Object.assign(record,patch);
        saveQueue.enqueue(`attendance:${docId}`,patch);
    };
    window._collectSave=debouncedUpdate;

    // [추가] 수금 체크 모드 토글
    if (collectModeBtn) collectModeBtn.addEventListener('click', () => {
        collectMode = !collectMode;
        collectModeBtn.textContent = collectMode ? '수금 체크 ✓' : '수금 체크';
        collectModeBtn.classList.toggle('bg-indigo-600', !collectMode);
        collectModeBtn.classList.toggle('hover:bg-indigo-700', !collectMode);
        collectModeBtn.classList.toggle('bg-amber-500', collectMode);
        collectModeBtn.classList.toggle('hover:bg-amber-600', collectMode);
        if (collectBar) collectBar.classList.toggle('hidden', !collectMode);
        if (incomeLogSection) incomeLogSection.classList.toggle('collect-mode', collectMode);
        if (!collectMode) {
            collectHidePaid = false;
            if (collectHideBtn) { collectHideBtn.classList.remove('bg-indigo-600', 'text-white'); }
        }
        renderForDate();
    });
    // [추가] 안 낸 사람만 보기
    if (collectHideBtn) collectHideBtn.addEventListener('click', () => {
        collectHidePaid = !collectHidePaid;
        collectHideBtn.classList.toggle('bg-indigo-600', collectHidePaid);
        collectHideBtn.classList.toggle('text-white', collectHidePaid);
        renderForDate();
    });
    // [추가] 수금모드에서 이름 줄 탭 → 완납 토글 (입력/버튼 클릭은 제외)
    if (logBody) logBody.addEventListener('click', (e) => {
        if (!collectMode) return;
        if (e.target.closest('input, select, button, a')) return;
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        applyCollectToggle(row.dataset.id);
    });

    // [추가] 선수별 영구 비고 저장 (내용이 비면 키 삭제 → 다음부터 안 보임)
    const debouncedNoteSave = (name, text) => {
        const key = normName(name);
        if (!key) return;
        const next = { ...(state.playerNotes || {}) };
        const t = (text || '').trim();
        if (t) next[key] = t; else delete next[key];
        state.playerNotes = next;
        saveQueue.enqueue(`note:${key}`,{text:t});
    };

    if(logBody) logBody.addEventListener('change', (e) => {
        const target = e.target;
        const docId = target.dataset.id;
        if (!docId) return;

        let updatedField = {};
        if (target.classList.contains('log-status-select')) {
            updatedField = { paymentStatus: target.value };
            e.target.className = `log-status-select p-1 border rounded-md ${getStatusColor(e.target.value)} admin-control`;
            // [추가] 미납(✕) 또는 노쇼(N) 선택 시 납부액을 자동으로 0 처리 (일부는 건드리지 않음)
            if (target.value === '✕' || target.value === NOSHOW) {
                updatedField.paymentAmount = 0;
                const __row = target.closest('tr');
                const __amt = __row && __row.querySelector('.log-amount-input');
                if (__amt) __amt.value = 0;
            }
            // [v58 추가] 완납(●) 선택 시 회비유형·구장에 맞는 금액 자동 입력 (수금 체크 탭과 동일 규칙)
            //            자동 입력 후에도 납부액 칸에서 직접 수정할 수 있습니다.
            if (target.value === '●') {
                const __rec = (state.attendanceLog || []).find(l => l.id === docId);
                const __fee = computeFee(__rec ? __rec.name : '', !!(__rec && __rec.grass));
                updatedField.paymentAmount = __fee;
                if (__rec) { __rec.paymentStatus = '●'; __rec.paymentAmount = __fee; }
                const __row2 = target.closest('tr');
                const __amt2 = __row2 && __row2.querySelector('.log-amount-input');
                if (__amt2) __amt2.value = __fee;
            }
        }
        else if (target.classList.contains('log-amount-input')) updatedField = { paymentAmount: target.value };
        else if (target.classList.contains('log-note-input')) {
            // [Q4] 비고를 '날짜별 기록(과거 보존)' + '선수별 carry-forward(다음에 자동표시)' 두 곳에 동시 저장.
            //      → 이번 날짜에서 지워도 그 날짜 문서의 note만 비고, 과거 날짜의 note는 그대로 보존됨.
            //        동시에 carry-forward 메모도 갱신되어, 비우면 다음 모임부터는 자동표시가 멈춤.
            if (docId) debouncedUpdate(docId, { note: target.value });
            debouncedNoteSave(target.dataset.name || '', target.value);
            return;
        }

        if (Object.keys(updatedField).length > 0) debouncedUpdate(docId, updatedField);
    });

    // [v58 추가] 💳 납부방식 칩 탭 → 저장 (같은 칩을 다시 탭하면 해제)
    if (logBody) logBody.addEventListener('click', (e) => {
        const b = e.target.closest('.pay-method-btn');
        if (!b) return;
        if (!state.isAdmin) return;
        e.stopPropagation(); // 수금모드 행 탭(완납 토글)과 충돌 방지
        const docId = b.dataset.id;
        const method = b.dataset.method;
        if (!docId || !method) return;
        const rec = (state.attendanceLog || []).find(l => l.id === docId);
        const next = (rec && rec.payMethod === method) ? '' : method;
        if (rec) rec.payMethod = next;
        renderForDate();
        if (window._collectSave) window._collectSave(docId, { payMethod: next });
    });

    // [추가] 회비 로그 행별 삭제 (이름 옆 ✕ 버튼)
    if(logBody) logBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-log-btn');
        if (!btn) return;
        if (!state.isAdmin) return;
        const docId = btn.dataset.id;
        if (!docId) return;
        const row = btn.closest('tr');
        const nameText = row ? row.querySelector('td[data-label="이름"]').textContent.replace('✕', '').trim() : '';
        if (confirm(`'${nameText}' 회비 기록을 삭제하시겠습니까?`)) {
            try { await saveQueue.flush(); } catch(error) { window.showNotification(error.message,'error'); return; }
            await deleteDoc(doc(db, "attendance", docId));
            window.showNotification('회비 기록이 삭제되었습니다.');
        }
    });

    const debouncedMemoSave = content => {if(state.isAdmin)saveQueue.enqueue('memo',{content});};

    if(memoArea) memoArea.addEventListener('input', () => debouncedMemoSave(memoArea.value));

    // [추가] 선수별 영구 비고 실시간 동기화
    const isEditingHere = () => {
        const el = document.activeElement;
        return el && pageElement.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    };
    onSnapshot(playerNotesDoc, (snap) => {
        state.playerNotes = (snap.exists() && snap.data().notes) ? snap.data().notes : {};
        if (!isEditingHere() && !pageElement.classList.contains('hidden')) {
            renderForDate();
        }
    });

    // [v58] 과거 기록 이관 버튼(setupMigration)은 이관 완료 후 제거되었습니다.
    //       이미 이관된 attendance/expenses 데이터(mig 태그)는 그대로 유지됩니다.
}
