// js/store.js
export const state = {
    playerDB: {},
    attendanceLog: [],
    expenseLog: [],
    locations: [],
    teams: [],
    lineupResults: null,
    memoContent: "",
    isAdmin: false,
};

export function setAdmin(status) {
    state.isAdmin = status;
}