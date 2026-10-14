import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

function loadSheets() {
    const client = { spreadsheets: {
        get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: 'synthetic' } }] } })),
        values: { get: vi.fn(async () => ({ data: { values: [['synthetic']] } })),
            batchGet: vi.fn(async () => ({ data: { valueRanges: [{ values: [['synthetic']] }] } })) },
    } };
    const createClient = vi.fn(() => client);
    let authCount = 0;
    class GoogleAuth { constructor() { authCount++; } }
    const context = { exports: {}, process: { env: { GOOGLE_SHEETS_ID: 'synthetic' } }, console: { log() {}, error() {} },
        require: module => {
            expect(module).toBe('@googleapis/sheets');
            return { sheets: createClient, auth: { GoogleAuth } };
        } };
    vm.runInNewContext(readFileSync(new URL('./sheets.js', import.meta.url), 'utf8'), context);
    return { handler: context.exports.handler, createClient, client, authCount: () => authCount };
}

it('Sheets OPTIONS는 인증 클라이언트를 만들지 않고 긴 preflight 캐시를 반환한다', async () => {
    const service = loadSheets();
    const result = await service.handler({ httpMethod: 'OPTIONS', path: '/.netlify/functions/sheets/batchGet' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['Access-Control-Max-Age']).toBe('86400');
    expect(service.authCount()).toBe(0);
    expect(service.createClient).not.toHaveBeenCalled();
});

it('연속 Sheets 읽기는 같은 GoogleAuth/Sheets 클라이언트를 재사용하며 결과를 보존한다', async () => {
    const service = loadSheets();
    const info = await service.handler({ httpMethod: 'GET', path: '/.netlify/functions/sheets/info' });
    const read = await service.handler({ httpMethod: 'GET', path: '/.netlify/functions/sheets/read', queryStringParameters: { range: 'synthetic!A1' } });
    const batch = await service.handler({ httpMethod: 'POST', path: '/.netlify/functions/sheets/batchGet', body: JSON.stringify({ ranges: ['synthetic!A1'] }) });
    expect(JSON.parse(info.body).sheets).toEqual(['synthetic']);
    expect(JSON.parse(read.body).values).toEqual([['synthetic']]);
    expect(JSON.parse(batch.body).valueRanges).toHaveLength(1);
    expect(service.authCount()).toBe(1);
    expect(service.createClient).toHaveBeenCalledTimes(1);
    expect(service.client.spreadsheets.get).toHaveBeenCalledTimes(1);
    expect(service.client.spreadsheets.values.get).toHaveBeenCalledTimes(1);
});

it('Auth OPTIONS는 로그인/관리자 초기화 없이 긴 preflight 캐시를 반환한다', async () => {
    const requireModule = vi.fn(() => ({}));
    const context = { exports: {}, process: { env: {} }, console, require: requireModule };
    vm.runInNewContext(readFileSync(new URL('./auth.js', import.meta.url), 'utf8'), context);
    const result = await context.exports.handler({ httpMethod: 'OPTIONS', path: '/.netlify/functions/auth/login' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['Access-Control-Max-Age']).toBe('86400');
});
