import { describe, expect, it } from 'vitest';
import { formatRefreshAge } from './refreshTime';

describe('갱신 경과 시간', () => {
    it.each([[0, '방금'], [59_999, '방금'], [60_000, '1분 전'], [3_540_000, '59분 전'], [3_600_000, '1시간 전'], [7_380_000, '2시간 3분 전'], [-60_000, '방금']])('%i 밀리초 경과: %s', (elapsed, label) => {
        expect(formatRefreshAge(100_000, 100_000 + elapsed)).toBe(label);
    });
});
