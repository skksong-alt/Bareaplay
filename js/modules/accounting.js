// js/modules/accounting.js
import { doc, getDocs, collection, setDoc, deleteDoc, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
let attendanceDate, checklistContainer, recordBtn, logBody, logFoot, memoArea, adminLoginBtn, accountingChart;
let incomeTabBtn, expenseTabBtn, incomeLogSection, expenseLogSection, expenseForm, expenseLogBody, expenseLogFoot;
let totalBalanceEl, filterStartDateEl, filterEndDateEl, filterPeriodSelectEl, excelDownloadBtn;
let checkAllBtn, uncheckAllBtn;
let grassToggle, recordDateJump;
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
        // 인코딩 차이로 못 찾을 때를 대비해 정규화 비교로 한 번 더 탐색
        const found = Object.keys(state.playerDB).find(k => normName(k) === key);
        if (found) p = state.playerDB[found];
    }
    const type = (p && p.feeType) ? p.feeType : 'normal';
    if (type === 'admin') return 0;
    if (type === 'student') return isGrass ? 35 : 25;
    return isGrass ? 70 : 50;
}

function getStatusColor(status) {
    switch (status) {
        case "●": return "bg-green-100 text-green-800";
        case "△": return "bg-yellow-100 text-yellow-800";
        case "✕": return "bg-red-100 text-red-800";
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
        div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" ${isChecked ? 'checked' : ''} ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900">${name}</label>`;
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

    const sortedLogs = logs.sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));

    if (sortedLogs.length === 0) {
        logBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">해당 기간의 출석 로그가 없습니다.</td></tr>`;
        return;
    }

    let totalAmount = 0;
    sortedLogs.forEach((log, index) => {
        totalAmount += Number(log.paymentAmount || 0);
        const docId = log.id;
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        row.innerHTML = `
            <td data-label="#" class="py-2 px-4 font-medium text-gray-700">${index + 1}</td> <td data-label="날짜" class="py-2 px-4">${log.date}</td>
            <td data-label="이름" class="py-2 px-4 font-medium text-gray-900">${log.name}</td>
            <td data-label="납부 상태"><select data-id="${docId}" class="log-status-select p-1 border rounded-md ${getStatusColor(log.paymentStatus)} admin-control" ${!state.isAdmin ? 'disabled': ''}><option value="" ${!log.paymentStatus ? 'selected' : ''}></option><option value="●" ${log.paymentStatus === '●' ? 'selected' : ''}>● 완납</option><option value="△" ${log.paymentStatus === '△' ? 'selected' : ''}>△ 일부</option><option value="✕" ${log.paymentStatus === '✕' ? 'selected' : ''}>✕ 미납</option></select></td>
            <td data-label="납부액"><input type="number" data-id="${docId}" class="log-amount-input w-24 p-1 border rounded-md admin-control" placeholder="납부액" value="${log.paymentAmount || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
            <td data-label="비고"><input type="text" data-id="${docId}" class="log-note-input w-full p-1 border rounded-md admin-control" placeholder="비고 입력..." value="${log.note || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
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
        if (!perPerson[k]) perPerson[k] = { name: k, count: 0, paid: 0, full: 0, partial: 0, unpaid: 0 };
        perPerson[k].count += 1;
        perPerson[k].paid += Number(l.paymentAmount || 0);
        if (l.paymentStatus === '●') perPerson[k].full += 1;
        else if (l.paymentStatus === '△') perPerson[k].partial += 1;
        else if (l.paymentStatus === '✕') perPerson[k].unpaid += 1;
    });
    const perPersonRows = Object.values(perPerson)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))
        .map(p => ({
            '이름': p.name, '참석 횟수': p.count, '총 납부액': p.paid,
            '완납(●)': p.full, '일부(△)': p.partial, '미납(✕)': p.unpaid
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
        .map(log => ({ '날짜': log.date, '이름': log.name, '납부 상태': log.paymentStatus, '납부액': Number(log.paymentAmount || 0), '비고': log.note || '' }));
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

export function renderForDate() {
    const startDate = filterStartDateEl.value;
    const endDate = filterEndDateEl.value;

    const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));

    renderAttendanceLogTable(filteredAttendance);
    renderExpenseLog(state.expenseLog);

    calculateAndRenderTotalBalance();
    renderAccountingChart();
    populateDateJump();

    const selectedDate = attendanceDate.value;
    if(selectedDate) renderFullPlayerChecklist();
}

export function autoFillAttendees(names) {
    state.currentAttendees = names;
    const today = localDateStr();
    attendanceDate.value = today;

    filterStartDateEl.value = today;
    filterEndDateEl.value = today;
    filterPeriodSelectEl.value = 'all';

    renderFullPlayerChecklist();
    renderForDate();
}

export function init(dependencies) {
    db = dependencies.db;
    state = dependencies.state;
    state.currentAttendees = [];

    const pageElement = document.getElementById('page-accounting');
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 space-y-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">출석 기록 관리</h2><button id="admin-login-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1 px-3 rounded-lg">관리자 로그인</button></div><div class="mb-3"><label for="attendance-date" class="block text-md font-semibold text-gray-700 mb-2">날짜 선택</label><input type="date" id="attendance-date" class="w-full p-2 border rounded-lg"></div><div class="mb-3"><select id="record-date-jump" class="w-full p-2 border rounded-lg bg-white text-sm text-gray-700"><option value="">📌 기록 있는 날 바로가기</option></select></div><div class="mb-4"><label class="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer admin-control"><input type="checkbox" id="grass-toggle" class="w-4 h-4 text-emerald-600 rounded"><span class="text-sm font-semibold text-emerald-800">🌱 천연잔디 날 (일반 70 / 학생 35)</span></label><p class="text-xs text-gray-400 mt-1">체크 후 저장하면 이 날의 회비가 천연잔디 금액으로 자동 입력됩니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label class="block text-md font-semibold text-gray-700">참석자 선택</label><div class="space-x-2"><button id="check-all-btn" class="text-xs text-indigo-600 hover:underline admin-control" disabled>모두 선택</button><button id="uncheck-all-btn" class="text-xs text-gray-500 hover:underline admin-control" disabled>모두 해제</button></div></div><div id="attendance-checklist" class="max-h-60 overflow-y-auto border rounded-lg p-3 space-y-2"></div><div class="flex space-x-2 mt-2"><input type="text" id="manual-attendee-name" class="flex-grow bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 admin-control" placeholder="수동 추가..."><button type="button" id="manual-attendee-add-btn" class="text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-4 py-2 admin-control">추가</button></div></div><button id="record-attendance-btn" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 shadow-lg admin-control" disabled>선택한 날짜 출석 저장</button></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">💰 총 잔액</h2><p id="total-balance" class="text-4xl font-bold text-indigo-600">0 Dhs</p></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📊 월별 요약</h2><div class="w-full"><canvas id="accountingChart"></canvas></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">Remark / 특정 메모</h2><textarea id="memo-area" class="w-full p-3 border rounded-lg admin-control bg-gray-50" rows="5" placeholder="미납자 정보, 주요 공지 등..." disabled></textarea><p class="text-xs text-gray-500 mt-2">메모는 자동으로 저장됩니다.</p>
        <div class="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <div>
                <label for="filter-start-date" class="block text-sm font-medium text-gray-700 mb-1">조회 기간</label>
                <div class="grid grid-cols-2 gap-2">
                    <input type="date" id="filter-start-date" class="p-2 border rounded-md w-full text-sm bg-white">
                    <input type="date" id="filter-end-date" class="p-2 border rounded-md w-full text-sm bg-white">
                </div>
            </div>
            <div>
                <select id="filter-period-select" class="p-2 border rounded-md bg-white w-full text-sm">
                    <option value="all">전체 기간</option>
                    <option value="1m">최근 1개월</option>
                    <option value="3m">최근 3개월</option>
                    <option value="6m">최근 6개월</option>
                </select>
            </div>
            <button id="excel-download-btn" class="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">엑셀 다운로드</button>
        </div>
    </div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="border-b border-gray-200 mb-4"><nav class="flex -mb-px space-x-6" aria-label="Tabs"><button id="income-tab-btn" class="accounting-tab active text-indigo-600 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💰 회비 (수입)</button><button id="expense-tab-btn" class="accounting-tab text-gray-500 hover:text-gray-700 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💸 지출</button></nav></div><div id="income-log-section"><h2 class="text-2xl font-bold mb-4">회비 로그</h2><div class="overflow-x-auto max-h-[80vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">#</th> <th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">이름</th><th scope="col" class="py-3 px-4">납부 상태</th><th scope="col" class="py-3 px-4">납부액</th><th scope="col" class="py-3 px-4">비고</th></tr></thead><tbody id="accounting-log-body"></tbody><tfoot id="accounting-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div><div id="expense-log-section" class="hidden"><h2 class="text-2xl font-bold mb-4">지출 로그</h2><form id="expense-form" class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6 items-end"><div class="sm:col-span-2"><label for="expense-item" class="block text-sm font-medium">항목</label><input type="text" id="expense-item" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><div><label for="expense-amount" class="block text-sm font-medium">금액</label><input type="number" id="expense-amount" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><button type="submit" class="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 admin-control" disabled>지출 추가</button></form><div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">항목</th><th scope="col" class="py-3 px-4">금액</th><th scope="col" class="py-3 px-4">관리</th></tr></thead><tbody id="expense-log-body"></tbody><tfoot id="expense-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div></div></div>`;

    attendanceDate = document.getElementById('attendance-date');
    checklistContainer = document.getElementById('attendance-checklist');
    recordBtn = document.getElementById('record-attendance-btn');
    logBody = document.getElementById('accounting-log-body');
    logFoot = document.getElementById('accounting-log-foot');
    memoArea = document.getElementById('memo-area');
    adminLoginBtn = document.getElementById('admin-login-btn');
    memoDoc = doc(db, "memos", "accounting_memo");
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

    const today = localDateStr();
    if(attendanceDate) attendanceDate.value = today;

   if(attendanceDate) attendanceDate.addEventListener('change', () => {
        state.currentAttendees = [];
        const selectedDate = attendanceDate.value;
        filterStartDateEl.value = selectedDate;
        filterEndDateEl.value = selectedDate;
        renderForDate();
    });

    // [추가] 기록 있는 날 바로가기
    if (recordDateJump) recordDateJump.addEventListener('change', () => {
        const d = recordDateJump.value;
        if (!d) return;
        state.currentAttendees = [];
        attendanceDate.value = d;
        filterStartDateEl.value = d;
        filterEndDateEl.value = d;
        renderForDate();
    });

    if(adminLoginBtn) adminLoginBtn.addEventListener('click', window.promptForAdminPassword);
    if(incomeTabBtn) incomeTabBtn.addEventListener('click', () => switchAccountingTab(incomeTabBtn));
    if(expenseTabBtn) expenseTabBtn.addEventListener('click', () => switchAccountingTab(expenseTabBtn));
    if(expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
    if(checkAllBtn) checkAllBtn.addEventListener('click', () => checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true));
    if(uncheckAllBtn) uncheckAllBtn.addEventListener('click', () => checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false));

    filterStartDateEl.addEventListener('change', renderForDate);
    filterEndDateEl.addEventListener('change', renderForDate);
    filterPeriodSelectEl.addEventListener('change', (e) => {
        const period = e.target.value;
        const today = new Date();
        let startDate = new Date();
        if (period === 'all') {
            filterStartDateEl.value = '';
            filterEndDateEl.value = '';
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
        const startDate = filterStartDateEl.value;
        const endDate = filterEndDateEl.value;
        const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        const filteredExpenses = state.expenseLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        downloadExcel(filteredAttendance, filteredExpenses, startDate, endDate);
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

    if(logBody) logBody.addEventListener('change', (e) => {
        const target = e.target;
        const docId = target.dataset.id;
        if (!docId) return;

        let updatedField = {};
        if (target.classList.contains('log-status-select')) {
            updatedField = { paymentStatus: target.value };
            e.target.className = `log-status-select p-1 border rounded-md ${getStatusColor(e.target.value)} admin-control`;
        }
        else if (target.classList.contains('log-amount-input')) updatedField = { paymentAmount: target.value };
        else if (target.classList.contains('log-note-input')) updatedField = { note: target.value };

        if (Object.keys(updatedField).length > 0) debouncedUpdate(docId, updatedField);
    });

    const debouncedMemoSave = window.debounce(async (content) => {
        await setDoc(memoDoc, { content });
        window.showNotification('메모가 저장되었습니다.', 'success');
    }, 1000);

    if(memoArea) memoArea.addEventListener('input', () => debouncedMemoSave(memoArea.value));
}
