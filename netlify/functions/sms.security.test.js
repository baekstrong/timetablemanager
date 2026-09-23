import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
const realRequire = createRequire(import.meta.url);
it.each([401, 403])('예약문자 취소 권한 거부(%s) 시 Solapi 호출 없음', async denied => {
    const fetch = vi.fn();
    const requireCoach = vi.fn(async () => denied);
    const context = vm.createContext({ exports: {},
        require: id => id === './_requireCoach' ? { requireCoach } : realRequire(id),
        process: { env: {} }, fetch, console: { log() {}, error() {}, warn() {} },
    });
    vm.runInContext(readFileSync(new URL('./sms.js', import.meta.url), 'utf8'), context);
    const result = await context.exports.handler({ httpMethod: 'POST', path: '/.netlify/functions/sms/cancel-scheduled', headers: {}, body: JSON.stringify({ groupId: 'synthetic' }) });
    expect(result.statusCode).toBe(denied);
    expect(requireCoach).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
});
