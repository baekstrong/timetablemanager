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

    it('셸을 그린 뒤 state를 되돌려 로그인 판정을 건드리지 않는다', () => {
        // 훈련일지 JS는 해시 없는 ES 모듈 → 브라우저가 main.js와 auth.js를 따로 캐시 갱신한다.
        // autoLogin의 반환값 같은 모듈 간 새 계약을 만들면 '새 main + 옛 auth' 조합에서
        // 코치가 로그인 화면으로 튕긴다(실제 발생). 판정은 예전 그대로 state.currentUser 하나뿐이어야 한다.
        const block = main.slice(main.indexOf('const saved = loadSavedLogin()'), main.indexOf('Web App Initialized'));
        // paintShell과 state 되돌리기 사이에 낀 건 캐시 페인트(옵셔널 호출)뿐이어야 한다.
        expect(block).toMatch(/paintShell\(\);[\s\S]{0,600}?\n\s*state\.currentUser = null;\n\s*state\.isCoach = false;/);
        expect(block).toMatch(/if \(!state\.currentUser\) \{\s*\n\s*await Auth\.autoLogin\(\);/);
        expect(block).not.toMatch(/await Auth\.autoLogin\(\)\s*;?\s*\n?\s*(const|let|if \(!authed)/);
    });
});

describe('명단을 네트워크보다 먼저 그린다', () => {
    const html = read('../../index.html');

    it('users 서버 조회를 기다리기 전에 캐시로 그린다', () => {
        // 이 순서가 뒤집히면 명단이 다시 콜드 연결 + IndexedDB 오픈 뒤에야 나타난다.
        const paint = coach.indexOf('paintStudentList(studentListDiv);');
        const get = coach.indexOf("await db.collection('users').get()");
        expect(paint).toBeGreaterThan(-1);
        expect(get).toBeGreaterThan(-1);
        expect(paint).toBeLessThan(get);
    });

    it('조회 실패해도 이미 그린 캐시 명단을 지우지 않는다', () => {
        const c = coach.slice(coach.indexOf("console.error('Error loading student list:'"));
        expect(c.slice(0, 300)).toMatch(/if \(!readStudentsCache\(\)\)/);
    });

    it('인증 전 페인트는 Firestore를 건드리지 않는다', () => {
        // 규칙이 signedIn을 요구하므로 인증 전 조회는 permission-denied로 죽는다.
        const body = coach.slice(coach.indexOf('export function paintCachedStudentList()'),
            coach.indexOf('export async function loadStudentList()'));
        expect(body).not.toMatch(/db\.|collection\(|await /);
    });

    it('main은 옵셔널 호출로 부른다', () => {
        // 해시 없는 ES 모듈 → '새 main + 옛 coach' 조합이 실제로 뜬다. 가드가 없으면 그때 백지가 된다.
        expect(main).toMatch(/if \(state\.isCoach && Coach\.paintCachedStudentList\) Coach\.paintCachedStudentList\(\);/);
    });

    it('연결 힌트가 있다', () => {
        // 앱 전환마다 TLS를 새로 맺는다 — 콜드일 때 호스트당 0.3~1초.
        ['www.gstatic.com', 'firestore.googleapis.com', 'identitytoolkit.googleapis.com']
            .forEach(h => expect(html).toContain(`<link rel="preconnect" href="https://${h}"`));
    });
});

describe('부팅 스플래시', () => {
    const html = read('../../index.html');
    const app = html.slice(html.indexOf('<div id="app">'), html.indexOf('<!-- 수정 모달 -->'));

    it('#app이 비어 있지 않다', () => {
        // 예전엔 <div id="app"></div>였고, firebase CDN 3개 + ES 모듈 16개가 평가될 때까지 회색 백지였다.
        expect(html).not.toContain('<div id="app"></div>');
        expect(app).toContain('class="boot"');
    });

    it('스플래시는 #app 안에 있어 innerHTML 덮어쓰기로 저절로 사라진다', () => {
        // 밖에 두면 paintShell/render가 못 지워서 별도 숨김 로직(=버그날 자리)이 생긴다.
        expect(app.indexOf('class="boot"')).toBeGreaterThan(-1);
        expect(app.indexOf('</div>')).toBeGreaterThan(app.indexOf('class="boot"'));
    });

    it('JS 없이 CSS만으로 동작한다', () => {
        // 스플래시가 보여야 할 시점은 모듈이 아직 평가되기 전이다.
        expect(app).not.toMatch(/<script|onclick=|setTimeout/);
        expect(html).toMatch(/\.boot \{[^}]*animation: bootIn [\d.]+s ease \.25s forwards/);
    });

    it('오래 걸리면 스스로 사정을 밝힌다', () => {
        // 영원히 도는 스피너는 거짓말이라서. 이것도 CSS 지연 애니메이션이라 타이머가 없다.
        expect(html).toMatch(/\.boot-slow \{[\s\S]*?animation: bootIn [\d.]+s ease 8s forwards/);
        expect(app).toContain('새로고침해 주세요');
    });
});
