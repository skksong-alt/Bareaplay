// js/modules/accounting.js
import { doc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
let attendanceDate, checklistContainer, recordBtn, logBody, logFoot, memoArea, adminLoginBtn, accountingChart;
let incomeTabBtn, expenseTabBtn, incomeLogSection, expenseLogSection, expenseForm, expenseLogBody, expenseLogFoot;
let totalBalanceEl, filterStartDateEl, filterEndDateEl, filterPeriodSelectEl, excelDownloadBtn;
let chartInstance = null;
let memoDoc;

function getStatusColor(status) {
    switch (status) {
        case "●": return "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100";
        case "△": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100";
        case "✕": return "bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100";
        default: return "bg-gray-100 dark:bg-gray-700";
    }
}

function renderFullPlayerChecklist() {
    if (!checklistContainer) return;
    checklistContainer.innerHTML = '';
    const selectedDate = attendanceDate.value;
    const attendeesForDate = new Set(state.attendanceLog.filter(log => log.date === selectedDate).map(log => log.name));
    const playerNames = Object.keys(state.playerDB).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    playerNames.forEach(name => {
        const isChecked = attendeesForDate.has(name);
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" ${isChecked ? 'checked' : ''} ${!state.isAdmin ? 'disabled' : ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900 dark:text-gray-300">${name}</label>`;
        checklistContainer.appendChild(div);
    });
}

function renderAttendanceLogTable(selectedDate) {
    if(!logBody) return;
    logBody.innerHTML = '';
    logFoot.innerHTML = '';
    const logsForDate = state.attendanceLog.filter(log => log.date === selectedDate).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
    if (logsForDate.length === 0) {
        logBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500 dark:text-gray-400">선택된 날짜의 출석 로그가 없습니다.</td></tr>`;
        return;
    }

    let totalAmount = 0;
    logsForDate.forEach((log) => {
        totalAmount += Number(log.paymentAmount || 0);
        const docId = log.id;
        const row = document.createElement('tr');
        row.className = 'bg-white dark:bg-gray-800 border-b dark:border-gray-700';
        row.innerHTML = `<td class="py-2 px-4">${log.date}</td><td class="py-2 px-4 font-medium text-gray-900 dark:text-gray-100">${log.name}</td><td class="py-2 px-4"><select data-id="${docId}" class="log-status-select p-1 border rounded-md ${getStatusColor(log.paymentStatus)} admin-control dark:border-gray-600" ${!state.isAdmin ? 'disabled': ''}><option value="" ${!log.paymentStatus ? 'selected' : ''}></option><option value="●" ${log.paymentStatus === '●' ? 'selected' : ''}>● 완납</option><option value="△" ${log.paymentStatus === '△' ? 'selected' : ''}>△ 일부</option><option value="✕" ${log.paymentStatus === '✕' ? 'selected' : ''}>✕ 미납</option></select></td><td class="py-2 px-4"><input type="number" data-id="${docId}" class="log-amount-input w-24 p-1 border rounded-md admin-control dark:bg-gray-700 dark:border-gray-600" value="${log.paymentAmount || ''}" ${!state.isAdmin ? 'disabled': ''}></td><td class="py-2 px-4"><input type="text" data-id="${docId}" class="log-note-input w-full p-1 border rounded-md admin-control dark:bg-gray-700 dark:border-gray-600" value="${log.note || ''}" ${!state.isAdmin ? 'disabled': ''}></td>`;
        logBody.appendChild(row);
    });
    logFoot.innerHTML = `<tr><td colspan="3" class="py-2 px-4 text-right">합계</td><td class="py-2 px-4">${totalAmount.toLocaleString()}</td><td class="py-2 px-4"></td></tr>`;
}


// ▼▼▼ MAJOR UPGRADE: 지출 관리 및 차트 기능 ▼▼▼
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
    const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
    
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

function renderExpenseLog() {
    if(!expenseLogBody) return;
    expenseLogBody.innerHTML = '';
    expenseLogFoot.innerHTML = '';
    
    const sortedExpenses = [...state.expenseLog].sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
    if (sortedExpenses.length === 0) {
        expenseLogBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500 dark:text-gray-400">지출 로그가 없습니다.</td></tr>`;
        return;
    }
    
    let totalAmount = 0;
    sortedExpenses.forEach(log => {
        totalAmount += log.amount;
        const row = document.createElement('tr');
        row.className = 'bg-white dark:bg-gray-800 border-b dark:border-gray-700';
        row.innerHTML = `<td class="py-2 px-4">${log.date}</td><td class="py-2 px-4 font-medium text-gray-900 dark:text-gray-100">${log.item}</td><td class="py-2 px-4">${log.amount.toLocaleString()}</td><td class="py-2 px-4"><button data-id="${log.id}" class="delete-expense-btn text-red-500 hover:underline admin-control" ${!state.isAdmin ? 'disabled' : ''}>삭제</button></td>`;
        expenseLogBody.appendChild(row);
    });
    expenseLogFoot.innerHTML = `<tr><td colspan="2" class="py-2 px-4 text-right">합계</td><td class="py-2 px-4">${totalAmount.toLocaleString()}</td><td></td></tr>`;
}

function renderAccountingChart() {
    if(!accountingChart) return;
    const ctx = accountingChart.getContext('2d');
    
    const monthlyData = {};
    const processLog = (log, type) => {
        const month = log.date.substring(0, 7);
        monthlyData[month] = (monthlyData[month] || { income: 0, expense: 0 });
        if(type === 'income') monthlyData[month].income += Number(log.paymentAmount || 0);
        else if(type === 'expense') monthlyData[month].expense += log.amount;
    };

    state.attendanceLog.forEach(log => processLog(log, 'income'));
    state.expenseLog.forEach(log => processLog(log, 'expense'));

    const sortedMonths = Object.keys(monthlyData).sort().slice(-6); // 최근 6개월
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
            plugins: { legend: { labels: { color: state.isDarkMode ? 'white' : 'black' } } }
        }
    });
}

