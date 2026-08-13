import { describe, it, expect } from 'vitest';
import { nextStage, stageHint } from './quick-nav-stage.js';

describe('nextStage', () => {
    it('다른 이름을 누르면 항상 메모부터', () => {
        expect(nextStage('records', false, true)).toBe('memo');
        expect(nextStage(null, false, false)).toBe('memo');
    });

    it('같은 이름 재클릭: 메모 → 기록', () => {
        expect(nextStage('memo', true, true)).toBe('records');
        expect(nextStage('memo', true, false)).toBe('records');
    });

    it("'마지막' 수강생만 기록 → 재등록", () => {
        expect(nextStage('records', true, true)).toBe('renewal');
    });

    it("'마지막'이 아니면 기록 → 메모로 되돌아간다 (2단 왕복 유지)", () => {
        expect(nextStage('records', true, false)).toBe('memo');
    });

    it('알 수 없는 단계는 메모로', () => {
        expect(nextStage(null, true, true)).toBe('memo');
        expect(nextStage('renewal', true, false)).toBe('memo');
    });
});

describe('stageHint', () => {
    it("기록 단계의 '마지막' 수강생에게만 붙는다", () => {
        expect(stageHint('records', true)).toBe(' · 한 번 더 = 재등록');
        expect(stageHint('records', false)).toBe('');
        expect(stageHint('memo', true)).toBe('');
    });
});
