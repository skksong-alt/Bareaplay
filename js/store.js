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
    ADMIN_PASSWORD: "2580"
};

export function setAdmin(status) {
    state.isAdmin = status;
}