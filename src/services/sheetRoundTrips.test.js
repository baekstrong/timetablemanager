// 시트 쓰기 경로의 "왕복 횟수" 회귀 테스트.
//
// 이 경로들은 예전에 등록생 시트를 하나씩 읽고(탭 수만큼 왕복) 행마다 따로 썼다.
// 프로덕션 왕복 1회가 ≈0.73초라 버튼 한 번이 12초를 넘었다. 고친 뒤에도 누가
// 반복문 안에 readSheetData/writeSheetData를 다시 넣으면 조용히 되돌아가므로,
// 동작이 아니라 **호출 횟수**를 못 박아 둔다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    clearStudentScheduleAllSheets, pauseStudent, requestHolding,
    getAllStudentsFromAllSheets, invalidateStudentSheetCache,
    processCoachHolding, processStudentAbsence, processScheduleTransfer, findStudentAcrossSheets,
    processHolidayMakeupEndDate, updateStudentData,
} from './googleSheetsService';

const SHEETS = ['등록생 목록(26년8월)', '등록생 목록(26년7월)', '등록생 목록(26년6월)'];

// A~R 헤더 (2행). 인덱스: 1=이름, 2=주횟수, 3=요일및시간, 4=특이사항, 6=시작날짜, 7=종료날짜
const HEADERS = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록',
    '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식',
    '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일', '핸드폰', '성별', '직업'];

const row = ({ name, schedule = '월1수1', start = '', end = '' }) => {
    const r = Array(18).fill('');
    r[1] = name; r[2] = '2'; r[3] = schedule; r[6] = start; r[7] = end;
    return r;
};

// 시트별 데이터: 홍길동은 8월·6월 두 시트에 등록이 있다
const SHEET_ROWS = {
    '등록생 목록(26년8월)': [Array(18).fill(''), HEADERS,
        row({ name: '아무개' }),
        row({ name: '홍길동', start: '260801', end: '260901' }),
        // 미리등록(다음 등록)을 가진 수강생 — 홀딩 시 다음 등록 날짜도 밀린다
        row({ name: '김미리', start: '260801', end: '260901' }),
        row({ name: '김미리', start: '260902', end: '261002' })],
    '등록생 목록(26년7월)': [Array(18).fill(''), HEADERS,
        row({ name: '아무개' })],
    '등록생 목록(26년6월)': [Array(18).fill(''), HEADERS,
        row({ name: '홍길동', start: '260601', end: '260701' })],
};

let calls;

/** 호출된 엔드포인트만 뽑아 센다. */
const countOf = (path) => calls.filter(c => c.path === path).length;

beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url, options) => {
        const u = String(url);
        const path = u.includes('/batchGet') ? 'batchGet'
            : u.includes('/batchUpdate') ? 'batchUpdate'
                : u.includes('/read') ? 'read'
                    : u.includes('/write') ? 'write'
                        : u.includes('/info') ? 'info'
                            : u.includes('/formatCells') ? 'formatCells'
                                : 'other';
        const body = options?.body ? JSON.parse(options.body) : null;
        calls.push({ path, body });

        const json = (o) => ({ ok: true, status: 200, json: async () => ({ success: true, ...o }) });

        if (path === 'info') return json({ sheets: SHEETS });
        if (path === 'batchGet') {
            return json({
                valueRanges: body.ranges.map(r => {
                    const name = r.split('!')[0];
                    return { range: r, values: SHEET_ROWS[name] || [] };
                }),
            });
        }
        if (path === 'read') {
            const name = decodeURIComponent(u.split('range=')[1] || '').split('!')[0];
            return json({ values: SHEET_ROWS[name] || [] });
        }
        return json({});
    });
});

describe('clearStudentScheduleAllSheets (수강 종료) — 왕복 횟수', () => {
    it('시트가 몇 개든 batchGet 1회 + batchUpdate 1회로 끝난다', async () => {
        await clearStudentScheduleAllSheets('홍길동');

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);
        // 개별 읽기·쓰기로 되돌아가면 실패한다
        expect(countOf('read')).toBe(0);
        expect(countOf('write')).toBe(0);
    });

    it('여러 시트에 걸친 행을 한 요청에 모아 지운다', async () => {
        await clearStudentScheduleAllSheets('홍길동');

        const upd = calls.find(c => c.path === 'batchUpdate').body.data;
        expect(upd).toHaveLength(2); // 8월 4행 + 6월 3행
        expect(upd.map(u => u.range).sort()).toEqual([
            '등록생 목록(26년6월)!D3',
            '등록생 목록(26년8월)!D4',
        ]);
        upd.forEach(u => expect(u.values).toEqual([['']]));
    });

    it('해당 학생이 없으면 아무것도 쓰지 않는다', async () => {
        await clearStudentScheduleAllSheets('없는사람');
        expect(countOf('batchUpdate')).toBe(0);
    });
});

