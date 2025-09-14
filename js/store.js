// js/store.js

export const state = {
    playerDB: {},
    attendanceLog: [],
    expenseLog: [], // 지출 내역
    teams: [], // 팀 배정 결과 저장
    lineupResults: null,
    memoContent: "",
    isAdmin: false,
    ADMIN_PASSWORD: "0000"
};

export function setAdmin(status) {
    state.isAdmin = status;
}