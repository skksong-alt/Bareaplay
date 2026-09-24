// js/store.js
export const state = {
    playerDB: {},
    attendanceLog: [],
    expenseLog: [],
    locations: [],
    teams: [],
    quarterCount: 6,
    lineupResults: null,
    memoContent: "",
    isAdmin: false,
};

export function setAdmin(status) {
    state.isAdmin = status;
}
