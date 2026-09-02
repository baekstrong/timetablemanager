// 훈련일지 진입 비용 회귀 방지.
// coach.js/main.js는 window.firebase에 의존해 vitest(jsdom 없음)에서 못 띄운다 →
// studentInfoLoadState.test.js와 같은 방식으로 소스에서 직접 배선을 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const coach = read('./coach.js');
const main = read('../main.js');

describe('코치 세션 뷰 조회 범위', () => {
    // 화면에 그리는 건 학생당 하루치뿐인데 90일을 받던 시절 7명 기준 560건/2.8MB가
    // 매 진입마다 내려왔다. 이 숫자를 키우면 그대로 진입 지연으로 돌아온다.
    it('진입 조회는 21일 이내', () => {
        const m = coach.match(/const SESSION_DAYS = (\d+);/);
        expect(m, 'SESSION_DAYS 상수가 사라짐').not.toBeNull();
        expect(Number(m[1])).toBeLessThanOrEqual(21);
    });

    it('그 사이 기록이 없는 수강생도 더 보기로 이전 기록을 볼 수 있다', () => {
        // 오래 쉰 수강생이 '기록 없음'으로 끝나 지난 기록을 볼 길이 막히면 안 된다.
        const empty = coach.slice(coach.indexOf('const canLoadMore'), coach.indexOf('const selDate'));
        expect(empty).toMatch(/이전 기록 불러오기/);
        expect(empty).toMatch(new RegExp(`changeCoachSessionDate\\(this\\.dataset\\.student, '\\$\\{MORE_OPTION\\}'\\)`));
    });

    it('넓은 범위는 드롭다운 더 보기에서만 조회한다', () => {
        // 진입 경로(renderCoachSessionView)는 SESSION_DAYS로만 부른다.
        expect(coach).toMatch(/fetchSessions\(name, SESSION_DAYS\)/);
        // 넓은 범위는 사용자가 '더 보기'를 고른 changeCoachSessionDate에서만.
        const more = coach.match(/fetchSessions\(name, SESSION_DAYS_MORE\)/g) || [];
        expect(more.length).toBe(1);
    });
});

describe('진입 조회 병렬화', () => {
    it('명단 메타를 users 조회와 나란히 던진다', () => {
        // prefetch가 users.get() await보다 앞에 있어야 병렬이 된다.
        const p = coach.indexOf('const prefetch = prefetchEntryData()');
        const u = coach.indexOf("await db.collection('users').get()");
        expect(p).toBeGreaterThan(-1);
        expect(u).toBeGreaterThan(-1);
        expect(p).toBeLessThan(u);
    });

    it('새로고침 경로도 6건을 한 번에 던진다', () => {
        // 직렬 await 사슬로 되돌아가면 새로고침이 다시 5왕복이 된다.
        expect(coach).toMatch(/await Promise\.all\(\[\s*\n\s*loadSchedules\(true\), loadRosterForDate/);
    });
});

describe('진입 시 흰 화면', () => {
    it('셸을 autoLogin await보다 먼저 그린다', () => {
        const shell = main.indexOf('paintShell();');
        const login = main.indexOf('await Auth.autoLogin()');
        expect(shell).toBeGreaterThan(-1);
        expect(login).toBeGreaterThan(-1);
        expect(shell).toBeLessThan(login);
    });

    it('셸은 Firestore를 건드리지 않는다', () => {
        // 규칙이 signedIn을 요구하므로 인증 전 조회는 permission-denied로 죽는다.
        const body = main.slice(main.indexOf('function paintShell()'), main.indexOf('window.render = async function'));
        expect(body).not.toMatch(/load|db\.|collection\(/);
    });

    it('autoLogin 실패를 반환값으로 알 수 있다', () => {
        // 낙관적으로 세운 세션을 되돌리려면 성공 여부가 필요하다.
        expect(main).toMatch(/const authed = await Auth\.autoLogin\(\)/);
        expect(main).toMatch(/if \(!authed\)/);
    });
});
