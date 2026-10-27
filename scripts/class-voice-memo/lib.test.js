import { describe, expect, it } from 'vitest';
import { decideGroup, decideNames, groupByClass, nameCall, rebaseNote, tagNameCalls, tagSpeakers, dropRepeats, findNames, matchVoiceprints, parseRecordingStart, parseSrt, periodFor, renderLabeled, updateVoiceprints, voteNames, ymd } from './lib.mjs';

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

    it('전화로 끊긴 같은 교시 녹음은 합쳐서 판단한다', () => {
        const at = (h, m) => new Date(2026, 9, 27, h, m); // 10/27 화
        const groups = groupByClass([
            { f: 'b', start: at(12, 33), period: 2, seconds: 3161 },
            { f: 'a', start: at(12, 0), period: 2, seconds: 1979 },
            { f: 'c', start: at(10, 0), period: 1, seconds: 2344 },
        ]);
        const p2 = groups.find(g => g.period === 2);
        expect(p2.parts).toEqual(['a', 'b']);
        expect(decideGroup(p2, at(12, 40), 3600)).toBe('process');
        const p1 = groups.find(g => g.period === 1);
        expect(decideGroup(p1, at(11, 59), 3600)).toBe('wait');  // 11:30 종료 + 30분 전: 다음 조각 대기
        expect(decideGroup(p1, at(12, 0), 3600)).toBe('skip');
    });

    it('SRT를 읽고 줄마다 화자를 붙인다 (가장 오래 말한 화자 = 코치)', () => {
        const srt = '1\n00:00:00,000 --> 00:00:04,000\n엉덩이 뒤로 빼세요\n\n2\n00:00:04,500 --> 00:00:06,000\n여기가 아파요\n\n3\n00:00:06,000 --> 00:00:12,000\n그럼 박스 스쿼트로\n';
        const lines = parseSrt(srt);
        expect(lines[1]).toEqual({ start: 4.5, end: 6, text: '여기가 아파요' });
        const { coach, lines: tagged } = tagSpeakers(lines, [3, 1, 3]);
        expect(coach).toBe(3);
        expect(renderLabeled(tagged, coach, new Map())).toBe('[코치] 엉덩이 뒤로 빼세요\n[다른 사람1] 여기가 아파요\n[코치] 그럼 박스 스쿼트로');
    });

    it('이름을 찾는다: 정확히, 잘못 들은 한 글자, 이름+호칭 — 호칭 자체는 아님', () => {
        const roster = ['정찬화', '김선희', '김혜숙'];
        expect(findNames('정찬호 선생님 이름 한번 언급해 놓고', roster)).toEqual(['정찬화']);
        expect(findNames('선희 선생님 반복수 몇 개였죠', roster)).toEqual(['김선희']);
        expect(findNames('김혜선이 엉덩이 더', roster)).toEqual(['김혜숙']);
        expect(findNames('김선생님 이거 해보세요', roster)).toEqual([]);
    });

    it('코치가 이름을 부르고 대답한 목소리에 표 → 2표면 확정, 1표면 추정', () => {
        const roster = ['김선희', '정윤희'];
        const L = (start, speaker, text) => ({ start, end: start + 2, speaker, text });
        const lines = [
            L(0, 0, '김선희 선생님 몇 개 했어요?'), L(3, 5, '여덟 개요'),
            L(10, 0, '선희 선생님 손목 보세요'), L(13, 0, '이렇게'), L(15, 5, '네'),
            L(30, 0, '정윤희 선생님 신발 벗고'), L(33, 7, '맨발로요?'),
            L(60, 0, '김선희'), L(90, 7, '늦은 대답'), // 12초 지나면 표 없음
        ];
        const named = decideNames(voteNames(lines, 0, roster));
        expect(named.get(5)).toEqual({ name: '김선희', votes: 2, sure: true });
        expect(named.get(7)).toEqual({ name: '정윤희', votes: 1, sure: false });
        expect(renderLabeled(lines.slice(0, 2), 0, named)).toBe('[코치] 김선희 선생님 몇 개 했어요?\n[김선희] 여덟 개요');
    });

    it('성문: 확정된 목소리만 저장, 다음 수업에서 이름 없는 목소리를 비슷한 성문으로 추정', () => {
        const named = new Map([[5, { name: '김선희', votes: 2, sure: true }], [7, { name: '정윤희', votes: 1, sure: false }]]);
        const vp = updateVoiceprints({}, { 5: [1, 0, 0], 7: [0, 1, 0] }, named, '2026-10-22');
        expect(Object.keys(vp)).toEqual(['김선희']); // 추정(1표)은 저장 안 함
        const next = matchVoiceprints({ 2: [0.95, 0.1, 0], 3: [0, 0, 1] }, vp, new Map(), ['김선희', '정윤희']);
        expect(next.get(2)).toMatchObject({ name: '김선희', byVoice: true });
        expect(next.has(3)).toBe(false); // 비슷한 성문 없음
        expect(renderLabeled([{ speaker: 2, text: '네' }], 0, next)).toBe('[김선희?] 네');
        expect(matchVoiceprints({ 2: [0.95, 0.1, 0] }, vp, new Map(), ['정윤희']).size).toBe(0); // 오늘 명단에 없으면 안 씀
    });

    it('호명 표시: 잘못 들린 이름도 자모가 가까우면 맞추고, 애매하면 고르지 않는다 (10/22 5교시 실제 사례)', () => {
        const R = ['전재현', '정진주', '정성훈', '송제엽', '김기상'];
        expect(nameCall('김기선 선생님이 헤일로', R)).toEqual({ name: '김기상' });
        expect(nameCall('김계성 선생님', R)).toEqual({ name: '김기상' });
        expect(nameCall('윤진진 선생님', R)).toEqual({ name: '정진주' });
        expect(nameCall('재현 씨도 그거 할까요', R)).toEqual({ name: '전재현' });
        expect(nameCall('제연씨 무게 가볍죠', R).ambiguous.sort()).toEqual(['송제엽', '전재현']);
        expect(nameCall('김태성 선생님꺼', R)).toBeNull(); // 너무 다르면 아무도 아님
        expect(nameCall('정선생님 이거', R)).toBeNull(); // 호칭은 이름이 아님
        expect(tagNameCalls('김기성 선생님 어깨 돌리기\n네', R)).toBe('김기성 선생님 어깨 돌리기 ⟪호명: 김기상⟫\n네');
    });

    it('미처리 제안을 최신 메모에 다시 얹는다 (앞 수업 저장분을 지우지 않음)', () => {
        const base = 'A문제 -> 처방1\nB문제 -> 처방';
        const proposed = 'A문제 -> 처방2\nB문제 -> 처방\nC문제 -> 새 처방'; // A 고침 + C 추가
        const current = 'A문제 -> 처방1\nB문제 -> 처방\n앞 수업에서 저장한 줄'; // 그사이 다른 제안이 저장됨
        expect(rebaseNote(base, proposed, current)).toBe('B문제 -> 처방\n앞 수업에서 저장한 줄\nA문제 -> 처방2\nC문제 -> 새 처방');
        expect(rebaseNote(base, proposed, base)).toBe(proposed); // 안 바뀌었으면 그대로
        expect(rebaseNote(undefined, proposed, current)).toBe(proposed); // 예전 제안(base 없음)은 그대로
    });

    it('연속 반복 줄만 지운다', () => {
        expect(dropRepeats('가\n가\n가\n나\n\n가')).toBe('가\n나\n가');
    });
});
