// js/modules/accounting.js
import { doc, getDocs, collection, setDoc, deleteDoc, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
let attendanceDate, checklistContainer, recordBtn, logBody, logFoot, memoArea, adminLoginBtn, accountingChart;
let incomeTabBtn, expenseTabBtn, incomeLogSection, expenseLogSection, expenseForm, expenseLogBody, expenseLogFoot;
let totalBalanceEl, filterStartDateEl, filterEndDateEl, filterPeriodSelectEl, excelDownloadBtn;
let checkAllBtn, uncheckAllBtn;
let chartInstance = null;
let memoDoc;

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
    
    // 1. 해당 날짜에 이미 저장된 출석 로그를 가져옵니다.
    const loggedAttendees = state.attendanceLog
                                .filter(log => log.date === selectedDate)
                                .map(log => log.name);
    const loggedAttendeesSet = new Set(loggedAttendees);

    let playerNames;
    let checkStatusSet;

    if (state.currentAttendees && state.currentAttendees.length > 0) {
        // Case A: '팀 배정기'에서 방금 명단을 생성한 경우
        playerNames = [...state.currentAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = new Set(playerNames); // 이 명단 기준으로 체크
    } else {
        // Case B: 날짜를 변경했거나, '팀 배정기'를 거치지 않은 경우
        // 해당 날짜의 로그를 기반으로 명단을 구성합니다. (로그가 없으면 빈 배열)
        playerNames = [...loggedAttendees].sort((a, b) => a.localeCompare(b, 'ko-KR'));
        checkStatusSet = loggedAttendeesSet; // 로그 기준(loggedAttendeesSet)으로 체크
    }

    // 3. 체크리스트를 렌더링합니다.
    if (playerNames.length === 0) {
        // [수정] 전체 선수를 불러오는 대신 안내 메시지를 표시합니다.
        checklistContainer.innerHTML = '<p class="text-gray-500 text-sm">표시할 참석자가 없습니다.<br>팀 배정기에서 명단을 가져오거나, 다른 날짜를 선택해주세요.</p>';
        return;
    }

    playerNames.forEach(name => {
        const isChecked = checkStatusSet.has(name); // 결정된 세트(checkStatusSet)를 기준으로 체크 여부 판단
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" ${isChecked ? 'checked' : ''} ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900">${name}</label>`;
        checklistContainer.appendChild(div);
    });
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
        // [수정] 모바일 뷰를 위해 각 td에 data-label 속성 추가
        row.innerHTML = `
            <td data-label="#" class="py-2 px-4 font-medium text-gray-700">${index + 1}</td> <td data-label="날짜" class="py-2 px-4">${log.date}</td>
            <td data-label="이름" class="py-2 px-4 font-medium text-gray-900">${log.name}</td>
            <td data-label="납부 상태"><select data-id="${docId}" class="log-status-select p-1 border rounded-md ${getStatusColor(log.paymentStatus)} admin-control" ${!state.isAdmin ? 'disabled': ''}><option value="" ${!log.paymentStatus ? 'selected' : ''}></option><option value="●" ${log.paymentStatus === '●' ? 'selected' : ''}>● 완납</option><option value="△" ${log.paymentStatus === '△' ? 'selected' : ''}>△ 일부</option><option value="✕" ${log.paymentStatus === '✕' ? 'selected' : ''}>✕ 미납</option></select></td>
            <td data-label="납부액"><input type="number" data-id="${docId}" class="log-amount-input w-24 p-1 border rounded-md admin-control" value="${log.paymentAmount || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
            <td data-label="비고"><input type="text" data-id="${docId}" class="log-note-input w-full p-1 border rounded-md admin-control" value="${log.note || ''}" ${!state.isAdmin ? 'disabled': ''}></td>
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
        // [수정] 모바일 뷰를 위해 각 td에 data-label 속성 추가
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
            date: new Date().toISOString().split('T')[0],
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

function downloadExcel(incomeLogs, expenseLogs) {
    const incomeData = incomeLogs.map(log => ({
        '날짜': log.date, '이름': log.name, '납부 상태': log.paymentStatus, '납부액': Number(log.paymentAmount), '비고': log.note
    }));
    const expenseData = expenseLogs.map(log => ({
        '날짜': log.date, '항목': log.item, '금액': log.amount
    }));
    
    const wb = XLSX.utils.book_new();
    const incomeSheet = XLSX.utils.json_to_sheet(incomeData);
    const expenseSheet = XLSX.utils.json_to_sheet(expenseData);

    XLSX.utils.book_append_sheet(wb, incomeSheet, "수입 내역");
    XLSX.utils.book_append_sheet(wb, expenseSheet, "지출 내역");

    XLSX.writeFile(wb, `BareaPlay_회계_${new Date().toISOString().split('T')[0]}.xlsx`);
    window.showNotification("엑셀 파일이 다운로드되었습니다.");
}

export function renderForDate() {
    const startDate = filterStartDateEl.value;
    const endDate = filterEndDateEl.value;
    
    const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
    
    renderAttendanceLogTable(filteredAttendance);
    renderExpenseLog(state.expenseLog);
    
    calculateAndRenderTotalBalance();
    renderAccountingChart();

    const selectedDate = attendanceDate.value;
    if(selectedDate) renderFullPlayerChecklist();
}

export function autoFillAttendees(names) {
    state.currentAttendees = names;
    const today = new Date().toISOString().split('T')[0];
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
// [수정] 이 코드 블록 전체를 복사하여 pageElement.innerHTML = ...; 부분을 통째로 붙여넣으세요.
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 space-y-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">출석 기록 관리</h2><button id="admin-login-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1 px-3 rounded-lg">관리자 로그인</button></div><div class="mb-4"><label for="attendance-date" class="block text-md font-semibold text-gray-700 mb-2">날짜 선택</label><input type="date" id="attendance-date" class="w-full p-2 border rounded-lg"></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label class="block text-md font-semibold text-gray-700">참석자 선택</label><div class="space-x-2"><button id="check-all-btn" class="text-xs text-indigo-600 hover:underline admin-control" disabled>모두 선택</button><button id="uncheck-all-btn" class="text-xs text-gray-500 hover:underline admin-control" disabled>모두 해제</button></div></div><div id="attendance-checklist" class="max-h-60 overflow-y-auto border rounded-lg p-3 space-y-2"></div><div class="flex space-x-2 mt-2"><input type="text" id="manual-attendee-name" class="flex-grow bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 admin-control" placeholder="수동 추가..."><button type="button" id="manual-attendee-add-btn" class="text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-4 py-2 admin-control">추가</button></div></div><button id="record-attendance-btn" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 shadow-lg admin-control" disabled>선택한 날짜 출석 저장</button></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">💰 총 잔액</h2><p id="total-balance" class="text-4xl font-bold text-indigo-600">0 Dhs</p></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📊 월별 요약</h2><div class="w-full"><canvas id="accountingChart"></canvas></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">Remark / 특정 메모</h2><textarea id="memo-area" class="w-full p-3 border rounded-lg admin-control bg-gray-50" rows="5" placeholder="미납자 정보, 주요 공지 등..." disabled></textarea><p class="text-xs text-gray-500 mt-2">메모는 자동으로 저장됩니다.</p>
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
    
    const today = new Date().toISOString().split('T')[0];
    if(attendanceDate) attendanceDate.value = today;

   if(attendanceDate) attendanceDate.addEventListener('change', () => {
        state.currentAttendees = [];
        const selectedDate = attendanceDate.value;
        filterStartDateEl.value = selectedDate;
        filterEndDateEl.value = selectedDate;
        // filterPeriodSelectEl.value = 'all'; // <-- 이 줄을 삭제하거나 주석 처리합니다.
        renderForDate(); // 이제 renderForDate()가 올바른 날짜로 필터링합니다.
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
            filterStartDateEl.value = startDate.toISOString().split('T')[0];
            filterEndDateEl.value = today.toISOString().split('T')[0];
        }
        renderForDate();
    });
    excelDownloadBtn.addEventListener('click', () => {
        const startDate = filterStartDateEl.value;
        const endDate = filterEndDateEl.value;
        const filteredAttendance = state.attendanceLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        const filteredExpenses = state.expenseLog.filter(log => (!startDate || log.date >= startDate) && (!endDate || log.date <= endDate));
        downloadExcel(filteredAttendance, filteredExpenses);
    });
const manualAttendeeName = document.getElementById('manual-attendee-name');
    const manualAttendeeAddBtn = document.getElementById('manual-attendee-add-btn');

    if (manualAttendeeAddBtn) {
        manualAttendeeAddBtn.addEventListener('click', () => {
            const name = manualAttendeeName.value.trim();
            if (!name) return;

            // 이미 목록에 있는지 확인
            if (document.getElementById(`check-${name}`)) {
                window.showNotification('이미 목록에 있습니다.', 'error');
                return;
            }

            // 새 체크박스 생성
            const div = document.createElement('div');
            div.className = 'flex items-center';
            div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" checked ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900">${name} (수동)</label>`;
            
            // 목록이 비어있었다면 안내 문구 제거
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
        const checkedBoxes = checklistContainer.querySelectorAll('input[type=checkbox]:checked');
        const currentlyCheckedNames = new Set(Array.from(checkedBoxes).map(cb => cb.value));
        const alreadyLoggedNames = new Set(state.attendanceLog.filter(log => log.date === date).map(log => log.name));
        const promises = [];
        currentlyCheckedNames.forEach(name => {
            if (!alreadyLoggedNames.has(name)) {
                const docId = `${date}_${name}`;
                const newLog = { date, name, paymentStatus: '●', paymentAmount: '50', note: '' };
                promises.push(setDoc(doc(db, "attendance", docId), newLog));
            }
        });
        alreadyLoggedNames.forEach(name => {
            if (!currentlyCheckedNames.has(name)) {
                promises.push(deleteDoc(doc(db, "attendance", `${date}_${name}`)));
            }
        });
        await Promise.all(promises);
        window.showNotification(`${date} 출석 현황이 저장되었습니다.`);
    });

    const debouncedUpdate = window.debounce(async (docId, updatedField) => {
        await setDoc(doc(db, "attendance", docId), updatedField, { merge: true });
    }, 500);

    // [수정] 한글 입력 문제를 해결하기 위해 'input' 이벤트를 'change' 이벤트로 변경
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