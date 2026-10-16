// Shared by the main app, training log, and the scheduled server reminder.
export const COACH_REMINDER_PERIODS = [
    { period: 1, startMinute: 600 }, { period: 2, startMinute: 720 },
    { period: 4, startMinute: 1080 }, { period: 5, startMinute: 1190 },
    { period: 6, startMinute: 1300 },
];

export function getCoachReminderClock(now = new Date()) {
    const korea = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return { date: korea.toISOString().slice(0, 10), minutes: korea.getUTCHours() * 60 + korea.getUTCMinutes(), weekday: korea.getUTCDay() };
}

const names = values => [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];

export function getDueCoachReminders(snapshot, now = new Date()) {
    const clock = getCoachReminderClock(now);
    if (snapshot?.date !== clock.date || clock.weekday === 0 || clock.weekday === 6) return [];
    return (Array.isArray(snapshot.lessons) ? snapshot.lessons : []).flatMap(lesson => {
        const period = COACH_REMINDER_PERIODS.find(item => item.period === Number(lesson.period));
        if (!period || Number(lesson.startMinute) !== period.startMinute
            || clock.minutes < period.startMinute - 30 || clock.minutes >= period.startMinute) return [];
        const lastNames = names(lesson.lastNames);
        const delayedNames = names(lesson.delayedNames).filter(name => !lastNames.includes(name));
        return lastNames.length || delayedNames.length
            ? [{ key: `${clock.date}:${period.period}`, date: clock.date, ...period, lastNames, delayedNames }] : [];
    });
}

export function createReminderLedger(storage, coachName) {
    const key = `coach-renewal-reminders:v1:${encodeURIComponent(coachName)}`;
    const memory = new Set();
    const read = () => {
        try {
            const value = JSON.parse(storage?.getItem(key) || '[]');
            return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
        } catch { return []; }
    };
    return {
        has: item => memory.has(item) || read().includes(item),
        mark(item) {
            memory.add(item);
            // No student names are kept in browser storage. Retain only recent slot IDs.
            try { storage?.setItem(key, JSON.stringify([...new Set([...read(), ...memory])].sort().slice(-50))); }
            catch { /* Keep deduplication for this document when storage is unavailable. */ }
        },
    };
}

export function createCoachReminderLoader({ getToken, functionsUrl = '/.netlify/functions', fetchImpl = globalThis.fetch }) {
    const url = `${functionsUrl.replace(/\/sheets\/?$/, '').replace(/\/$/, '')}/coach-renewal`;
    return async ({ force = false } = {}) => {
        const token = await getToken();
        if (!token) throw new Error('코치 로그인을 확인해주세요.');
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 15_000);
        try {
            const response = await fetchImpl(`${url}${force ? '?refresh=1' : ''}`, {
                headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: abort.signal,
            });
            if (!response.ok) throw new Error('재등록 안내 정보를 불러오지 못했습니다.');
            const snapshot = await response.json();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot?.date) || !Array.isArray(snapshot.lessons)) {
                throw new Error('재등록 안내 정보가 올바르지 않습니다.');
            }
            return snapshot;
        } finally { clearTimeout(timeout); }
    };
}

export function hasCoachReminderDialog(document) {
    if (document?.querySelector?.('dialog[open], [aria-modal="true"], [class*="modal-overlay"], .modal.active, [data-coach-reminder-block]')) return true;
    // Legacy training-log message dialogs toggle display without an active class.
    return [...(document?.querySelectorAll?.('.modal') || [])].some(node => node.getClientRects().length > 0);
}

// One controller lives above page navigation; both apps share its ledger.
// Requests run on entry, returning to the app, and the 30-minute boundary.
export function createCoachReminderController({ coachName, loadSnapshot, onReminder,
    storage, document = globalThis.document, window = globalThis.window,
    now = () => new Date(), canShow = () => !hasCoachReminderDialog(document), onError = () => {} }) {
    const ledger = createReminderLedger(storage, coachName);
    let snapshot = null;
    let active = null;
    let running = false;
    let generation = 0;
    let pending = null;
    let refreshAgain = false;
    let lastFetch = -Infinity;
    let phase = '';
    let timer;

    function evaluate() {
        if (!running || document?.hidden) return;
        const due = getDueCoachReminders(snapshot, now());
        if (active) {
            const updated = due.find(item => item.key === active.key);
            if (!updated) { active = null; onReminder(null); }
            else if (JSON.stringify(updated) !== JSON.stringify(active)) { active = updated; onReminder(updated); }
        }
        if (active || pending || !canShow()) return;
        const next = due.find(item => !ledger.has(item.key));
        if (!next) return;
        // Adapters may defer display while a form or another modal is open.
        if (onReminder(next) === false) return;
        active = next;
        ledger.mark(next.key);
    }

    async function refresh({ force = false } = {}) {
        if (!running || document?.hidden) return;
        if (pending) {
            if (force) refreshAgain = true;
            return pending;
        }
        const requestGeneration = generation;
        lastFetch = now().getTime();
        const request = Promise.resolve().then(() => loadSnapshot({ force }));
        pending = request;
        try {
            const result = await request;
            if (running && generation === requestGeneration) snapshot = result;
        } catch (error) {
            if (running && generation === requestGeneration) {
                snapshot = null; // Failed refresh must not open an old registration notice.
                if (active) { active = null; onReminder(null); }
                onError(error);
            }
        } finally {
            if (pending === request) pending = null;
            if (running && generation === requestGeneration) {
                if (refreshAgain) { refreshAgain = false; void refresh({ force: true }); }
                else evaluate();
            }
        }
    }

    function tick() {
        if (!running || document?.hidden) return;
        // A slow refresh must not keep the popup open after class starts.
        if (active && !getDueCoachReminders(snapshot, now()).some(item => item.key === active.key)) {
            active = null;
            onReminder(null);
        }
        const clock = getCoachReminderClock(now());
        const period = COACH_REMINDER_PERIODS.find(item => clock.minutes >= item.startMinute - 30 && clock.minutes < item.startMinute);
        const nextPhase = `${clock.date}:${period?.period ?? ''}`;
        if (phase !== nextPhase) {
            const previous = phase;
            phase = nextPhase;
            if (period || previous.slice(0, 10) !== clock.date) { void refresh({ force: true }); return; }
        }
        if (!snapshot && !pending && now().getTime() - lastFetch >= 60_000) { void refresh(); return; }
        evaluate();
    }
    function returned() {
        if (document?.hidden) return;
        // A different page can renew a student while this app is in the background.
        if (now().getTime() - lastFetch >= 60_000) void refresh({ force: true });
        else tick();
    }
    function storageChanged() { tick(); }

    function stop() {
        running = false;
        generation += 1;
        snapshot = null;
        pending = null;
        refreshAgain = false;
        window?.clearInterval(timer);
        document?.removeEventListener('visibilitychange', returned);
        window?.removeEventListener('focus', returned);
        window?.removeEventListener('pageshow', returned);
        window?.removeEventListener('storage', storageChanged);
        if (active) { active = null; onReminder(null); }
    }
    return {
        start() {
            if (running) return stop;
            running = true;
            phase = '';
            document?.addEventListener('visibilitychange', returned);
            window?.addEventListener('focus', returned);
            window?.addEventListener('pageshow', returned);
            window?.addEventListener('storage', storageChanged);
            timer = window?.setInterval(tick, 15_000);
            tick();
            return stop;
        },
        refresh,
        dismiss(key) {
            if (active?.key !== key) return;
            active = null;
            onReminder(null);
        },
        stop,
    };
}
