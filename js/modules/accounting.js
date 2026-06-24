// js/modules/accounting.js
import { doc, getDocs, collection, setDoc, deleteDoc, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
let attendanceDate, checklistContainer, recordBtn, logBody, logFoot, memoArea, adminLoginBtn, accountingChart;
let incomeTabBtn, expenseTabBtn, incomeLogSection, expenseLogSection, expenseForm, expenseLogBody, expenseLogFoot;
let totalBalanceEl, filterStartDateEl, filterEndDateEl, filterPeriodSelectEl, excelDownloadBtn;
let checkAllBtn, uncheckAllBtn;
let grassToggle, recordDateJump, deleteRangeBtn;
let chartInstance = null;
let memoDoc;

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

// [추가] 노쇼(통보 없이 불참) 상태 표식 — 회비/패널티 계산엔 영향 없음, 누적 통계용
const NOSHOW = 'N';
// [추가] 특정 선수의 누적 노쇼 횟수 (전체 기간)
function noShowCount(name) {
    const key = normName(name);
    return (state.attendanceLog || []).filter(l => normName(l.name) === key && l.paymentStatus === NOSHOW).length;
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
    const selectedDate = attendanceDate.value;

    const loggedAttendees = state.attendanceLog
                                .filter(log => log.date === selectedDate)
                                .map(log => log.name);
    const loggedAttendeesSet = new Set(loggedAttendees.map(normName));

    let playerNames;
    let checkStatusSet;

    if (state.currentAttendees && state.currentAttendees.length > 0) {
        playerNames = [...state.currentAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
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

    const sortedLogs = logs.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name, 'ko-KR'));

    if (sortedLogs.length === 0) {
        logBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">해당 기간의 출석 로그가 없습니다.</td></tr>`;
        return;
    }

    let totalAmount = 0;
    sortedLogs.forEach((log, index) => {
        totalAmount += Number(log.paymentAmount || 0);
        const docId = log.id;
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        const __nc = noShowCount(log.name);
        const __badge = __nc > 0 ? ` <span class="text-xs font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded" title="누적 노쇼 횟수">노쇼 ${__nc}</span>` : '';
        // [추가] 이름 옆 ✕ 버튼으로 이 한 건만 삭제
        row.innerHTML = `
            <td data-label="#" class="py-2 px-4 font-medium text-gray-700">${index + 1}</td> <td data-label="날짜" class="py-2 px-4">${log.date}</td>
            <td data-label="이름" class="py-2 px-4 font-medium text-gray-900">${log.name}${__badge}<button data-id="${docId}" class="delete-log-btn ml-2 text-red-500 hover:text-red-700 font-bold admin-control" title="이 기록 삭제" ${!state.isAdmin ? 'disabled' : ''}>✕</button></td>
            <td data-label="납부 상태"><select data-id="${docId}" class="log-status-select p-1 border rounded-md ${getStatusColor(log.paymentStatus)} admin-control" ${!state.isAdmin ? 'disabled': ''}><option value="" ${!log.paymentStatus ? 'selected' : ''}></option><option value="●" ${log.paymentStatus === '●' ? 'selected' : ''}>● 완납</option><option value="△" ${log.paymentStatus === '△' ? 'selected' : ''}>△ 일부</option><option value="✕" ${log.paymentStatus === '✕' ? 'selected' : ''}>✕ 미납</option><option value="N" ${log.paymentStatus === NOSHOW ? 'selected' : ''}>N 노쇼</option></select></td>
            <td data-label="납부액"><input type="number" data-id="${docId}" class="log-amount-input w-24 p-1 border rounded-md admin-control" placeholder="납부액" value="${log.paymentAmount || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
            <td data-label="비고"><input type="text" data-id="${docId}" data-name="${window.esc(log.name)}" class="log-note-input w-full p-1 border rounded-md admin-control" placeholder="비고 입력..." value="${window.esc((state.playerNotes && state.playerNotes[normName(log.name)]) || '')}" ${!state.isAdmin ? 'disabled': ''}></td>
        `;
        logBody.appendChild(row);
    });
    logFoot.innerHTML = `<tr><td colspan="4" class="py-2 px-4 text-right">조회 기간 합계</td><td class="py-2 px-4 font-bold">${totalAmount.toLocaleString()}</td><td class="py-2 px-4"></td></tr>`;
}

function renderExpenseLog(logs) {
    if(!expenseLogBody) return;
    expenseLogBody.innerHTML = '';
    expenseLogFoot.innerHTML = '';

    const sortedLogs = logs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

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
    const totalExpense = state.expenseLog.reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const balance = totalIncome - totalExpense;
    totalBalanceEl.textContent = `${balance.toLocaleString()} Dhs`;
}

function renderAccountingChart() {
    if(!accountingChart) return;
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
function downloadExcel(incomeLogs, expenseLogs, startDate, endDate) {
    const totalIncome = incomeLogs.reduce((s, l) => s + Number(l.paymentAmount || 0), 0);
    const totalExpense = expenseLogs.reduce((s, l) => s + Number(l.amount || 0), 0);
    const balance = totalIncome - totalExpense;
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
        ['총 수입 (회비)', totalIncome],
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
    expenseLogs.forEach(l => { const m = (l.date || '').substring(0, 7); if (m) { monthly[m] = monthly[m] || { income: 0, expense: 0 }; monthly[m].expense += Number(l.amount || 0); } });
    const monthlyRows = Object.keys(monthly).sort().map(m => ({
        '월': m, '수입': monthly[m].income, '지출': monthly[m].expense, '잔액': monthly[m].income - monthly[m].expense
    }));
    const monthlySheet = XLSX.utils.json_to_sheet(monthlyRows.length ? monthlyRows : [{ '월': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, monthlySheet, "월별 집계");

    // 시트4: 상세 - 회비
    const incomeData = incomeLogs
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name, 'ko-KR'))
        .map(log => ({ '날짜': log.date, '이름': log.name, '납부 상태': log.paymentStatus, '납부액': Number(log.paymentAmount || 0), '비고': (state.playerNotes && state.playerNotes[normName(log.name)]) || log.note || '' }));
    const incomeSheet = XLSX.utils.json_to_sheet(incomeData.length ? incomeData : [{ '날짜': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, incomeSheet, "상세-회비");

    // 시트5: 상세 - 지출
    const expenseData = expenseLogs
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(log => ({ '날짜': log.date, '항목': log.item, '금액': Number(log.amount || 0) }));
    const expenseSheet = XLSX.utils.json_to_sheet(expenseData.length ? expenseData : [{ '날짜': '데이터 없음' }]);
    XLSX.utils.book_append_sheet(wb, expenseSheet, "상세-지출");

    XLSX.writeFile(wb, `BareaPlay_회계_${localDateStr()}.xlsx`);
    window.showNotification("엑셀 파일이 다운로드되었습니다. (5개 시트)");
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
    // [모바일] '선택한 날짜' 모드에서는 상단 제목에 이미 날짜가 있으므로, 카드마다 중복되는 날짜를 숨긴다.
    const incomeSection = document.getElementById('income-log-section');
    if (incomeSection) incomeSection.classList.toggle('mode-day', viewMode === 'day');
    const label = document.getElementById('log-range-label');
    if (label) {
        const [s, e] = effectiveRange();
        if (viewMode === 'all') label.textContent = '— 전체';
        else if (viewMode === 'day') label.textContent = s ? `— ${s}` : '';
        else label.textContent = `— ${s || '처음'} ~ ${e || '끝'}`;
    }
}

export function renderForDate() {
    const [startDate, endDate] = effectiveRange();

    const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));

    renderAttendanceLogTable(filteredAttendance);
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

    const pageElement = document.getElementById('page-accounting');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 space-y-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">출석 기록 관리</h2><button id="admin-login-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1 px-3 rounded-lg">관리자 로그인</button></div><div class="mb-3"><label for="attendance-date" class="block text-md font-semibold text-gray-700 mb-2">날짜 선택</label><input type="date" id="attendance-date" class="w-full p-2 border rounded-lg"></div><div class="mb-3"><select id="record-date-jump" class="w-full p-2 border rounded-lg bg-white text-sm text-gray-700"><option value="">📌 기록 있는 날 바로가기</option></select></div><div class="mb-4"><label class="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer admin-control"><input type="checkbox" id="grass-toggle" class="w-4 h-4 text-emerald-600 rounded"><span class="text-sm font-semibold text-emerald-800">🌱 천연잔디 날 (일반 70 / 학생 35)</span></label><p class="text-xs text-gray-400 mt-1">체크 후 저장하면 이 날의 회비가 천연잔디 금액으로 자동 입력됩니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label class="block text-md font-semibold text-gray-700">참석자 선택</label><div class="space-x-2"><button id="check-all-btn" class="text-xs text-indigo-600 hover:underline admin-control" disabled>모두 선택</button><button id="uncheck-all-btn" class="text-xs text-gray-500 hover:underline admin-control" disabled>모두 해제</button></div></div><div id="attendance-checklist" class="max-h-60 overflow-y-auto border rounded-lg p-3 space-y-2"></div><div class="flex space-x-2 mt-2"><input type="text" id="manual-attendee-name" class="flex-grow bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 admin-control" placeholder="수동 추가..."><button type="button" id="manual-attendee-add-btn" class="text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-4 py-2 admin-control">추가</button></div></div><button id="record-attendance-btn" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 shadow-lg admin-control" disabled>선택한 날짜 출석 저장</button></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">💰 총 잔액</h2><p id="total-balance" class="text-4xl font-bold text-indigo-600">0 Dhs</p></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📊 월별 요약</h2><div class="w-full"><canvas id="accountingChart"></canvas></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">Remark / 특정 메모</h2><textarea id="memo-area" class="w-full p-3 border rounded-lg admin-control bg-gray-50" rows="5" placeholder="미납자 정보, 주요 공지 등..." disabled></textarea><p class="text-xs text-gray-500 mt-2">메모는 자동으로 저장됩니다.</p>
    </div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="border-b border-gray-200 mb-4"><nav class="flex -mb-px space-x-6" aria-label="Tabs"><button id="income-tab-btn" class="accounting-tab active text-indigo-600 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💰 회비 (수입)</button><button id="expense-tab-btn" class="accounting-tab text-gray-500 hover:text-gray-700 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💸 지출</button></nav></div><div id="income-log-section"><div class="mb-4"><div class="flex flex-wrap justify-between items-center gap-2 mb-2"><h2 class="text-2xl font-bold">회비 로그 <span id="log-range-label" class="text-base font-normal text-gray-500"></span></h2><div class="flex gap-2"><button id="excel-download-btn" class="text-sm text-white bg-green-600 hover:bg-green-700 font-bold py-1.5 px-3 rounded-lg">엑셀</button><button id="delete-range-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1.5 px-3 rounded-lg admin-control" disabled>이 범위 삭제</button></div></div><div class="flex flex-wrap items-center gap-2"><div class="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm"><button id="view-day-btn" class="view-mode-btn px-3 py-1.5 font-medium">선택한 날짜</button><button id="view-all-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">전체</button><button id="view-range-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">기간 지정</button></div><div id="range-picker" class="hidden flex items-center gap-1"><input type="date" id="filter-start-date" class="p-1.5 border rounded-md text-sm bg-white"><span class="text-gray-400">~</span><input type="date" id="filter-end-date" class="p-1.5 border rounded-md text-sm bg-white"><select id="filter-period-select" class="p-1.5 border rounded-md bg-white text-sm"><option value="custom">직접 지정</option><option value="1m">최근 1개월</option><option value="3m">최근 3개월</option><option value="6m">최근 6개월</option><option value="all">전체</option></select></div></div></div><div class="overflow-x-auto max-h-[80vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">#</th> <th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">이름</th><th scope="col" class="py-3 px-4">납부 상태</th><th scope="col" class="py-3 px-4">납부액</th><th scope="col" class="py-3 px-4">비고</th></tr></thead><tbody id="accounting-log-body"></tbody><tfoot id="accounting-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div><div id="expense-log-section" class="hidden"><h2 class="text-2xl font-bold mb-4">지출 로그</h2><form id="expense-form" class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6 items-end"><div class="sm:col-span-2"><label for="expense-item" class="block text-sm font-medium">항목</label><input type="text" id="expense-item" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><div><label for="expense-amount" class="block text-sm font-medium">금액</label><input type="number" id="expense-amount" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><button type="submit" class="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 admin-control" disabled>지출 추가</button></form><div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">항목</th><th scope="col" class="py-3 px-4">금액</th><th scope="col" class="py-3 px-4">관리</th></tr></thead><tbody id="expense-log-body"></tbody><tfoot id="expense-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div></div></div>`;

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
    excelDownloadBtn = document.getElementById('excel-download-btn');
    grassToggle = document.getElementById('grass-toggle');
    recordDateJump = document.getElementById('record-date-jump');
    deleteRangeBtn = document.getElementById('delete-range-btn');

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
        downloadExcel(filteredAttendance, filteredExpenses, startDate, endDate);
    });

    // [추가] 현재 보기 범위의 회비 기록 전체 삭제
    if (deleteRangeBtn) deleteRangeBtn.addEventListener('click', async () => {
        if (!state.isAdmin) return;
        const [startDate, endDate] = effectiveRange();
        const targets = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        if (targets.length === 0) { window.showNotification('삭제할 회비 기록이 없습니다.', 'error'); return; }
        const rangeText = (startDate || endDate) ? `${startDate || '처음'} ~ ${endDate || '끝'}` : '전체 기간';
        if (!confirm(`[${rangeText}]의 회비 기록 ${targets.length}건을 모두 삭제합니다.\n정말 진행하시겠습니까? (되돌릴 수 없습니다)`)) return;
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

        const promises = [];

        // 1) 체크된 이름 중 기존에 없는 것만 새로 추가
        currentlyCheckedNames.forEach(name => {
            if (!existingByName[name]) {
                const docId = `${date}_${name}`;
                const fee = computeFee(name, isGrass);
                const newLog = { date, name, paymentStatus: '●', paymentAmount: fee, note: '', grass: isGrass };
                promises.push(setDoc(doc(db, "attendance", docId), newLog));
            }
        });

        // 2) 기존 로그 정리: 체크 해제된 사람은 '실제 문서 id'로 전부 삭제,
        //    체크돼 있는데 중복 문서가 있으면 1개만 남기고 삭제(기존 중복 자동 정리)
        Object.keys(existingByName).forEach(name => {
            const ids = existingByName[name];
            if (!checkedSet.has(name)) {
                ids.forEach(id => promises.push(deleteDoc(doc(db, "attendance", id))));
            } else if (ids.length > 1) {
                ids.slice(1).forEach(id => promises.push(deleteDoc(doc(db, "attendance", id))));
            }
        });

        await Promise.all(promises);
        window.showNotification(`${date} 출석 현황이 저장되었습니다.${isGrass ? ' (천연잔디 금액 적용)' : ''}`);
    });

    const debouncedUpdate = window.debounce(async (docId, updatedField) => {
        await setDoc(doc(db, "attendance", docId), updatedField, { merge: true });
    }, 500);

    // [추가] 선수별 영구 비고 저장 (내용이 비면 키 삭제 → 다음부터 안 보임)
    const debouncedNoteSave = window.debounce(async (name, text) => {
        const key = normName(name);
        if (!key) return;
        const next = { ...(state.playerNotes || {}) };
        const t = (text || '').trim();
        if (t) next[key] = t; else delete next[key];
        state.playerNotes = next;
        try {
            await setDoc(playerNotesDoc, { notes: next });
        } catch (e) {
            console.error("비고 저장 실패:", e);
            window.showNotification("비고 저장에 실패했습니다.", "error");
        }
    }, 600);

    if(logBody) logBody.addEventListener('change', (e) => {
        const target = e.target;
        const docId = target.dataset.id;
        if (!docId) return;

        let updatedField = {};
        if (target.classList.contains('log-status-select')) {
            updatedField = { paymentStatus: target.value };
            e.target.className = `log-status-select p-1 border rounded-md ${getStatusColor(e.target.value)} admin-control`;
            // [추가] 미납(✕) 또는 노쇼(N) 선택 시 납부액을 자동으로 0 처리 (완납/일부는 건드리지 않음)
            if (target.value === '✕' || target.value === NOSHOW) {
                updatedField.paymentAmount = 0;
                const __row = target.closest('tr');
                const __amt = __row && __row.querySelector('.log-amount-input');
                if (__amt) __amt.value = 0;
            }
        }
        else if (target.classList.contains('log-amount-input')) updatedField = { paymentAmount: target.value };
        else if (target.classList.contains('log-note-input')) {
            // [변경] 비고는 날짜별이 아니라 '선수별 영구 메모'로 저장 → 다른 경기날에도 자동 표시
            debouncedNoteSave(target.dataset.name || '', target.value);
            return;
        }

        if (Object.keys(updatedField).length > 0) debouncedUpdate(docId, updatedField);
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
            await deleteDoc(doc(db, "attendance", docId));
            window.showNotification('회비 기록이 삭제되었습니다.');
        }
    });

    const debouncedMemoSave = window.debounce(async (content) => {
        await setDoc(memoDoc, { content });
        window.showNotification('메모가 저장되었습니다.', 'success');
    }, 1000);

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
}
