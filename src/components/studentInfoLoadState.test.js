// 내 정보(StudentInfo) 화면이 "아직 안 온 데이터"를 어떻게 다루는지 고정하는 회귀 테스트.
//
// 예전엔 로딩 오버레이가 Firebase 3건만 기다리고 정작 느린 구글 시트는 안 기다렸다.
// 그 틈에 studentData가 null이면 그럴싸한 목 데이터(2025-12-20~2026-01-19, 주2회, 남은 8회)가
// 진짜처럼 그려졌다가 1~2초 뒤 바뀌었고, 시트에 행이 없는 계정은 그 가짜가 영구히 보였다.
//
// 이 저장소엔 jsdom·testing-library가 없어(environment: 'node') 컴포넌트를 띄울 수 없다.
// 그래서 원본 소스에서 배선과 금지 패턴을 직접 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const app = read('../App.jsx');
const info = read('./StudentInfo.jsx');

describe('StudentInfo — 시트 로딩이 화면을 가리는가', () => {
    it('App이 시트 로딩 상태를 StudentInfo에 넘긴다', () => {
        const tag = app.match(/<StudentInfo[^>]*>/)?.[0] || '';
        expect(tag).toContain('isLoading={isStudentDataLoading}');
    });

    it('오버레이가 Firebase와 시트를 함께 기다린다', () => {
        expect(info).toMatch(/stillLoading\s*=\s*loading\s*\|\|\s*isLoading/);
        // 오버레이 조건이 firebase 전용 loading으로 되돌아가면 다시 가짜가 새어나온다
        expect(info).toContain('{stillLoading && (');
    });

    it('그럴싸한 가짜 날짜가 코드에 남아 있지 않다', () => {
        // 주석은 뺀다 — 위 설명 주석에도 그 날짜가 적혀 있고, 그건 남겨두는 게 맞다.
        const code = info.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ['2025-12-20', '2026-01-19', '2026-01-08', '2026-01-07'].forEach((d) => {
            expect(code).not.toContain(d);
        });
    });

    it('데이터를 끝내 못 받으면 못 찾았다고 말한다', () => {
        expect(info).toContain('!stillLoading && !studentData');
        expect(info).toContain('수강 정보를 찾을 수 없습니다');
    });
});

describe('본인 등록 조회 — 시트를 한 번만 읽는가', () => {
    // getStudentByName(현재월 1장)은 findStudentAcrossSheets(±2개월)의 부분집합이라
    // 내용이 중복인데 await로 막혀 왕복만 1회 늘었다 (실측 1161ms → 614ms).
    it('App은 현재월 선조회(getStudentByName)를 하지 않는다', () => {
        expect(app).not.toContain('getStudentByName');
    });

    it('로그인·빙의 두 경로 모두 폴백을 끈 조회를 쓴다', () => {
        expect(app).toContain('const STUDENT_LOOKUP = { requireActive: false }');
        const uses = app.match(/findStudentAcrossSheets\([^)]*\)/g) || [];
        expect(uses.length).toBe(2); // handleLogin + loadStudentDataInBackground
        uses.forEach((u) => expect(u).toContain('STUDENT_LOOKUP'));
    });

    it('대시보드의 본인 종료일 조회도 같은 규약', () => {
        const dash = read('./Dashboard.jsx');
        expect(dash).toMatch(/findStudentAcrossSheets\(user\.username,\s*\{\s*requireActive:\s*false\s*\}\)/);
    });
});
