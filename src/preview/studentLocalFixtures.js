import { shiftEndDateBySessions } from '../services/holidayEndDateDelta';
import { isHolidayDate } from '../services/googleSheetsService';
import { getNoticeRevision } from '../utils/noticeState';
import { buildSwapMakeups, findMutualSwap } from '../utils/makeupSwap';
const clone = value => structuredClone(value);
export const reviewUser = { username: '예시 수강생', role: 'student' };
export const reviewStudent = {
    이름: reviewUser.username, 주횟수: '2', '요일 및 시간': '화5목5',
    시작날짜: '260901', 종료날짜: '261015', '홀딩 사용여부': 'X',
    연락처: '', 특이사항: '',
};
export const reviewWeekDates = { 월: '9/14', 화: '9/15', 수: '9/16', 목: '9/17', 금: '9/18' };
export const reviewSchedule = [{ day: '화', period: 5 }, { day: '목', period: 5 }];

export function createStudentReviewServices(onChange) {
    let student = clone(reviewStudent);
    const makeups = [];
    const waitlists = [];
    const holdings = [];
    const absences = [];
    const freeWorkouts = [];
    const notices = [
        { id: 'review-notice-1', category: 'notice', title: '추석 연휴 수업 일정과 보강 신청 안내를 확인해주세요', content: '로컬 검토용 공지입니다. 실제 게시판 글이 아닙니다.\n공지 제목은 한 줄로 표시되고, 이 상세 내용을 연 뒤에는 해당 공지의 N 표시가 사라집니다.', pinned: true, createdAt: '2026-09-15T10:00:00+09:00', updatedAt: '2026-09-15T10:00:00+09:00' },
        { id: 'review-notice-2', category: 'notice', title: '훈련일지에 지난 운동 기록을 참고해보세요', content: '로컬 검토용 두 번째 공지입니다.\n각 공지의 확인 여부는 따로 저장됩니다. 제목이 자동으로 바뀌는 것만으로는 읽음 처리하지 않습니다.', pinned: true, createdAt: '2026-09-14T10:00:00+09:00', updatedAt: '2026-09-14T10:00:00+09:00' },
        { id: 'review-notice-unpinned', category: 'notice', title: '고정하지 않은 공지 — 상단 순환에서 제외', content: '게시판에만 표시하는 예시입니다.', pinned: false, createdAt: '2026-09-16T08:00:00+09:00' },
    ];
    const readNoticeKey = name => `student-local-review:noticeReads:${name}`;
    const noticeServices = {
        getNoticeSummaries: async () => clone(notices.filter(post => post.pinned === true && !post.deleted)),
        getNoticeReads: async name => { try { return JSON.parse(localStorage.getItem(readNoticeKey(name)) || '{}'); } catch { return {}; } },
        getPost: async id => clone(notices.find(post => post.id === id) || null),
        markNoticeRead: async (name, post) => {
            const reads = await noticeServices.getNoticeReads(name);
            reads[post.id] = Math.max(reads[post.id] || 0, getNoticeRevision(post));
            localStorage.setItem(readNoticeKey(name), JSON.stringify(reads));
        },
    };
    let offeredSeat = false;
    let sequence = 0;
    const update = (rows, id, fields) => { Object.assign(rows.find(row => row.id === id) || {}, fields); onChange(); };
    const services = {
        getActiveMakeupRequests: async () => clone(makeups.filter(row => row.status !== 'cancelled')),
        getWeekMakeupRequests: async (_name, start, end) => clone(makeups.filter(row =>
            [row.originalClass.date, row.makeupClass.date].some(date => date >= start && date <= end))),
        createMakeupRequest: async (name, originalClass, makeupClass) => {
            const id = `review-makeup-${++sequence}`;
            makeups.push({ id, studentName: name, originalClass: clone(originalClass), makeupClass: clone(makeupClass), status: 'active' });
            onChange(); return id;
        },
        cancelMakeupRequest: async id => update(makeups, id, { status: 'cancelled' }),
        completeMakeupRequest: async id => update(makeups, id, { status: 'completed' }),
        getHolidays: async () => [],
        getHoldingsByWeek: async () => clone(holdings.filter(row => row.status === 'active')),
        getAbsencesByDate: async date => clone(absences.filter(row => row.date === date && row.status === 'active')),
        getFreeWorkoutByDateRange: async (start, end) => clone(freeWorkouts.filter(row => row.date >= start && row.date <= end)),
        getHoldingsByStudent: async () => clone(holdings.filter(row => row.status === 'active')),
        getHoldingHistory: async () => clone(holdings),
        getAbsencesByStudent: async () => clone(absences.filter(row => row.status === 'active')),
        createHoldingRequest: async (name, startDate, endDate, holdingDates) => {
            const id = `review-holding-${++sequence}`;
            holdings.push({ id, studentName: name, startDate, endDate, holdingDates, status: 'active' });
            onChange(); return { id };
        },
        markHoldingSheetsApplied: async id => update(holdings, id, { sheetsApplied: true }),
        createAbsenceRequest: async (name, date) => {
            absences.push({ id: `review-absence-${++sequence}`, studentName: name, date, status: 'active' });
            onChange();
        },
        cancelHolding: async id => update(holdings, id, { status: 'cancelled' }),
        cancelAbsence: async id => update(absences, id, { status: 'cancelled' }),
        cancelHoldingInSheets: async () => { student = clone(reviewStudent); onChange(); },
        onSeatsFreedForDates: async () => {},
        getContractHistory: async () => [],
        createMakeupWaitlist: async (name, _phone, slot, originalClass) => {
            const id = `review-wait-${++sequence}`;
            waitlists.push({ id, studentName: name, ...clone(slot), originalClass: clone(originalClass), status: 'waiting', createdAt: { seconds: Date.now() / 1000 } });
            onChange(); return id;
        },
        getActiveMakeupWaitlists: async () => waitlists.filter(row => ['waiting', 'notified'].includes(row.status)).map(row => ({ ...row })),
        updateMakeupWaitlistStatus: async (id, status) => update(waitlists, id, { status }),
        acceptMakeupWaitlist: async id => update(waitlists, id, { status: 'accepted' }),
        declineMakeupWaitlist: async id => update(waitlists, id, { status: 'declined' }),
        onSeatFreed: async () => {},
        // 맞교환 — 실제 서비스와 같은 순수 로직으로 메모리에 두 보강을 만든다(외부 호출 없음)
        acceptSwapRequest: async (entry, myName) => {
            const row = waitlists.find(w => w.id === entry.id);
            if (!row || row.status !== 'waiting') throw new Error('그 사이 상대의 교환 요청이 마감되었거나 다른 사람과 교환되었어요.');
            const m = buildSwapMakeups(row, myName);
            for (const x of [m.requester, m.partner]) makeups.push({ id: `review-makeup-${++sequence}`, ...clone(x), status: 'active' });
            Object.assign(row, { status: 'accepted', swapWith: myName });
            onChange(); return { makeups: m };
        },
        tryAutoSwap: async (id, myName) => {
            const all = waitlists.map(w => ({ ...w, createdAtMs: w.createdAtMs ?? (w.createdAt?.seconds || 0) * 1000 }));
            const mine = all.find(w => w.id === id);
            const partner = mine && findMutualSwap(mine, all, new Date());
            if (!partner) return null;
            const m = buildSwapMakeups(partner, myName);
            for (const x of [m.requester, m.partner]) makeups.push({ id: `review-makeup-${++sequence}`, ...clone(x), status: 'active' });
            Object.assign(waitlists.find(w => w.id === partner.id), { status: 'accepted', swapWith: myName });
            Object.assign(waitlists.find(w => w.id === id), { status: 'accepted', swapWith: partner.studentName });
            onChange(); return { makeups: m, partner };
        },
        processHolidayMakeupEndDate: async () => ({ success: true, updated: false }),
    };
    return {
        services,
        noticeServices,
        get student() { return student; },
        async requestHolding() {
            const holding = holdings.find(row => row.status === 'active' && !row.sheetsApplied);
            if (!holding) return;
            const end = shiftEndDateBySessions({ endDate: new Date('2026-10-15T00:00:00'), deltaSessions: holding.holdingDates.length, classDays: [2, 4], holdingRanges: [], isHoliday: isHolidayDate });
            const endDate = `${String(end.getFullYear()).slice(2)}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`;
            student = { ...student, '홀딩 사용여부': 'O', '홀딩 시작일': holding.startDate, '홀딩 종료일': holding.endDate, 종료날짜: endDate };
            onChange();
        },
        getCellData(day, period) {
            const date = `2026-09-${String(Number(reviewWeekDates[day].split('/')[1])).padStart(2, '0')}`;
            const currentCount = day === '금' && period.id === 5 ? (offeredSeat ? 6 : 7) : 4;
            const makeupIn = makeups.filter(row => row.status !== 'cancelled' && row.makeupClass.date === date && row.makeupClass.period === period.id).length;
            const makeupOut = makeups.filter(row => row.status !== 'cancelled' && row.originalClass.date === date && row.originalClass.period === period.id).length;
            const count = currentCount + makeupIn - makeupOut;
            return { currentCount: count, availableSeats: Math.max(0, 7 - count), isFull: count >= 7, studentNames: ['예시 A', '예시 B'], students: [], holdingStudents: [], makeupStudents: [] };
        },
        offerSeat() {
            const first = waitlists.find(row => row.status === 'waiting');
            if (!first) return false;
            first.status = 'notified';
            offeredSeat = true;
            first.notifiedAt = { toMillis: () => Date.now() };
            onChange(); return true;
        },
        showStatusExamples() {
            student = { ...clone(reviewStudent), '요일 및 시간': '화5목5금5', 주횟수: '3' };
            makeups.splice(0, makeups.length, { id: 'review-status-makeup', studentName: reviewUser.username, status: 'active', originalClass: { date: '2026-09-15', day: '화', period: 5, periodName: '5교시' }, makeupClass: { date: '2026-09-16', day: '수', period: 4, periodName: '4교시' } });
            holdings.splice(0, holdings.length, { id: 'review-status-holding', studentName: reviewUser.username, status: 'active', startDate: '2026-09-17', endDate: '2026-09-17', holdingDates: ['2026-09-17'], sheetsApplied: true });
            absences.splice(0, absences.length, { id: 'review-status-absence', studentName: reviewUser.username, status: 'active', date: '2026-09-18' });
            freeWorkouts.splice(0, freeWorkouts.length, { id: 'review-status-attendance', studentName: reviewUser.username, date: '2026-09-14' });
            waitlists.length = 0;
            onChange();
        },
        // 다른 수강생들의 맞교환 요청(가상 인물). 예시 수강생은 화5·목5 수강.
        showSwapExamples() {
            const c = (date, day, period) => ({ date, day, period, periodName: `${period}교시` });
            waitlists.push(
                { id: 'review-swap-1', studentName: '가상 이지훈', ...c('2026-09-17', '목', 5), originalClass: c('2026-09-18', '금', 4), status: 'waiting', createdAtMs: 1 },
                { id: 'review-swap-2', studentName: '가상 박서연', ...c('2026-09-17', '목', 5), originalClass: c('2026-09-18', '금', 1), status: 'waiting', createdAtMs: 2 },
                { id: 'review-swap-3', studentName: '가상 최민준', ...c('2026-09-18', '금', 2), originalClass: c('2026-09-17', '목', 1), status: 'waiting', createdAtMs: 3 },
                { id: 'review-swap-4', studentName: '가상 김도윤', ...c('2026-09-17', '목', 5), originalClass: c('2026-09-18', '금', 5), status: 'waiting', createdAtMs: 4 },
            );
            onChange();
        },
        get makeups() { return makeups; },
        get holdings() { return holdings.filter(row => row.status === 'active'); },
        get absences() { return absences.filter(row => row.status === 'active'); },
        get freeWorkoutByDate() { return Object.groupBy(freeWorkouts, row => row.date); },
    };
}
