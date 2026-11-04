import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ownershipModule = createRequire(import.meta.url)('./_sheetOwnership.js');
import { describe, expect, it, vi } from 'vitest';
import { checkSignedIn } from './_signedIn.js';
import { createOccupancyLoader, readOnlySheetsTransport } from './_publicOccupancy.js';

// 시트 서버 함수는 로그인한 사람만 쓴다(2026-11-04). 운영에서 로그인 없이 명단을 읽고 쓸 수 있던 구멍.
function loadSheets({ caller = 'ok', requireSignIn = true } = {}) {
    const client = { spreadsheets: {
        get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: 'synthetic' } }] } })),
        values: { get: vi.fn(async () => ({ data: { values: [['홍길동', '010-0000-0000']] } })), update: vi.fn() },
    } };
    const occupancy = vi.fn(async () => ({ '월-4': 5 }));
    const context = { exports: {}, process: { env: { GOOGLE_SHEETS_ID: 'synthetic' } }, console: { log() {}, warn() {}, error() {} },
        require: module => {
            if (module === './_sheetOwnership') return ownershipModule;
            if (module === './_signedIn') return { readCaller: async () => ({ status: caller, claims: { name: '코치', isCoach: true } }), adminFirestore: () => null };
            if (module === './_publicOccupancy') return { createOccupancyLoader: () => occupancy, readPendingRegistrations: async () => [] };
            return { sheets: () => client, auth: { GoogleAuth: class {} } };
        } };
    let source = readFileSync(new URL('./sheets.js', import.meta.url), 'utf8');
    if (!requireSignIn) source = source.replace('const REQUIRE_SIGN_IN = true;', 'const REQUIRE_SIGN_IN = false;');
    vm.runInNewContext(source, context);
    return { handler: context.exports.handler, client, occupancy };
}
const read = { httpMethod: 'GET', path: '/.netlify/functions/sheets/read', queryStringParameters: { range: 'synthetic!A:R' } };

describe('시트 서버 함수 로그인 확인', () => {
    it('CORS가 로그인 증표 헤더를 허용한다(앱이 증표를 보내도 preflight가 막히지 않게)', async () => {
        const { handler } = loadSheets();
        const result = await handler({ httpMethod: 'OPTIONS', path: '/.netlify/functions/sheets/read' });
        expect(result.headers['Access-Control-Allow-Headers']).toContain('Authorization');
    });

    it('로그인 필수 모드: 증표가 없거나 무효면 401, 시트는 읽지 않는다', async () => {
        for (const caller of ['missing', 'invalid']) {
            const { handler, client } = loadSheets({ caller, requireSignIn: true });
            const result = await handler(read);
            expect(result.statusCode).toBe(401);
            expect(result.body).not.toContain('010-0000-0000');
            expect(client.spreadsheets.values.get).not.toHaveBeenCalled();
        }
    });

    it('로그인 필수 모드: 로그인한 사람은 그대로 읽는다', async () => {
        const { handler } = loadSheets({ caller: 'ok', requireSignIn: true });
        expect((await handler(read)).statusCode).toBe(200);
    });

    it('운영 소스는 로그인 필수로 배포돼 있다', () => {
        expect(readFileSync(new URL('./sheets.js', import.meta.url), 'utf8')).toContain('const REQUIRE_SIGN_IN = true;');
    });

    it('전환기 모드(false)였을 때는 증표가 없어도 막지 않았다', async () => {
        const { handler } = loadSheets({ caller: 'missing', requireSignIn: false });
        expect((await handler(read)).statusCode).toBe(200);
    });

    it('빈자리 창구는 로그인 없이 숫자만 준다', async () => {
        const { handler, client } = loadSheets({ caller: 'missing', requireSignIn: true });
        const result = await handler({ httpMethod: 'GET', path: '/.netlify/functions/sheets/occupancy' });
        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({ success: true, occupancy: { '월-4': 5 } });
        expect(client.spreadsheets.values.get).not.toHaveBeenCalled();
    });
});

