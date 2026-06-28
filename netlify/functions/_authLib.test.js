import { describe, it, expect } from 'vitest';
import { deriveUid, hashPassword, verifyPassword } from './_authLib.js';

describe('_authLib', () => {
  it('deriveUid은 이름에 대해 결정적이고 u_ 접두사를 가진다', () => {
    expect(deriveUid('홍길동')).toBe(deriveUid('홍길동'));
    expect(deriveUid('홍길동')).toMatch(/^u_[0-9a-f]{40}$/);
    expect(deriveUid('홍길동')).not.toBe(deriveUid('김길동'));
  });

  it('hash/verify 라운드트립: 맞는 비번은 true, 틀린 비번은 false', async () => {
    const hash = await hashPassword('1234');
    expect(await verifyPassword('1234', hash)).toBe(true);
    expect(await verifyPassword('9999', hash)).toBe(false);
  });
});
