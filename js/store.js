// js/store.js

export const state = {
    playerDB: {},
    attendanceLog: [],
    expenseLog: [],
    teams: [],
    lineupResults: null,
    memoContent: "",
    isAdmin: false,
    isDarkMode: false,
    ADMIN_PASSWORD: "0000"
};

export function setAdmin(status) {
    state.isAdmin = status;
}