// js/modules/accounting.js
import { doc, getDocs, collection, setDoc, deleteDoc, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
let db, state;
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

    const sortedLogs = logs.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name, 'ko-KR'));

    if (sortedLogs.length === 0) {
        logBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">해당 기간의 출석 로그가 없습니다.</td></tr>`;
        updateCollectBar(0, 0, 0, 0);
        return;
    }

    let totalAmount = 0;
    // [추가] 수금 현황 집계
    let cPaid = 0, cPartial = 0, cNoshow = 0, cCollected = 0;
    // [추가] 운영진(무료) 제외한 '실제 수금 대상' 집계 → 진행바가 운영진 때문에 부풀지 않게
    let payEligible = 0, payDone = 0;
    sortedLogs.forEach((log, index) => {
        totalAmount += Number(log.paymentAmount || 0);
        const st = log.paymentStatus;
        if (st === '●') cPaid++;
        else if (st === '△') cPartial++;
        else if (st === NOSHOW) cNoshow++;
        if (st === '●' || st === '△') cCollected += Number(log.paymentAmount || 0);
        // 노쇼·운영진(무료)은 수금 대상에서 제외
        if (st !== NOSHOW && feeTypeOf(log.name) !== 'admin') {
            payEligible++;
            if (st === '●' || st === '△') payDone++;
        }

        // [추가] 수금모드 '안 낸 사람만 보기': 완납/일부/노쇼는 숨김
        if (collectMode && collectHidePaid && (st === '●' || st === '△' || st === NOSHOW)) return;

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
            <td data-label="비고"><input type="text" data-id="${docId}" data-name="${window.esc(log.name)}" class="log-note-input w-full p-1 border rounded-md admin-control" placeholder="비고 입력..." value="${window.esc((log.note && String(log.note).trim()) ? log.note : ((state.playerNotes && state.playerNotes[normName(log.name)]) || ''))}" ${!state.isAdmin ? 'disabled': ''}></td>
        `;
        logBody.appendChild(row);
    });
    logFoot.innerHTML = `<tr><td colspan="4" class="py-2 px-4 text-right">조회 기간 합계</td><td class="py-2 px-4 font-bold">${totalAmount.toLocaleString()}</td><td class="py-2 px-4"></td></tr>`;

    // [추가] 수금 진행바 갱신 (노쇼·운영진 제외한 실제 수금 대상 기준)
    updateCollectBar(payDone, payEligible, cCollected, payEligible - payDone);
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
        .map(log => ({ '날짜': log.date, '이름': log.name, '납부 상태': log.paymentStatus, '납부액': Number(log.paymentAmount || 0), '비고': (log.note && String(log.note).trim()) ? log.note : ((state.playerNotes && state.playerNotes[normName(log.name)]) || '') }));
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
    pageElement.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-1 space-y-8"><div class="bg-white p-6 rounded-2xl shadow-lg"><div class="flex justify-between items-center mb-4 border-b pb-2"><h2 class="text-2xl font-bold">출석 기록 관리</h2><button id="admin-login-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1 px-3 rounded-lg">관리자 로그인</button></div><div class="mb-3"><label for="attendance-date" class="block text-md font-semibold text-gray-700 mb-2">날짜 선택</label><input type="date" id="attendance-date" class="w-full p-2 border rounded-lg"></div><div class="mb-3"><select id="record-date-jump" class="w-full p-2 border rounded-lg bg-white text-sm text-gray-700"><option value="">📌 기록 있는 날 바로가기</option></select></div><div class="mb-4"><label class="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer admin-control"><input type="checkbox" id="grass-toggle" class="w-4 h-4 text-emerald-600 rounded"><span class="text-sm font-semibold text-emerald-800">🌱 천연잔디 날 (일반 70 / 학생 35)</span></label><p class="text-xs text-gray-400 mt-1">체크 후 저장하면 이 날의 회비가 천연잔디 금액으로 자동 입력됩니다.</p></div><div class="mb-4"><div class="flex justify-between items-center mb-2"><label class="block text-md font-semibold text-gray-700">참석자 선택</label><div class="space-x-2"><button id="check-all-btn" class="text-xs text-indigo-600 hover:underline admin-control" disabled>모두 선택</button><button id="uncheck-all-btn" class="text-xs text-gray-500 hover:underline admin-control" disabled>모두 해제</button></div></div><div id="attendance-checklist" class="max-h-60 overflow-y-auto border rounded-lg p-3 space-y-2"></div><div class="flex space-x-2 mt-2"><input type="text" id="manual-attendee-name" class="flex-grow bg-gray-50 border border-gray-300 text-sm rounded-lg p-2 admin-control" placeholder="수동 추가..."><button type="button" id="manual-attendee-add-btn" class="text-white bg-indigo-600 hover:bg-indigo-700 font-medium rounded-lg text-sm px-4 py-2 admin-control">추가</button></div></div><button id="record-attendance-btn" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-transform transform hover:scale-105 shadow-lg admin-control" disabled>선택한 날짜 출석 저장</button></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">💰 총 잔액</h2><p id="total-balance" class="text-4xl font-bold text-indigo-600">0 Dhs</p></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4">📊 월별 요약</h2><div class="w-full"><canvas id="accountingChart"></canvas></div></div><div class="bg-white p-6 rounded-2xl shadow-lg"><h2 class="text-2xl font-bold mb-4 border-b pb-2">운영진 공유사항</h2><textarea id="memo-area" class="w-full p-3 border rounded-lg admin-control bg-gray-50" rows="5" placeholder="미납자 정보, 주요 공지 등..." disabled></textarea><p class="text-xs text-gray-500 mt-2">메모는 자동으로 저장됩니다.</p>
    </div></div><div class="lg:col-span-2 bg-white p-6 rounded-2xl shadow-lg"><div class="border-b border-gray-200 mb-4"><nav class="flex -mb-px space-x-6" aria-label="Tabs"><button id="income-tab-btn" class="accounting-tab active text-indigo-600 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💰 회비 (수입)</button><button id="expense-tab-btn" class="accounting-tab text-gray-500 hover:text-gray-700 whitespace-nowrap py-3 px-1 border-b-2 font-medium text-lg">💸 지출</button></nav></div><div id="income-log-section"><div class="mb-4"><div class="flex flex-wrap justify-between items-center gap-2 mb-2"><h2 class="text-2xl font-bold">회비 로그 <span id="log-range-label" class="text-base font-normal text-gray-500"></span></h2><div class="flex gap-2"><button id="collect-mode-btn" class="text-sm text-white bg-indigo-600 hover:bg-indigo-700 font-bold py-1.5 px-3 rounded-lg admin-control" disabled>수금 체크</button><button id="accounting-excel-download-btn" class="text-sm text-white bg-green-600 hover:bg-green-700 font-bold py-1.5 px-3 rounded-lg">엑셀</button><button id="delete-range-btn" class="text-sm text-white bg-red-500 hover:bg-red-600 font-bold py-1.5 px-3 rounded-lg admin-control" disabled>이 범위 삭제</button></div></div><div class="flex flex-wrap items-center gap-2"><div class="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm"><button id="view-day-btn" class="view-mode-btn px-3 py-1.5 font-medium">선택한 날짜</button><button id="view-all-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">전체</button><button id="view-range-btn" class="view-mode-btn px-3 py-1.5 font-medium border-l border-gray-300">기간 지정</button></div><div id="range-picker" class="hidden flex items-center gap-1"><input type="date" id="filter-start-date" class="p-1.5 border rounded-md text-sm bg-white"><span class="text-gray-400">~</span><input type="date" id="filter-end-date" class="p-1.5 border rounded-md text-sm bg-white"><select id="filter-period-select" class="p-1.5 border rounded-md bg-white text-sm"><option value="custom">직접 지정</option><option value="1m">최근 1개월</option><option value="3m">최근 3개월</option><option value="6m">최근 6개월</option><option value="all">전체</option></select></div></div></div><div id="collect-bar" class="hidden mb-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50"><div class="flex flex-wrap items-center justify-between gap-2"><div class="text-sm font-semibold text-indigo-900">걷음 <span id="collect-done">0</span> / <span id="collect-total">0</span>명 · 걷은 금액 <span id="collect-amount">0</span> Dhs · 미수금 <span id="collect-remain">0</span>명</div><button id="collect-hide-btn" class="text-xs font-semibold text-indigo-700 bg-white border border-indigo-300 rounded px-2 py-1">안 낸 사람만 보기</button></div><div class="mt-2 h-2 w-full bg-indigo-100 rounded overflow-hidden"><div id="collect-progress-fill" class="h-full bg-indigo-600 rounded" style="width:0%"></div></div><p class="mt-1.5 text-xs text-indigo-700">표에서 이름 줄을 <b>탭하면 완납</b>(자동 금액)으로 기록됩니다. 다시 탭하면 취소. 일부만 받았으면 상태를 <b>△ 일부</b>로 두고 비고에 상세를 적으세요.</p></div><div class="overflow-x-auto max-h-[80vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">#</th> <th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">이름</th><th scope="col" class="py-3 px-4">납부 상태</th><th scope="col" class="py-3 px-4">납부액</th><th scope="col" class="py-3 px-4">비고</th></tr></thead><tbody id="accounting-log-body"></tbody><tfoot id="accounting-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div><div id="expense-log-section" class="hidden"><h2 class="text-2xl font-bold mb-4">지출 로그</h2><form id="expense-form" class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6 items-end"><div class="sm:col-span-2"><label for="expense-item" class="block text-sm font-medium">항목</label><input type="text" id="expense-item" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><div><label for="expense-amount" class="block text-sm font-medium">금액</label><input type="number" id="expense-amount" class="mt-1 w-full p-2 border rounded-lg bg-gray-50" required></div><button type="submit" class="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 admin-control" disabled>지출 추가</button></form><div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0"><tr><th scope="col" class="py-3 px-4">날짜</th><th scope="col" class="py-3 px-4">항목</th><th scope="col" class="py-3 px-4">금액</th><th scope="col" class="py-3 px-4">관리</th></tr></thead><tbody id="expense-log-body"></tbody><tfoot id="expense-log-foot" class="bg-gray-100 font-bold"></tfoot></table></div></div></div></div>`;

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
                // [Q3] 기본값: 운영진 포함 전원 '미납(✕)·0원'으로 불러오기 → 현장에서 수금 체크 탭으로 완납 처리
                //      (직전까지 쓰던 선수별 carry-forward 비고는 그대로 이어받아 표시)
                const carryNote = (state.playerNotes && state.playerNotes[normName(name)]) || '';
                const newLog = { date, name, paymentStatus: '✕', paymentAmount: 0, note: carryNote, grass: isGrass };
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
    // [추가] 수금모드 탭 토글이 호출하는 즉시 저장 핸들 (탭 반응성을 위해 짧은 디바운스)
    window._collectSave = window.debounce(async (docId, updatedField) => {
        await setDoc(doc(db, "attendance", docId), updatedField, { merge: true });
    }, 250);

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
            // [Q4] 비고를 '날짜별 기록(과거 보존)' + '선수별 carry-forward(다음에 자동표시)' 두 곳에 동시 저장.
            //      → 이번 날짜에서 지워도 그 날짜 문서의 note만 비고, 과거 날짜의 note는 그대로 보존됨.
            //        동시에 carry-forward 메모도 갱신되어, 비우면 다음 모임부터는 자동표시가 멈춤.
            if (docId) debouncedUpdate(docId, { note: target.value });
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

    // [v57] 과거 기록 이관 버튼 설치
    setupMigration();
}


// ================================================================
// [v57 추가] 엑셀 과거 기록 이관 (2026-01-07 ~ 2026-06-17) — 일회성
//  - 엑셀 "2026 바레아 회비관리" 장부를 앱 데이터로 변환해 내장.
//  - 버튼 한 번으로 반영, 다시 누르면 이관분만 전체 삭제(되돌리기).
//  - 모든 이관 문서에 mig 태그가 있어 앱에서 직접 입력한 기록과 절대 섞이지 않음.
//  - 6/24 이후는 앱 기록이 원본이므로 이관 범위에서 제외됨.
// ================================================================
const MIG_TAG = 'excel2026H1';
const MIG_D = ["2026-01-07", "2026-01-14", "2026-01-21", "2026-01-26", "2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25", "2026-03-11", "2026-03-18", "2026-04-01", "2026-04-07", "2026-04-15", "2026-04-22", "2026-04-29", "2026-05-06", "2026-05-13", "2026-05-20", "2026-06-03", "2026-06-10", "2026-06-17"];
// [날짜idx, 이름, 상태(1=완납●/0=미납✕), 금액, 비고]
const MIG_REC = [
    [0, "고태호", 1, 0, "면제"],
    [0, "김겸일", 1, 50, ""],
    [0, "김경윤", 1, 50, ""],
    [0, "김규남", 1, 0, "운영진"],
    [0, "김대근", 1, 50, "이체"],
    [0, "김세웅", 1, 50, "이체"],
    [0, "김영걸", 1, 50, "이체"],
    [0, "김우주", 1, 25, ""],
    [0, "김인수", 1, 50, "이체"],
    [0, "김진우", 1, 50, ""],
    [0, "김환희", 1, 50, ""],
    [0, "데니스", 0, 0, ""],
    [0, "문석형", 1, 50, ""],
    [0, "박경용", 1, 50, ""],
    [0, "박대영", 1, 50, ""],
    [0, "박정진", 1, 50, ""],
    [0, "베놈", 1, 0, "면제"],
    [0, "송준용", 1, 50, ""],
    [0, "송진호", 1, 0, "운영진"],
    [0, "신정호", 1, 50, ""],
    [0, "안단태", 1, 50, ""],
    [0, "여인혁", 0, 0, ""],
    [0, "오마르", 0, 0, ""],
    [0, "윤중부", 1, 0, "운영진"],
    [0, "이찬희", 1, 100, "2회분"],
    [0, "임동민", 1, 50, ""],
    [0, "장도영", 0, 0, ""],
    [0, "전의용", 1, 0, "분기 기납"],
    [0, "정명일", 1, 50, ""],
    [0, "정영락", 1, 50, ""],
    [0, "조한빛", 1, 0, "면제"],
    [0, "차민수", 1, 0, "운영진"],
    [1, "권혁우", 1, 50, "이체"],
    [1, "김겸일", 1, 50, ""],
    [1, "김규남", 1, 0, "운영진"],
    [1, "김대근", 1, 100, "이체·2회분"],
    [1, "김세웅", 1, 50, "이체"],
    [1, "김인수", 1, 50, ""],
    [1, "김해식", 1, 50, ""],
    [1, "데니스", 1, 100, "이체·2회분"],
    [1, "문석형", 1, 50, ""],
    [1, "박경용", 1, 50, ""],
    [1, "박대영", 1, 50, ""],
    [1, "송진호", 1, 0, "운영진"],
    [1, "안단태", 1, 50, ""],
    [1, "여인혁", 1, 100, "2회분"],
    [1, "오마르", 1, 100, "이체·2회분"],
    [1, "윤중부", 1, 0, "운영진"],
    [1, "이찬희", 1, 50, ""],
    [1, "임동민", 1, 50, ""],
    [1, "장도영", 1, 100, "이체·2회분"],
    [1, "전의용", 1, 450, "분기 기납(450 선납)"],
    [1, "정명일", 1, 50, ""],
    [1, "정영락", 1, 50, ""],
    [1, "조한빛", 0, 0, ""],
    [1, "차민수", 1, 0, "운영진"],
    [2, "고태호", 1, 50, "이체"],
    [2, "김규남", 1, 0, "운영진"],
    [2, "김세웅", 1, 50, "이체"],
    [2, "김인수", 1, 50, "이체"],
    [2, "김진우", 1, 50, ""],
    [2, "김해식", 1, 50, ""],
    [2, "김환희", 1, 50, ""],
    [2, "남승민", 1, 50, ""],
    [2, "문석형", 1, 50, ""],
    [2, "박경용", 1, 50, ""],
    [2, "박정진", 1, 50, ""],
    [2, "송진호", 1, 0, "운영진"],
    [2, "신정호", 1, 50, ""],
    [2, "안단태", 1, 50, ""],
    [2, "여인혁", 1, 50, ""],
    [2, "윤중부", 1, 0, "운영진"],
    [2, "임동민", 1, 50, ""],
    [2, "장도영", 1, 50, "이체"],
    [2, "전의용", 1, 0, "분기 기납"],
    [2, "정명일", 1, 50, ""],
    [2, "조한빛", 1, 100, "2회분"],
    [2, "차민수", 1, 0, "운영진"],
    [3, "김건효", 1, 0, "면제"],
    [3, "김경윤", 1, 50, ""],
    [3, "김규남", 1, 0, "운영진"],
    [3, "김세웅", 1, 50, "이체"],
    [3, "김인수", 1, 50, "카림"],
    [3, "김해식", 1, 50, "카림"],
    [3, "남승민", 1, 50, ""],
    [3, "데니스", 0, 0, ""],
    [3, "박경용", 1, 50, "카림"],
    [3, "박정진", 1, 50, ""],
    [3, "송준용", 1, 50, ""],
    [3, "송진호", 1, 0, "운영진"],
    [3, "신정호", 1, 50, "카림"],
    [3, "안단태", 1, 50, ""],
    [3, "윤중부", 1, 0, "운영진"],
    [3, "이찬희", 1, 50, "카림"],
    [3, "임동민", 1, 50, ""],
    [3, "장도영", 1, 50, "카림"],
    [3, "정명일", 1, 50, "카림"],
    [3, "조한빛", 1, 50, ""],
    [3, "지승현", 1, 50, ""],
    [3, "차민수", 1, 0, "운영진"],
    [4, "김겸일", 1, 50, ""],
    [4, "김경윤", 1, 50, ""],
    [4, "김규남", 1, 0, "운영진"],
    [4, "김대근", 0, 0, ""],
    [4, "김우주", 1, 25, ""],
    [4, "남승민", 1, 50, ""],
    [4, "데니스", 0, 0, ""],
    [4, "박경용", 1, 50, "카림"],
    [4, "베놈", 1, 0, "면제"],
    [4, "송준용", 1, 50, ""],
    [4, "송진호", 1, 0, "운영진"],
    [4, "신정호", 1, 50, "카림"],
    [4, "아미르", 1, 50, ""],
    [4, "안단태", 1, 0, "분기 기납"],
    [4, "여인혁", 1, 50, "카림"],
    [4, "윤중부", 1, 0, "운영진"],
    [4, "이찬희", 1, 50, "카림"],
    [4, "장도영", 1, 50, "카림"],
    [4, "전의용", 1, 0, "분기 기납"],
    [4, "정명일", 1, 50, "카림"],
    [4, "차민수", 1, 0, "운영진"],
    [4, "최준경", 1, 50, "이체"],
    [5, "고태호", 1, 50, "카림"],
    [5, "김경윤", 1, 50, ""],
    [5, "김규남", 1, 0, "운영진"],
    [5, "김대근", 1, 100, "2회분"],
    [5, "김세웅", 1, 50, "이체"],
    [5, "김우주", 1, 25, ""],
    [5, "김인수", 1, 50, "카림"],
    [5, "남승민", 1, 50, "카림"],
    [5, "데니스", 1, 200, "4회분"],
    [5, "박대영", 1, 50, "카림"],
    [5, "박상묵", 1, 50, "카림"],
    [5, "박정진", 1, 50, ""],
    [5, "베놈", 1, 0, "면제"],
    [5, "송준용", 1, 50, ""],
    [5, "송진호", 1, 0, "운영진"],
    [5, "아미르", 1, 50, ""],
    [5, "안단태", 1, 0, "분기 기납"],
    [5, "여인혁", 1, 50, "카림"],
    [5, "윤중부", 1, 0, "운영진"],
    [5, "장도영", 1, 50, "카림"],
    [5, "정명일", 1, 50, "카림"],
    [5, "정영락", 0, 0, ""],
    [5, "차민수", 1, 0, "운영진"],
    [5, "최준경", 1, 50, "이체"],
    [6, "고태호", 1, 50, "카림"],
    [6, "권혁우", 1, 50, "이체"],
    [6, "김겸일", 1, 50, ""],
    [6, "김경윤", 1, 50, ""],
    [6, "김규남", 1, 0, "운영진"],
    [6, "김대근", 1, 50, "카림"],
    [6, "김세웅", 1, 50, "이체"],
    [6, "김인수", 1, 50, "카림"],
    [6, "김진우", 1, 50, ""],
    [6, "김해식", 1, 50, "카림"],
    [6, "김환희", 0, 0, ""],
    [6, "나원건", 1, 50, ""],
    [6, "남승민", 1, 50, "카림"],
    [6, "박대영", 1, 50, "카림"],
    [6, "박범수", 1, 50, "2회분"],
    [6, "박정진", 1, 50, "카림"],
    [6, "송준용", 1, 50, "카림"],
    [6, "송진호", 1, 0, "운영진"],
    [6, "안단태", 1, 0, "분기 기납"],
    [6, "여인혁", 1, 50, "카림"],
    [6, "윤중부", 1, 0, "운영진"],
    [6, "장도영", 1, 50, "카림"],
    [6, "정명일", 1, 50, ""],
    [6, "정영락", 0, 0, ""],
    [6, "차민수", 1, 0, "운영진"],
    [7, "김건효", 1, 50, ""],
    [7, "김해식", 1, 50, "카림"],
    [7, "남승민", 1, 50, "카림"],
    [7, "박경용", 1, 50, ""],
    [7, "박대영", 1, 50, "카림"],
    [7, "박범수", 1, 0, "면제"],
    [7, "박정진", 1, 50, "카림"],
    [7, "송진호", 1, 0, "운영진"],
    [7, "신정호", 1, 50, "카림"],
    [7, "여인혁", 1, 50, "카림"],
    [7, "윤중부", 1, 0, "운영진"],
    [7, "장도영", 1, 50, "카림"],
    [7, "정명일", 1, 50, ""],
    [7, "정영락", 1, 200, "4회분"],
    [7, "차민수", 1, 0, "운영진"],
    [8, "고태호", 1, 50, "카림"],
    [8, "김건효", 1, 50, "카림"],
    [8, "김경윤", 1, 50, ""],
    [8, "김대근", 1, 50, ""],
    [8, "김세웅", 1, 50, "이체"],
    [8, "김인수", 1, 50, "카림"],
    [8, "나원건", 1, 50, ""],
    [8, "남승민", 1, 50, "카림"],
    [8, "박범수", 1, 25, ""],
    [8, "윤중부", 1, 0, "운영진"],
    [8, "이찬희", 1, 50, "카림"],
    [8, "장도영", 1, 50, "카림"],
    [8, "정영락", 1, 50, ""],
    [9, "고태호", 1, 50, "카림"],
    [9, "김경윤", 1, 50, ""],
    [9, "김규남", 1, 0, "운영진"],
    [9, "김대근", 1, 50, ""],
    [9, "김인수", 1, 50, "카림"],
    [9, "나원건", 1, 50, ""],
    [9, "남승민", 1, 50, "카림"],
    [9, "박범수", 1, 25, ""],
    [9, "여인혁", 1, 50, "카림"],
    [9, "윤중부", 1, 0, "운영진"],
    [9, "이찬희", 1, 50, ""],
    [9, "장도영", 1, 50, "카림"],
    [9, "정영락", 1, 50, ""],
    [9, "지승현", 1, 50, "카림"],
    [10, "고태호", 1, 50, ""],
    [10, "김규남", 1, 0, "운영진"],
    [10, "김대근", 1, 50, "이체"],
    [10, "김우주", 1, 0, "면제"],
    [10, "김인수", 1, 50, "이체"],
    [10, "김환희", 1, 50, ""],
    [10, "나원건", 1, 50, ""],
    [10, "남승민", 1, 50, "카림"],
    [10, "박상묵", 1, 50, "카림"],
    [10, "윤중부", 1, 0, "운영진"],
    [10, "이찬희", 1, 50, "카림"],
    [10, "장도영", 1, 50, "카림"],
    [10, "정명일", 1, 50, ""],
    [10, "정영락", 1, 50, ""],
    [10, "정우영", 1, 50, "이체"],
    [11, "고태호", 1, 50, "카림"],
    [11, "김규남", 1, 0, "운영진"],
    [11, "김대근", 1, 50, "이체"],
    [11, "김세웅", 1, 50, "이체"],
    [11, "김환희", 1, 50, ""],
    [11, "남승민", 1, 50, "카림"],
    [11, "여인혁", 1, 50, "카림"],
    [11, "윤중부", 1, 0, "운영진"],
    [11, "이찬희", 1, 50, "카림"],
    [11, "장도영", 1, 50, "카림"],
    [11, "정영락", 1, 50, ""],
    [12, "고태호", 1, 50, "카림"],
    [12, "김건효", 1, 50, ""],
    [12, "김겸일", 0, 0, ""],
    [12, "김규남", 1, 0, "운영진"],
    [12, "김대근", 1, 50, "이체"],
    [12, "김세웅", 1, 50, "이체"],
    [12, "김인수", 1, 50, ""],
    [12, "남승민", 1, 50, "카림"],
    [12, "미상", 1, 50, ""],
    [12, "여인혁", 1, 50, "카림"],
    [12, "윤중부", 1, 0, "운영진"],
    [12, "이승", 1, 50, ""],
    [12, "장도영", 1, 50, "카림"],
    [12, "정영락", 1, 50, ""],
    [12, "정우영", 1, 50, "이체"],
    [13, "고태호", 1, 50, "카림"],
    [13, "김경윤", 1, 50, ""],
    [13, "김규남", 1, 0, "운영진"],
    [13, "김대근", 1, 50, "이체"],
    [13, "김인수", 1, 50, "이체"],
    [13, "남승민", 1, 50, "카림"],
    [13, "미상", 1, 0, "면제"],
    [13, "백승한", 1, 50, ""],
    [13, "윤중부", 1, 0, "운영진"],
    [13, "이승", 1, 50, ""],
    [13, "장도영", 1, 50, "카림"],
    [13, "정명일", 1, 50, ""],
    [13, "정영락", 1, 50, ""],
    [13, "정우영", 1, 50, "이체"],
    [14, "고태호", 1, 50, "카림"],
    [14, "김경윤", 1, 50, ""],
    [14, "김규남", 1, 0, "운영진"],
    [14, "김대근", 1, 50, "이체"],
    [14, "김세웅", 0, 0, "확인 필요"],
    [14, "김인수", 0, 0, "확인 필요"],
    [14, "남승민", 1, 50, "카림"],
    [14, "데니스", 1, 50, ""],
    [14, "박상묵", 1, 50, "카림"],
    [14, "안단태", 1, 0, "분기 기납"],
    [14, "윤중부", 1, 0, "운영진"],
    [14, "장도영", 1, 50, "카림"],
    [14, "정명일", 1, 50, ""],
    [14, "정영락", 1, 50, ""],
    [14, "정우영", 1, 50, "이체"],
    [15, "고태호", 1, 50, "카림"],
    [15, "김겸일", 1, 100, "2회분"],
    [15, "김경윤", 1, 50, ""],
    [15, "김규남", 1, 0, "운영진"],
    [15, "김대근", 1, 50, "이체"],
    [15, "김세웅", 1, 100, "이체·2회분"],
    [15, "김우주", 1, 25, ""],
    [15, "김해식", 1, 50, "카림"],
    [15, "남승민", 1, 50, "카림"],
    [15, "데니스", 0, 0, ""],
    [15, "문석형", 1, 50, ""],
    [15, "박대영", 1, 50, "카림"],
    [15, "박정진", 1, 50, ""],
    [15, "송준용", 1, 50, ""],
    [15, "송진호", 1, 0, "운영진"],
    [15, "신정호", 1, 50, ""],
    [15, "안단태", 1, 0, "분기 기납"],
    [15, "윤중부", 1, 0, "운영진"],
    [15, "이아론", 1, 25, ""],
    [15, "이찬희", 1, 50, ""],
    [15, "장도영", 1, 50, "카림"],
    [15, "정명일", 0, 0, ""],
    [15, "정영락", 1, 50, ""],
    [15, "정우영", 1, 50, "이체"],
    [15, "존", 1, 50, ""],
    [16, "고태호", 1, 50, "카림"],
    [16, "김건효", 1, 50, "카림"],
    [16, "김겸일", 0, 0, ""],
    [16, "김경윤", 1, 50, ""],
    [16, "김규남", 1, 0, "운영진"],
    [16, "김대근", 1, 50, "이체"],
    [16, "김세웅", 1, 50, "이체"],
    [16, "김우주", 1, 25, ""],
    [16, "김인수", 1, 50, "카림"],
    [16, "김해식", 1, 50, "카림"],
    [16, "데니스", 1, 50, ""],
    [16, "박정진", 1, 50, ""],
    [16, "발토스", 1, 50, ""],
    [16, "송준용", 1, 50, ""],
    [16, "송진호", 1, 0, "운영진"],
    [16, "안단태", 1, 0, "분기 기납"],
    [16, "여인혁", 1, 50, "카림"],
    [16, "윤중부", 1, 0, "운영진"],
    [16, "장도영", 1, 50, "카림"],
    [16, "정영락", 1, 50, ""],
    [16, "정우영", 1, 50, "이체"],
    [16, "존", 1, 50, ""],
    [17, "고태호", 1, 50, "카림"],
    [17, "김건효", 1, 50, "카림"],
    [17, "김겸일", 1, 150, "이체·3회분"],
    [17, "김경윤", 1, 50, ""],
    [17, "김규남", 1, 0, "운영진"],
    [17, "김대근", 1, 50, "이체"],
    [17, "김봉준", 1, 0, "면제"],
    [17, "김세웅", 1, 50, "이체"],
    [17, "김인수", 1, 50, "카림"],
    [17, "김해식", 1, 50, "카림"],
    [17, "남승민", 1, 50, ""],
    [17, "데니스", 0, 0, ""],
    [17, "문석형", 0, 0, ""],
    [17, "박상묵", 1, 50, "카림"],
    [17, "송진호", 1, 0, "운영진"],
    [17, "신정호", 1, 50, "카림"],
    [17, "아미르", 1, 50, "카림"],
    [17, "안단태", 1, 0, "분기 기납"],
    [17, "여인혁", 1, 50, "카림"],
    [17, "윤중부", 1, 0, "운영진"],
    [17, "장도영", 1, 50, "카림"],
    [17, "정영락", 0, 0, ""],
    [17, "정우영", 1, 50, "이체"],
    [17, "지승현", 1, 50, ""],
    [17, "최준경", 1, 50, "이체"],
    [18, "고태호", 1, 50, "카림"],
    [18, "김겸일", 1, 50, ""],
    [18, "김경윤", 1, 50, ""],
    [18, "김규남", 1, 0, "운영진"],
    [18, "김대근", 1, 50, "이체"],
    [18, "김봉준", 1, 50, ""],
    [18, "김세웅", 1, 50, "이체"],
    [18, "김인수", 1, 50, "카림"],
    [18, "김해식", 0, 0, ""],
    [18, "남승민", 1, 50, ""],
    [18, "데니스", 1, 50, ""],
    [18, "문석형", 1, 50, ""],
    [18, "박대영", 1, 50, "카림"],
    [18, "박정진", 1, 50, ""],
    [18, "베놈", 1, 50, ""],
    [18, "송준용", 1, 50, ""],
    [18, "송진호", 1, 0, "운영진"],
    [18, "아미르", 1, 50, "카림"],
    [18, "여인혁", 1, 50, "카림"],
    [18, "오마르", 1, 50, "카림"],
    [18, "윤중부", 1, 0, "운영진"],
    [18, "장도영", 1, 50, "카림"],
    [18, "정명일", 1, 50, ""],
    [18, "정영락", 1, 50, ""],
    [18, "정우영", 1, 50, "이체"],
    [18, "지승현", 1, 50, "카림"],
    [18, "차민수", 1, 0, "운영진"],
    [19, "김겸일", 0, 0, ""],
    [19, "김경윤", 1, 50, ""],
    [19, "김규남", 1, 0, "운영진"],
    [19, "김대근", 1, 50, "이체"],
    [19, "김인수", 1, 50, "카림"],
    [19, "나원건", 1, 50, "카림"],
    [19, "남승민", 1, 50, ""],
    [19, "데니스", 0, 0, ""],
    [19, "미상", 1, 50, "카림"],
    [19, "박경용", 1, 50, ""],
    [19, "박대영", 1, 50, "카림"],
    [19, "박상묵", 1, 50, "카림"],
    [19, "박정진", 1, 50, ""],
    [19, "송진호", 1, 0, "운영진"],
    [19, "아미르", 1, 50, "카림"],
    [19, "여인혁", 1, 50, "카림"],
    [19, "윤중부", 1, 0, "운영진"],
    [19, "장도영", 1, 50, "카림"],
    [19, "정명일", 1, 0, "면제"],
    [19, "정영락", 0, 0, ""],
    [19, "지승현", 1, 50, "카림"],
    [19, "차민수", 1, 0, "운영진"],
    [19, "최준경", 1, 50, ""],
    [20, "김겸일", 1, 100, "2회분"],
    [20, "김규남", 1, 0, "운영진"],
    [20, "김대근", 1, 50, "이체"],
    [20, "김우주", 1, 25, ""],
    [20, "김인수", 1, 50, "카림"],
    [20, "김해식", 1, 50, "카림"],
    [20, "나원건", 1, 50, "카림"],
    [20, "남승민", 1, 50, ""],
    [20, "데니스", 1, 50, ""],
    [20, "미상", 1, 50, ""],
    [20, "박경용", 1, 50, ""],
    [20, "박대영", 1, 50, "카림"],
    [20, "박상묵", 1, 50, "카림"],
    [20, "박정진", 1, 50, ""],
    [20, "송준용", 1, 50, ""],
    [20, "송진호", 1, 0, "운영진"],
    [20, "안단태", 1, 0, "분기 기납"],
    [20, "여인혁", 1, 50, "카림"],
    [20, "윤중부", 1, 0, "운영진"],
    [20, "이승", 1, 50, ""],
    [20, "이찬희", 1, 50, "카림"],
    [20, "장도영", 1, 50, "카림"],
    [20, "정명일", 1, 50, ""],
    [20, "정영락", 1, 100, "2회분"],
    [20, "지승현", 1, 50, "카림"],
    [20, "최준경", 1, 50, ""]
];
// [날짜idx, 장부항목, 금액, 비고] → 이름 '[장부] ...' 로 기록
const MIG_LEDGER = [
    [0, "전년 이월금", 4949.62, "엑셀 장부 이월"],
    [9, "후원금", 5000, ""],
    [1, "게스트 회비", 50, "게스트 참석비"],
    [4, "게스트 회비", 50, "게스트 참석비"],
    [10, "게스트 회비", 100, "게스트 참석비"],
    [11, "게스트 회비", 50, "게스트 참석비"],
    [12, "게스트 회비", 50, "게스트 참석비"],
    [13, "게스트 회비", 50, "게스트 참석비"],
    [14, "게스트 회비", 50, "게스트 참석비"],
    [15, "게스트 회비", 50, "게스트 참석비"],
    [19, "게스트 회비", 50, "게스트 참석비"],
    [20, "게스트 회비", 50, "게스트 참석비"],
    [0, "수납시점 보정", -100, "선납·후납 수납시점 차이"],
    [1, "수납시점 보정", -300, "선납·후납 수납시점 차이"],
    [2, "수납시점 보정", 50, "선납·후납 수납시점 차이"],
    [4, "수납시점 보정", 480, "선납·후납 수납시점 차이"],
    [5, "수납시점 보정", -500, "선납·후납 수납시점 차이"],
    [6, "수납시점 보정", -50, "선납·후납 수납시점 차이"],
    [7, "수납시점 보정", 500, "선납·후납 수납시점 차이"],
    [8, "수납시점 보정", -50, "선납·후납 수납시점 차이"],
    [10, "수납시점 보정", -50, "선납·후납 수납시점 차이"],
    [12, "수납시점 보정", 500, "선납·후납 수납시점 차이"],
    [14, "수납시점 보정", 100, "선납·후납 수납시점 차이"],
    [17, "수납시점 보정", -100, "선납·후납 수납시점 차이"],
    [18, "수납시점 보정", 620, "선납·후납 수납시점 차이"],
    [19, "수납시점 보정", 50, "선납·후납 수납시점 차이"]
];
// [날짜idx, 지출항목, 금액]
const MIG_EXP = [
    [0, "경기장", 3880.8],
    [0, "물", 42],
    [0, "장비", 149],
    [1, "물", 42],
    [2, "물", 10],
    [2, "장비", 786],
    [3, "물", 15],
    [4, "물", 20],
    [5, "경기장", 3880.8],
    [5, "물", 25],
    [6, "물", 191.35],
    [7, "물", 30],
    [8, "경기장", 536.03],
    [8, "물", 30],
    [9, "경기장", 306.3],
    [9, "물", 20],
    [10, "경기장", 1165.2],
    [10, "물", 20],
    [11, "경기장", 612.6],
    [11, "물", 20],
    [12, "경기장", 50],
    [12, "물", 24],
    [13, "경기장", 816],
    [13, "물", 30],
    [14, "경기장", 776],
    [14, "물", 38],
    [15, "경기장", 2000],
    [15, "물", 502],
    [16, "경기장", 3880.8],
    [16, "물", 42.8],
    [17, "물", 36],
    [18, "경기장", 2000],
    [18, "물", 40],
    [19, "경기장", 3880.8],
    [19, "물", 54],
    [20, "물", 60.7]
];

function migBuildDocs() {
    const att = [];
    MIG_REC.forEach((r) => {
        const date = MIG_D[r[0]];
        const name = r[1];
        att.push({
            id: `${date}_${name}`,
            data: { date, name, paymentStatus: r[2] === 1 ? '\u25CF' : '\u2715', paymentAmount: r[3], note: r[4], grass: false, mig: MIG_TAG }
        });
    });
    MIG_LEDGER.forEach((r) => {
        const date = MIG_D[r[0]];
        const name = `[장부] ${r[1]}`;
        att.push({
            id: `${date}_${name}`,
            data: { date, name, paymentStatus: '\u25CF', paymentAmount: r[2], note: r[3], grass: false, mig: MIG_TAG }
        });
    });
    const exp = MIG_EXP.map((r) => ({
        id: `mig_${MIG_D[r[0]]}_${r[1]}`,
        data: { date: MIG_D[r[0]], item: r[1], amount: r[2], mig: MIG_TAG }
    }));
    return { att, exp };
}

async function migRunChunked(tasks) {
    for (let i = 0; i < tasks.length; i += 100) {
        await Promise.all(tasks.slice(i, i + 100).map((fn) => fn()));
    }
}

async function handleMigration() {
    if (!state.isAdmin) {
        window.showNotification('관리자 로그인 후 사용할 수 있습니다.', 'error');
        return;
    }
    const existingAtt = (state.attendanceLog || []).filter((l) => l.mig === MIG_TAG);
    const existingExp = (state.expenseLog || []).filter((l) => l.mig === MIG_TAG);
    if (existingAtt.length > 0 || existingExp.length > 0) {
        const ok = confirm(
            `이미 과거 기록이 반영되어 있습니다 (수입 ${existingAtt.length}건 · 지출 ${existingExp.length}건).\n\n` +
            `[확인]을 누르면 이관된 과거 기록만 전부 삭제(되돌리기)합니다.\n` +
            `앱에서 직접 입력한 기록(6/24 이후 등)은 삭제되지 않습니다.`
        );
        if (!ok) return;
        try {
            const dels = [];
            existingAtt.forEach((l) => dels.push(() => deleteDoc(doc(db, 'attendance', l.id))));
            existingExp.forEach((l) => dels.push(() => deleteDoc(doc(db, 'expenses', l.id))));
            await migRunChunked(dels);
            window.showNotification(`이관 기록 ${dels.length}건이 삭제되었습니다.`);
        } catch (err) {
            console.error('migration undo error:', err);
            window.showNotification('삭제 중 오류가 발생했습니다. 다시 시도해주세요.', 'error');
        }
        return;
    }
    const built = migBuildDocs();
    const incSum = built.att.reduce((s, d) => s + Number(d.data.paymentAmount || 0), 0);
    const expSum = built.exp.reduce((s, d) => s + Number(d.data.amount || 0), 0);
    const net = Math.round((incSum - expSum) * 100) / 100;
    const ok = confirm(
        `엑셀 과거 기록(2026-01-07 ~ 2026-06-17)을 가져옵니다.\n\n` +
        `\u00B7 출석·회비 기록 ${MIG_REC.length}건 (21회 모임)\n` +
        `\u00B7 장부 항목 ${MIG_LEDGER.length}건 (이월금·후원금·게스트 회비·수납시점 보정)\n` +
        `\u00B7 지출 ${built.exp.length}건 (경기장·물·장비)\n` +
        `\u00B7 반영 후 총 잔액 변화: +${net.toLocaleString()} Dhs\n\n` +
        `기존 앱 기록(6/24 이후)은 전혀 건드리지 않습니다. 진행할까요?`
    );
    if (!ok) return;
    try {
        const writes = [];
        built.att.forEach((d) => writes.push(() => setDoc(doc(db, 'attendance', d.id), d.data)));
        built.exp.forEach((d) => writes.push(() => setDoc(doc(db, 'expenses', d.id), Object.assign({}, d.data, { createdAt: serverTimestamp() }))));
        await migRunChunked(writes);
        window.showNotification(`과거 기록 ${writes.length}건을 가져왔습니다. 총 잔액이 약 5,726 Dhs인지 확인하세요.`);
    } catch (err) {
        console.error('migration import error:', err);
        window.showNotification('가져오기 중 오류가 발생했습니다. 버튼을 다시 눌러 삭제 후 재시도하세요.', 'error');
    }
}

function setupMigration() {
    if (!excelDownloadBtn || document.getElementById('mig-import-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mig-import-btn';
    btn.className = 'text-sm text-white bg-gray-500 hover:bg-gray-600 font-bold py-1.5 px-3 rounded-lg admin-control';
    btn.textContent = '\uD83D\uDCE5 과거기록';
    btn.title = '엑셀 장부(2026년 1~6월) 일회성 가져오기 · 이미 가져온 상태에서 누르면 되돌리기';
    btn.disabled = !state.isAdmin;
    btn.addEventListener('click', handleMigration);
    excelDownloadBtn.insertAdjacentElement('afterend', btn);
}
