import { describe, it, expect } from 'vitest';
import { classStartKST, needsChoicePrompt } from './makeup-wait-choice-push.mjs';

// 이정은: 목1(10/29 10:00) → 금5(10/30) 보강 대기
const entry = (over) => ({ id: 'w', studentName: '이정은', status: 'waiting', date: '2026-10-30', period: 5,
    originalClass: { date: '2026-10-29', period: 1 }, ...over });
const at = (iso) => new Date(iso);

describe('보강 대기 원래 수업 1시간 전 선택 알림 대상', () => {
    it('한국시간 기준 수업 시작 시각', () => {
        expect(classStartKST('2026-10-29', 1).toISOString()).toBe('2026-10-29T01:00:00.000Z');
    });
    it('원래 수업 1시간(여유 10분) 안에만 보낸다', () => {
        expect(needsChoicePrompt(entry(), at('2026-10-29T09:00:00+09:00'))).toBe(true);
        expect(needsChoicePrompt(entry(), at('2026-10-29T08:49:00+09:00'))).toBe(false);
        expect(needsChoicePrompt(entry(), at('2026-10-29T10:00:00+09:00'))).toBe(false);
    });
    it('이미 골랐거나 이미 보냈으면 다시 안 보낸다', () => {
        const now = at('2026-10-29T09:10:00+09:00');
        expect(needsChoicePrompt(entry({ keepAfterOriginal: true }), now)).toBe(false);
        expect(needsChoicePrompt(entry({ choicePromptAt: '2026-10-29T00:05:00Z' }), now)).toBe(false);
        expect(needsChoicePrompt(entry({ status: 'cancelled' }), now)).toBe(false);
    });
    it('보강 수업이 원래 수업보다 먼저면 고를 필요가 없다', () => {
        const earlier = entry({ date: '2026-10-28', period: 5, originalClass: { date: '2026-10-29', period: 1 } });
        expect(needsChoicePrompt(earlier, at('2026-10-29T09:10:00+09:00'))).toBe(false);
    });
});
