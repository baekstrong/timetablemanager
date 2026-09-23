import { it, expect, vi } from 'vitest';
import { readSessionIdentity } from './sessionIdentity';

it('다른 계정의 공유 세션을 재사용하지 않는다', async () => {
    const user = { getIdTokenResult: vi.fn(async () => ({ claims: { name: '코치', isCoach: true } })) };
    expect(await readSessionIdentity(user, '수강생')).toBeNull();
});
it('역할은 저장 정보가 아닌 검증된 토큰의 boolean 클레임으로 결정', async () => {
    for (const value of [false, 'true', undefined]) {
        expect(await readSessionIdentity({ getIdTokenResult: async () => ({ claims: { name: '수강생', isCoach: value } }) }, '수강생'))
            .toEqual({ name: '수강생', isCoach: false });
    }
    expect(await readSessionIdentity({ getIdTokenResult: async () => ({ claims: { name: '코치', isCoach: true } }) }, '코치'))
        .toEqual({ name: '코치', isCoach: true });
});
it('세션이 없으면 자동로그인으로 위장하지 않는다', async () => {
    expect(await readSessionIdentity(null, '수강생')).toBeNull();
});
