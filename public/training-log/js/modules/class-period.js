// 지금(또는 방금 끝난) 수업 교시와 그 교시 수강생 명단을 계산한다.
// 순수 함수 — Firebase/DOM 무관. 브라우저·Vitest 양쪽 import 가능.
//
// 교시 시간은 메인 앱 src/data/mockData.js의 PERIODS와 같아야 한다.
// ponytail: 6줄 상수를 Firestore로 발행하느니 여기 복제한다. 시간이 바뀌면 양쪽 같이 수정.
export const PERIODS = [
    { id: 1, label: '1교시', start: '10:00', end: '11:30' },
    { id: 2, label: '2교시', start: '12:00', end: '13:30' },
    { id: 3, label: '3교시(자율)', start: '15:00', end: '17:00' },
    { id: 4, label: '4교시', start: '18:00', end: '19:30' },
    { id: 5, label: '5교시', start: '19:50', end: '21:20' },
    { id: 6, label: '6교시', start: '21:40', end: '23:10' },
];

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS = ['월', '화', '수', '목', '금'];

// 수업 시작 15분 전부터는 '진행 중'으로 본다 — 코치가 수업 직전에 열어도 그 교시가 잡히게.
const LEAD_MIN = 15;

const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD'와 요일 라벨을 함께 돌려주는 헬퍼 (테스트에서 Date를 주입받기 위해 분리)
function dayInfo(date) {
    return { date: ymd(date), dayLabel: DAY_LABELS[date.getDay()] };
}

// 지금 진행 중인 교시가 있으면 status 'now', 없으면 가장 최근에 끝난 교시를 'past'로 돌려준다.
// 이른 아침·주말이면 하루씩 되감아 마지막 평일의 마지막 교시를 찾는다.
// 반환: { period, dayLabel, date, status } | null
export function resolveClassSlot(now = new Date()) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = dayInfo(now);

    if (WEEKDAYS.includes(today.dayLabel)) {
        // 진행 중(시작 15분 전 ~ 종료)
        const live = PERIODS.find(p => nowMin >= toMin(p.start) - LEAD_MIN && nowMin <= toMin(p.end));
        if (live) return { period: live, dayLabel: today.dayLabel, date: today.date, status: 'now' };

        // 오늘 이미 끝난 교시 중 가장 늦은 것
        const done = PERIODS.filter(p => toMin(p.end) < nowMin);
        if (done.length > 0) {
            return { period: done[done.length - 1], dayLabel: today.dayLabel, date: today.date, status: 'past' };
        }
    }

    // 오늘 수업이 아직 없거나 주말 → 직전 평일의 마지막 교시
    const d = new Date(now.getTime());
    for (let i = 0; i < 7; i++) {
        d.setDate(d.getDate() - 1);
        const info = dayInfo(d);
        if (WEEKDAYS.includes(info.dayLabel)) {
            return { period: PERIODS[PERIODS.length - 1], dayLabel: info.dayLabel, date: info.date, status: 'past' };
        }
    }
    return null;
}

// 이번 주 월~금 날짜 { '월': 'YYYY-MM-DD', ... }
// 일요일은 다음 주 월요일 기준 — 메인 앱 시간표(weekDates)와 같은 규칙.
export function weekdayDates(now = new Date()) {
    const dow = now.getDay();
    const monday = new Date(now.getTime());
    monday.setDate(now.getDate() + (dow === 0 ? 1 : 1 - dow));
    const out = {};
    WEEKDAYS.forEach((label, i) => {
        const d = new Date(monday.getTime());
        d.setDate(monday.getDate() + i);
        out[label] = ymd(d);
    });
    return out;
}

// 한 교시 앞으로 되감는다(같은 날 이전 교시 → 없으면 직전 평일 마지막 교시).
// 수업이 없는 빈 교시를 건너뛰고 '실제로 사람이 있던 마지막 수업'을 찾는 데 쓴다.
export function previousSlot(slot) {
    if (!slot) return null;
    const idx = PERIODS.findIndex(p => p.id === slot.period.id);
    if (idx > 0) {
        return { period: PERIODS[idx - 1], dayLabel: slot.dayLabel, date: slot.date, status: 'past' };
    }
    const d = new Date(`${slot.date}T12:00:00`);
    for (let i = 0; i < 7; i++) {
        d.setDate(d.getDate() - 1);
        const info = dayInfo(d);
        if (WEEKDAYS.includes(info.dayLabel)) {
            return { period: PERIODS[PERIODS.length - 1], dayLabel: info.dayLabel, date: info.date, status: 'past' };
        }
    }
    return null;
}

// 그 수업이 이미 끝났는지 (지난 날짜이거나, 오늘이면 종료 시각을 지났는지)
export function slotHasEnded(slot, now = new Date()) {
    if (!slot) return false;
    const today = dayInfo(now).date;
    if (slot.date < today) return true;
    if (slot.date > today) return false;
    return now.getHours() * 60 + now.getMinutes() > toMin(slot.period.end);
}

// 시트 D열 인코딩 '월1수1금1' → [{day:'월',period:1}, ...]
export function parseSchedule(str) {
    const out = [];
    const re = /([월화수목금])\s*(\d)/g;
    let m;
    while ((m = re.exec(String(str || '')))) {
        out.push({ day: m[1], period: Number(m[2]) });
    }
    return out;
}

// {이름: '월1수1'} 맵에서 해당 요일·교시 수강생 이름 목록 (가나다순)
export function rosterFor(schedulesMap, dayLabel, periodId) {
    return Object.entries(schedulesMap || {})
        .filter(([, sch]) => parseSchedule(sch).some(s => s.day === dayLabel && s.period === periodId))
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, 'ko'));
}
