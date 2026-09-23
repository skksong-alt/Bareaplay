const DUBAI_OFFSET = '+04:00';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function voteTimes(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    const startAtMs = Date.parse(`${date}T${time}:00${DUBAI_OFFSET}`);
    if (!Number.isFinite(startAtMs)) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(startAtMs));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const actualDate = `${values.year}-${values.month}-${values.day}`;
    if (actualDate !== date) return null;
    return { startAtMs, deadlineMs: startAtMs - TWO_HOURS_MS };
}

export function canOpenVote(date, time, now = Date.now()) {
    const times = voteTimes(date, time);
    if (!times) return { reason: 'invalid' };
    if (times.deadlineMs <= now) return { reason: 'deadline-passed', ...times };
    return { reason: '', ...times };
}
