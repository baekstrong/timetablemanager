import { describe, it, expect } from 'vitest';
import { resolvePushState } from './pushStatus';

describe('resolvePushState', () => {
  it('브라우저가 못 하면 권한과 무관하게 unsupported (인앱 브라우저·홈화면 미추가 아이폰)', () => {
    expect(resolvePushState({ available: false, permission: 'granted', token: 'x' })).toBe('unsupported');
  });

  it('차단은 denied — 예전 배너가 이 사람들에게 아무것도 안 보여주던 케이스', () => {
    expect(resolvePushState({ available: true, permission: 'denied', token: null })).toBe('denied');
  });

  it('허용했지만 토큰 저장에 실패했으면 off — 다시 켤 수 있어야 한다', () => {
    expect(resolvePushState({ available: true, permission: 'granted', token: null })).toBe('off');
  });

  it('토큰이 있어야 on', () => {
    expect(resolvePushState({ available: true, permission: 'granted', token: 'tok' })).toBe('on');
  });

  it('아직 안 물어본 상태는 off', () => {
    expect(resolvePushState({ available: true, permission: 'default', token: null })).toBe('off');
  });
});