describe('requestHolding (홀딩 신청) — 왕복 횟수', () => {
    // 학생이 "신청 중" 화면에서 기다리는 구간. 여기가 길어지면 앱을 닫고,
    // 그러면 Firestore에만 남고 시트에 반영되지 않는다(2026-08 실제 유실 2건).
    const aug = (d) => new Date(`2026-08-${d}T00:00:00`);

    it('시트 왕복은 batchGet 1 + batchUpdate 1뿐 (색칠은 기다리지 않는다)', async () => {
        await requestHolding('홍길동', aug('10'), aug('12'), null, null, [], [], 0, 'current', []);

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('read')).toBe(0);
        expect(countOf('write')).toBe(0);
    });

    it('M/N/O + 종료일을 한 요청에 함께 쓴다', async () => {
        await requestHolding('홍길동', aug('10'), aug('12'), null, null, [], [], 0, 'current', []);

        const upd = calls.find(c => c.path === 'batchUpdate').body.data;
        const cols = upd.map(u => u.range.split('!')[1].replace(/\d+/, '')).sort();
        expect(cols).toEqual(['H', 'M', 'N', 'O']); // 종료일 + 홀딩 3열
    });

    it('미리등록이 있어도 쓰기는 1회 — 다음 등록 조정분까지 같은 요청에 넣는다', async () => {
        await requestHolding('김미리', aug('10'), aug('12'), null, null, [], [], 0, 'current', []);

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);

        // 본 등록 H·M·N·O(5행) + 다음 등록 G·H(6행)
        const upd = calls.find(c => c.path === 'batchUpdate').body.data;
        const rows6 = upd.filter(u => /!\w+6$/.test(u.range));
        expect(rows6.length).toBeGreaterThan(0); // 다음 등록도 같은 요청에 실렸다
    });

    it('색칠(formatCells)을 await 하지 않는다 — batchUpdate 이후에 나가도 대기 없음', async () => {
        await requestHolding('홍길동', aug('10'), aug('12'), null, null, [], [], 0, 'current', []);
        // 던지고 넘어가므로 반환 시점엔 아직 안 나갔을 수 있다. 나갔든 안 나갔든
        // batchUpdate 앞을 막지 않는 것이 핵심이라 순서만 확인한다.
        const iUpd = calls.findIndex(c => c.path === 'batchUpdate');
        const iFmt = calls.findIndex(c => c.path === 'formatCells');
        expect(iUpd).toBeGreaterThanOrEqual(0);
        if (iFmt !== -1) expect(iFmt).toBeGreaterThan(iUpd);
    });
});

describe('getAllStudentsFromAllSheets (시간표 데이터 로드) — 왕복 횟수', () => {
    it('시트가 몇 개든 batchGet 1회로 읽는다 (+ 시트목록 조회 1회)', async () => {
        invalidateStudentSheetCache();
        const students = await getAllStudentsFromAllSheets();

        // 빈손으로 통과하지 않도록 — 실제로 파싱까지 됐는지 먼저 확인
        expect(students.length).toBeGreaterThan(0);
        expect(students.map(s => s['이름'])).toContain('홍길동');

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('read')).toBe(0);
        expect(countOf('batchUpdate')).toBe(0);
    });

    it('30초 캐시 — 연속 호출은 시트를 다시 읽지 않는다', async () => {
        invalidateStudentSheetCache();
        await getAllStudentsFromAllSheets();
        await getAllStudentsFromAllSheets();
        await getAllStudentsFromAllSheets();

        expect(countOf('batchGet')).toBe(1); // 3회 호출인데 읽기는 1회
    });
});

describe('다음 등록 조정을 따로 쓰지 않는다 — 나머지 경로', () => {
    // 미리등록이 있는 수강생은 예전에 이 경로들이 전부 쓰기를 2회 했다.
    // collector로 본 업데이트에 합쳤으므로 어느 경로든 batchUpdate는 1회여야 한다.
    it('코치 홀딩 처리 — batchUpdate 1회', async () => {
        await processCoachHolding('김미리', ['2026-08-10', '2026-08-12'], [], []);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('write')).toBe(0);
    });

    it('결석 처리 — batchUpdate 1회', async () => {
        await processStudentAbsence('김미리', ['2026-08-10'], []);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('write')).toBe(0);
    });

    it('시간표 이동 — batchUpdate 1회', async () => {
        await processScheduleTransfer('김미리', '화5목5', []);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('write')).toBe(0);
    });
});

