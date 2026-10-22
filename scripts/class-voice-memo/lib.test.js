import { describe, expect, it } from 'vitest';
import { dropRepeats, parseRecordingStart, periodFor, ymd } from './lib.mjs';

describe('수업 음성 메모 lib', () => {
    it('음성 메모 파일명에서 시작 시각을 읽는다', () => {
        const d = parseRecordingStart('20261022 120128-3B605E49.m4a');
        expect(ymd(d)).toBe('2026-10-22');
        expect([d.getHours(), d.getMinutes()]).toEqual([12, 1]);
        expect(parseRecordingStart('새 녹음.m4a')).toBeNull();
    });

    it('녹음 시작 시각으로 교시를 정한다 (시작 15분 전~종료)', () => {
        const at = (h, m) => new Date(2026, 9, 22, h, m); // 10/22 목
        expect(periodFor(at(12, 1))).toBe(2);
        expect(periodFor(at(9, 45))).toBe(1);
        expect(periodFor(at(19, 40))).toBe(5); // 4교시 끝(19:30) 뒤, 5교시 15분 전 안
        expect(periodFor(at(9, 30))).toBeNull();
        expect(periodFor(at(14, 0))).toBeNull();
        expect(periodFor(new Date(2026, 9, 24, 12, 0))).toBeNull(); // 토요일
    });

    it('연속 반복 줄만 지운다', () => {
        expect(dropRepeats('가\n가\n가\n나\n\n가')).toBe('가\n나\n가');
    });
});
