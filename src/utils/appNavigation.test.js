import { describe, expect, it } from 'vitest';
import { getLoginPage } from './appNavigation';

describe('로그인과 훈련일지 복귀 경로', () => {
    it('학생은 내 수업, 코치는 오늘로 시작한다', () => {
        expect(getLoginPage({ role: 'student' })).toBe('schedule');
        expect(getLoginPage({ role: 'coach' })).toBe('today');
    });
    it('게시글 직접 링크와 명시한 복귀 목적지를 보존한다', () => {
        expect(getLoginPage({ role: 'student', hasPost: true })).toBe('dashboard');
        expect(getLoginPage({ role: 'coach', hasPost: true })).toBe('dashboard');
        expect(getLoginPage({ role: 'student', targetPage: 'myinfo' })).toBe('myinfo');
        expect(getLoginPage({ role: 'student', targetPage: 'holding' })).toBe('holding');
    });
    it('예전 학생 홈 링크도 내 수업에 연결한다', () => {
        expect(getLoginPage({ role: 'student', targetPage: 'today' })).toBe('schedule');
        expect(getLoginPage({ role: 'coach', targetPage: 'today' })).toBe('today');
    });
});