describe('findStudentAcrossSheets — 재등록 검색 vs 학생 조회', () => {
    // 재등록은 직전 수강 종료 며칠 뒤에 일어나 '오늘 활성 등록'이 거의 없다.
    // 그렇다고 전 시트를 다시 읽을 필요는 없다 — 직전 등록 행은 최근 시트에 그대로 있다
    // (실제 재등록 421건 중 75.8%). 활성 여부로 폴백을 걸면 왕복만 는다.
    it('requireActive:false — 윈도우에서 찾으면 전체 스캔하지 않는다', async () => {
        invalidateStudentSheetCache();
        await findStudentAcrossSheets('홍길동', { requireActive: false });

        expect(countOf('batchGet')).toBe(1); // 윈도우 1회로 끝 (폴백 없음)
        expect(countOf('info')).toBe(0);     // 폴백을 안 타니 시트목록도 안 읽음
        expect(countOf('read')).toBe(0);
    });

    it('requireActive:false — 못 찾으면 그때는 전체를 스캔한다', async () => {
        invalidateStudentSheetCache();
        await findStudentAcrossSheets('없는사람', { requireActive: false });

        expect(countOf('batchGet')).toBe(2); // 윈도우 + 폴백
        expect(countOf('read')).toBe(0);
    });

    it('기본(requireActive:true) — 학생 조회 경로는 그대로', async () => {
        invalidateStudentSheetCache();
        await findStudentAcrossSheets('홍길동');

        expect(countOf('read')).toBe(0);
        expect(countOf('batchGet')).toBeLessThanOrEqual(2);
    });

    it('찾은 수강생 정보를 제대로 돌려준다', async () => {
        invalidateStudentSheetCache();
        const found = await findStudentAcrossSheets('홍길동', { requireActive: false });
        expect(found).toBeTruthy();
        expect(found.student['이름']).toBe('홍길동');
    });
});

describe('processHolidayMakeupEndDate — 공휴일 아니면 시트를 아예 안 읽는다', () => {
    // 보강 신청·대기수락마다 불린다. 공휴일 판정은 시트 없이 되는 순수 계산인데
    // 예전엔 읽고 나서 걸러 98.9%(실측 641건 중 634건)가 헛읽기였다.
    it('원수업이 공휴일이 아니면 읽기 0회', async () => {
        const r = await processHolidayMakeupEndDate('홍길동', ['2026-08-10'], []);

        expect(countOf('batchGet')).toBe(0);
        expect(countOf('read')).toBe(0);
        expect(countOf('info')).toBe(0);
        expect(r).toMatchObject({ updated: false, reason: 'no-holiday-makeup' });
    });

    it('커스텀 공휴일이면 그때는 읽는다 (판정을 건너뛰지 않는다)', async () => {
        await processHolidayMakeupEndDate('홍길동', ['2026-08-10'], [{ date: '2026-08-10' }]);
        expect(countOf('batchGet')).toBe(1);
    });

    it('한국 공휴일(광복절)도 읽는다', async () => {
        await processHolidayMakeupEndDate('홍길동', ['2026-08-15'], []);
        expect(countOf('batchGet')).toBe(1);
    });
});

describe('updateStudentData — 필드마다 쓰지 않는다', () => {
    it('여러 칸을 batchUpdate 1회로 쓴다', async () => {
        await updateStudentData(1, {
            _foundSheetName: '등록생 목록(26년8월)',
            주횟수: '3', '요일 및 시간': '월1수1금1', 시작날짜: '260901', 종료날짜: '261001',
        });

        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('write')).toBe(0); // 개별 write로 되돌아가면 실패
        expect(calls.find(c => c.path === 'batchUpdate').body.data).toHaveLength(4);
    });
});

describe('pauseStudent (일시정지) — 왕복 횟수', () => {
    it('등록이 여러 시트에 있어도 batchGet 1회 + batchUpdate 1회', async () => {
        await pauseStudent('홍길동', []);

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('read')).toBe(0);
        expect(countOf('write')).toBe(0);
    });

    it('정지할 등록이 없으면 던지고, 시트에 쓰지 않는다', async () => {
        await expect(pauseStudent('없는사람', [])).rejects.toThrow('정지할 등록을 찾지 못했습니다.');
        expect(countOf('batchUpdate')).toBe(0);
    });
});
