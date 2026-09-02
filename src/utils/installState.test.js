import { describe, it, expect } from 'vitest';
import { resolveInstallState } from './installState';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const KAKAO_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const GALAXY = 'Mozilla/5.0 (Linux; Android 14; SM-S926N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('resolveInstallState', () => {
  it('이미 홈 화면에서 실행 중이면 안내하지 않는다', () => {
    expect(resolveInstallState({ standalone: true, ua: SAFARI, canPrompt: false })).toBe('installed');
    expect(resolveInstallState({ standalone: true, ua: GALAXY, canPrompt: true })).toBe('installed');
  });

  it('갤럭시는 설치 프롬프트를 받아둔 뒤에만 버튼을 보여준다', () => {
    expect(resolveInstallState({ standalone: false, ua: GALAXY, canPrompt: true })).toBe('android');
    expect(resolveInstallState({ standalone: false, ua: GALAXY, canPrompt: false })).toBe(null);
  });

  it('아이폰 사파리는 프롬프트가 없어도 공유 시트를 안내한다', () => {
    expect(resolveInstallState({ standalone: false, ua: SAFARI, canPrompt: false })).toBe('ios-safari');
  });

  it('아이폰 카톡/크롬은 사파리로 열라고 안내한다', () => {
    expect(resolveInstallState({ standalone: false, ua: KAKAO_IOS, canPrompt: false })).toBe('ios-other');
    expect(resolveInstallState({ standalone: false, ua: CHROME_IOS, canPrompt: false })).toBe('ios-other');
  });
});
