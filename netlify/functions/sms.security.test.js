import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
const realRequire = createRequire(import.meta.url);

function load({ requireCoach = vi.fn(async () => null), checkSignedIn = vi.fn(async () => 'ok'), source } = {}) {
    const fetch = vi.fn();
    const context = vm.createContext({ exports: {},
        require: id => id === './_requireCoach' ? { requireCoach }
            : id === './_signedIn' ? { checkSignedIn, adminFirestore: () => ({}) } : realRequire(id),
        process: { env: { SOLAPI_API_KEY: 'k', SOLAPI_API_SECRET: 's' } }, fetch, console: { log() {}, error() {}, warn() {} },
    });
    vm.runInContext(source ?? readFileSync(new URL('./sms.js', import.meta.url), 'utf8'), context);
    return { handler: context.exports.handler, fetch, requireCoach, checkSignedIn };
}
const call = (handler, path, body) => handler({ httpMethod: 'POST', path: `/.netlify/functions/sms/${path}`, headers: {}, body: JSON.stringify(body) });

it.each([401, 403])('예약문자 취소 권한 거부(%s) 시 Solapi 호출 없음', async denied => {
    const { handler, fetch, requireCoach } = load({ requireCoach: vi.fn(async () => denied) });
    const result = await call(handler, 'cancel-scheduled', { groupId: 'synthetic' });
    expect(result.statusCode).toBe(denied);
    expect(requireCoach).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
});

it.each(['send', 'send-batch'])('잠금 후 코치가 아니면 %s 거부·Solapi 호출 없음', async path => {
    const source = readFileSync(new URL('./sms.js', import.meta.url), 'utf8')
        .replace('const REQUIRE_COACH_FOR_FREE_TEXT = false;', 'const REQUIRE_COACH_FOR_FREE_TEXT = true;');
    const { handler, fetch } = load({ requireCoach: vi.fn(async () => 401), source });
    const result = await call(handler, path, { to: '01000000000', text: 'x', messages: [{ to: '01000000000', text: 'x' }] });
    expect(result.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
});

it('보강 자리 안내는 로그인 없으면 거부', async () => {
    const { handler, fetch } = load({ checkSignedIn: vi.fn(async () => 'missing') });
    expect((await call(handler, 'makeup-seat', { waitlistId: 'abcdefghij1234567890' })).statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
});
