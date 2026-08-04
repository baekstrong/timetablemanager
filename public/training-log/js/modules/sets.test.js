import { describe, it, expect } from 'vitest';
import { numericOnly, sanitizeSet, swapSets, moveButtons } from './sets.js';

describe('numericOnly', () => {
    it('문자를 제거하고 숫자만 남긴다', () => {
        expect(numericOnly('ㅋㅋㅋ')).toBe('');
        expect(numericOnly('60kg')).toBe('60');
        expect(numericOnly('무겁다 80 개힘듦')).toBe('80');
    });

    it('소수점은 하나만 남긴다', () => {
        expect(numericOnly('62.5')).toBe('62.5');
        expect(numericOnly('1.2.3')).toBe('1.23');
    });

    it('빈 값/undefined 안전', () => {
        expect(numericOnly('')).toBe('');
        expect(numericOnly(undefined)).toBe('');
    });
});

describe('sanitizeSet', () => {
    it('kg 강도의 문자를 제거한다', () => {
        const s = sanitizeSet({ intensity: { value: 'ㅋㅋㅋ', unit: 'kg' }, reps: { value: '10회', unit: '회' } });
        expect(s.intensity.value).toBe('');
        expect(s.reps.value).toBe('10');
    });

    it('자율/높이/맨몸 강도는 그대로 둔다', () => {
        expect(sanitizeSet({ intensity: { value: '가볍게', unit: '자율' }, reps: { value: '10', unit: '회' } }).intensity.value).toBe('가볍게');
        expect(sanitizeSet({ intensity: { value: '3단', unit: '높이' }, reps: { value: '10', unit: '회' } }).intensity.value).toBe('3단');
        expect(sanitizeSet({ intensity: { value: '맨몸', unit: '맨몸' }, reps: { value: '10', unit: '회' } }).intensity.value).toBe('맨몸');
    });

    it('원본 세트를 변형하지 않는다', () => {
        const original = { intensity: { value: '60ㅋ', unit: 'kg' }, reps: { value: '10', unit: '초 x 회', count: '3회' } };
        const s = sanitizeSet(original);
        expect(original.intensity.value).toBe('60ㅋ');
        expect(s.intensity.value).toBe('60');
        expect(s.reps.count).toBe('3');
    });
});

describe('swapSets (세트 순서 이동)', () => {
    const sets = () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it('이웃한 세트를 제자리에서 맞바꾼다', () => {
        const s = sets();
        expect(swapSets(s, 0, 1)).toBe(true);
        expect(s.map(x => x.id)).toEqual(['b', 'a', 'c']);
        expect(swapSets(s, 2, -1)).toBe(true);
        expect(s.map(x => x.id)).toEqual(['b', 'c', 'a']);
    });

    it('맨 위에서 위로 / 맨 아래에서 아래로는 아무것도 안 한다', () => {
        const s = sets();
        expect(swapSets(s, 0, -1)).toBe(false);
        expect(swapSets(s, 2, 1)).toBe(false);
        expect(s.map(x => x.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('moveButtons', () => {
    it('세트가 하나뿐이면 버튼을 안 그린다', () => {
        expect(moveButtons('moveSet', 0, 1)).toBe('');
    });

    it('양 끝에서는 갈 수 있는 방향만 그린다', () => {
        const first = moveButtons('moveSet', 0, 3);
        expect(first).not.toContain('↑');
        expect(first).toContain('moveSet(0, 1)');
        expect(moveButtons('moveSet', 2, 3)).not.toContain('↓');
    });

    it('수정 모달은 자기 핸들러 이름으로 그린다', () => {
        expect(moveButtons('moveEditSet', 1, 3)).toContain('moveEditSet(1, -1)');
    });
});