describe('checkSignedIn', () => {
    const event = token => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
    it('증표 없음 / 검증 실패 / 이름 클레임 없음 / 정상', async () => {
        expect(await checkSignedIn(event(), vi.fn())).toBe('missing');
        expect(await checkSignedIn(event('bad'), async () => { throw new Error('expired'); })).toBe('invalid');
        expect(await checkSignedIn(event('t'), async () => ({}))).toBe('invalid');
        expect(await checkSignedIn(event('t'), async () => ({ name: '홍길동' }))).toBe('ok');
    });
});

describe('공개 빈자리 계산', () => {
    const sheetsApi = () => ({ spreadsheets: {
        get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: '등록생 목록(26년11월)' } }] } })),
        values: { batchGet: vi.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(range => ({ range,
            values: [[], ['번호', '이름', '주횟수', '요일 및 시간'], ['1', '재학생', '2', '월4수4']] })) } })) },
    } });

    it('읽기 전용 통로는 쓰기 요청을 거부한다', async () => {
        const transport = readOnlySheetsTransport(sheetsApi(), 'id');
        await expect(transport.post('/batchUpdate', {})).rejects.toThrow();
        await expect(transport.get('/read?range=A:R')).rejects.toThrow();
        expect((await transport.get('/info')).sheets).toEqual(['등록생 목록(26년11월)']);
    });

    it('승인 대기 신청을 더한 칸별 숫자만 돌려주고 60초 동안 재사용한다', async () => {
        let t = 0;
        const readPending = vi.fn(async () => [{ name: '신청자', status: 'pending', requestedSlots: [{ day: '화', period: 1 }] }]);
        const load = createOccupancyLoader({ sheets: sheetsApi(), spreadsheetId: 'id', readPending, now: () => t });
        const first = await load();
        expect(first).toEqual({ '월-4': 1, '수-4': 1, '화-1': 1 });
        expect(JSON.stringify(first)).not.toMatch(/신청자|재학생/);
        t = 30000; await load();
        expect(readPending).toHaveBeenCalledTimes(1);
        t = 61000; await load();
        expect(readPending).toHaveBeenCalledTimes(2);
    });
});

describe('수강생 증표의 시트 쓰기', () => {
    function loadAs(claims, owner) {
        const client = { spreadsheets: { values: {
            batchGet: vi.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(() => ({ values: [[owner]] })) } })),
            batchUpdate: vi.fn(async () => ({ data: { totalUpdatedCells: 1 } })), update: vi.fn(async () => ({ data: {} })), append: vi.fn(),
        } } };
        const context = { exports: {}, process: { env: { GOOGLE_SHEETS_ID: 'synthetic' } }, console: { log() {}, warn() {}, error() {} },
            require: module => module === './_sheetOwnership' ? ownershipModule
                : module === './_signedIn' ? { readCaller: async () => ({ status: 'ok', claims }), adminFirestore: () => null }
                : { sheets: () => client, auth: { GoogleAuth: class {} } } };
        vm.runInNewContext(readFileSync(new URL('./sheets.js', import.meta.url), 'utf8'), context);
        return { handler: context.exports.handler, client };
    }
    const post = (path, body) => ({ httpMethod: 'POST', path: `/.netlify/functions/sheets/${path}`, body: JSON.stringify(body) });
    const update = { data: [{ range: 'synthetic!H5', values: [['261231']] }] };

    it('남의 행이면 403, 쓰지 않는다', async () => {
        const { handler, client } = loadAs({ name: '김기안', isCoach: false }, '홍길동');
        expect((await handler(post('batchUpdate', update))).statusCode).toBe(403);
        expect(client.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it('본인 행이면 쓴다', async () => {
        const { handler, client } = loadAs({ name: '김기안', isCoach: false }, '김기안');
        expect((await handler(post('batchUpdate', update))).statusCode).toBe(200);
        expect(client.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('행 추가는 코치만', async () => {
        const { handler, client } = loadAs({ name: '김기안', isCoach: false }, '김기안');
        expect((await handler(post('append', { range: 'synthetic!A:R', values: [['x']] }))).statusCode).toBe(403);
        expect(client.spreadsheets.values.append).not.toHaveBeenCalled();
    });

    it('코치는 검사 없이 쓴다', async () => {
        const { handler, client } = loadAs({ name: '코치', isCoach: true }, '홍길동');
        expect((await handler(post('batchUpdate', update))).statusCode).toBe(200);
        expect(client.spreadsheets.values.batchGet).not.toHaveBeenCalled();
    });
});
