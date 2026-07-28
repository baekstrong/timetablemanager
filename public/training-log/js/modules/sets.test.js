import { describe, it, expect } from 'vitest';
import { numericOnly, sanitizeSet } from './sets.js';

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