export function renderForDate() {
    const selectedDate = attendanceDate.value;
    if (!selectedDate) return;
    renderAttendanceLogTable(selectedDate);
    renderFullPlayerChecklist();
    renderExpenseLog();
    renderAccountingChart();
}

export function autoFillAttendees(names) {
    const today = new Date().toISOString().split('T')[0];
    attendanceDate.value = today;
    checklistContainer.innerHTML = '';
    names.sort((a, b) => a.localeCompare(b, 'ko-KR')).forEach(name => {
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `<input id="check-${name}" type="checkbox" value="${name}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 admin-control" checked ${!state.isAdmin ? 'disabled': ''}><label for="check-${name}" class="ml-2 text-sm font-medium text-gray-900 dark:text-gray-300">${name}</label>`;
        checklistContainer.appendChild(div);
    });
    renderAttendanceLogTable(today);
    window.showNotification('참석자 명단이 출석부로 자동 채워졌습니다.', 'success');
}

export function init(firestoreDB, globalState) {
    db = firestoreDB;
    state = globalState;

    // DOM 요소 할당
    attendanceDate = document.getElementById('attendance-date');
    checklistContainer = document.getElementById('attendance-checklist');
    recordBtn = document.getElementById('record-attendance-btn');
    logBody = document.getElementById('accounting-log-body');
    logFoot = document.getElementById('accounting-log-foot');
    memoArea = document.getElementById('memo-area');
    adminLoginBtn = document.getElementById('admin-login-btn');
    memoDoc = doc(db, "memos", "accounting_memo");
    
    // 업그레이드된 기능의 DOM 요소 할당
    accountingChart = document.getElementById('accountingChart');
    incomeTabBtn = document.getElementById('income-tab-btn');
    expenseTabBtn = document.getElementById('expense-tab-btn');
    incomeLogSection = document.getElementById('income-log-section');
    expenseLogSection = document.getElementById('expense-log-section');
    expenseForm = document.getElementById('expense-form');
    expenseLogBody = document.getElementById('expense-log-body');
    expenseLogFoot = document.getElementById('expense-log-foot');
    const checkAllBtn = document.getElementById('check-all-btn');
    const uncheckAllBtn = document.getElementById('uncheck-all-btn');
    const today = new Date().toISOString().split('T')[0];
    if(attendanceDate) attendanceDate.value = today;

    // 이벤트 리스너 등록
    if(attendanceDate) attendanceDate.addEventListener('change', renderForDate);
    if(adminLoginBtn) adminLoginBtn.addEventListener('click', window.promptForAdminPassword);
    if(incomeTabBtn) incomeTabBtn.addEventListener('click', () => switchAccountingTab(incomeTabBtn));
    if(expenseTabBtn) expenseTabBtn.addEventListener('click', () => switchAccountingTab(expenseTabBtn));
    if(expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
    if(checkAllBtn) checkAllBtn.addEventListener('click', () => {
        checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    });
    if(uncheckAllBtn) uncheckAllBtn.addEventListener('click', () => {
        checklistContainer.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    });

    if(expenseLogBody) {
        expenseLogBody.addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-expense-btn')) {
                const docId = e.target.dataset.id;
                if (confirm('이 지출 내역을 정말 삭제하시겠습니까?')) {
                    const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
                    await deleteDoc(doc(db, 'expenses', docId));
                    window.showNotification('지출 내역이 삭제되었습니다.');
                }
            }
        });
    }

    if(recordBtn) recordBtn.addEventListener('click', async () => {
        const { setDoc, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
        const date = attendanceDate.value;
        if (!date) { window.showNotification('날짜를 선택해주세요.', 'error'); return; }
        const checkedBoxes = checklistContainer.querySelectorAll('input[type=checkbox]:checked');
        const currentlyCheckedNames = new Set(Array.from(checkedBoxes).map(cb => cb.value));
        const alreadyLoggedNames = new Set(state.attendanceLog.filter(log => log.date === date).map(log => log.name));
        const promises = [];
        currentlyCheckedNames.forEach(name => {
            if (!alreadyLoggedNames.has(name)) {
                const docId = `${date}_${name}`;
                const newLog = { date, name, paymentStatus: '●', paymentAmount: '5000', note: '' };
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
        
        // 데이터가 변경되었으므로 수동으로 다시 불러와서 화면 업데이트
        const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
        const attendanceSnapshot = await getDocs(collection(db, "attendance"));
        state.attendanceLog = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderForDate();
    });

    const debouncedUpdate = window.debounce(async (docId, updatedField) => {
        const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
        await setDoc(doc(db, "attendance", docId), updatedField, { merge: true });
    }, 500);

    if(logBody) logBody.addEventListener('input', (e) => {
        const target = e.target;
        const docId = target.dataset.id;
        if (!docId) return;
        let updatedField = {};
        if (target.classList.contains('log-status-select')) updatedField = { paymentStatus: target.value };
        else if (target.classList.contains('log-amount-input')) updatedField = { paymentAmount: target.value };
        else if (target.classList.contains('log-note-input')) updatedField = { note: target.value };
        if (Object.keys(updatedField).length > 0) debouncedUpdate(docId, updatedField);
    });

    if(logBody) logBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('log-status-select')) {
            e.target.className = `log-status-select p-1 border rounded-md ${getStatusColor(e.target.value)} admin-control dark:border-gray-600`;
        }
    });

    const debouncedMemoSave = window.debounce(async (content) => {
        const { setDoc } = await import("https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js");
        await setDoc(memoDoc, { content });
        window.showNotification('메모가 저장되었습니다.', 'success');
    }, 1000);
    
    if(memoArea) memoArea.addEventListener('input', () => debouncedMemoSave(memoArea.value));
}