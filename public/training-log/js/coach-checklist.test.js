import { describe, expect, it } from 'vitest';
import { generatePinnedMemosHTML, memoItems, memoText } from './ui.js';

describe('코치 체크리스트 (운동 선택 시 카드)', () => {
    const coach = [
        { id: 'a', exercise: '벤치프레스', memo: '마지막 구간 천천히', createdAt: '2026-10-22T10:00:00Z' },
        { id: 'b', exercise: '벤치프레스', memo: '그립 넓게', done: true, doneAt: '2026-10-23T10:00:00Z' },
        { id: 'c', exercise: '백 스쿼트', memo: '박스 스쿼트로', createdAt: '2026-10-22T10:00:00Z' },
    ];

    it('남은 항목만 체크박스로 보이고, 완료 항목은 숨긴 개수만 보인다', () => {
        const html = generatePinnedMemosHTML(coach, [], '벤치프레스');
        expect(html).toContain('코치 체크리스트');
        expect(html).toContain('마지막 구간 천천히');
        expect(html).not.toContain('그립 넓게');
        expect(html).toContain('1개 남음');
        expect(html).toContain('완료한 코치 체크리스트 1개');
        expect(html).toContain("f('a', 0)");
        expect(html).toContain('type="checkbox"');
    });

    it('오늘 체크한 항목은 줄 그은 채 남아 다시 누르면 취소된다', () => {
        const html = generatePinnedMemosHTML([{ id: 'd', exercise: '벤치프레스', memo: '오늘 체크', done: true, doneAt: new Date().toISOString() }], [], '벤치프레스');
        expect(html).toContain('오늘 체크');
        expect(html).toContain('line-through');
        expect(html).toContain('다시 누르면 취소');
        expect(html).toContain('checked');
        expect(html).toContain('0개 남음');
        expect(html).not.toContain('숨겼어요');
    });

    it('다른 운동 항목은 섞이지 않고, 수강생 메모와 함께 뜬다', () => {
        const html = generatePinnedMemosHTML(coach, [{ exercise: '백 스쿼트', memo: '5회 4세트' }], '백 스쿼트');
        expect(html).toContain('박스 스쿼트로');
        expect(html).not.toContain('마지막 구간 천천히');
        expect(html).toContain('5회 4세트');
    });

    it('전부 완료하고 수강생 메모도 없으면 숨김 안내만, 아무것도 없으면 빈 문자열', () => {
        expect(generatePinnedMemosHTML([{ ...coach[1] }], [], '벤치프레스')).toContain('1개는 숨겼어요');
        // 메모가 하나도 없는 종목엔 '메모 한 줄 추가' 칸만 (2026-10-23 체크리스트)
        const empty = generatePinnedMemosHTML(coach, [], '데드리프트');
        expect(empty).toContain('메모 한 줄 추가');
        expect(empty).not.toContain('내 운동 메모');
    });

    it('메모 내용은 이스케이프된다', () => {
        const html = generatePinnedMemosHTML([{ id: "x'y", exercise: 'A', memo: '<img src=x onerror=alert(1)>' }], [], 'A');
        expect(html).not.toContain('<img');
        expect(html).toContain("f('x\\'y', 0)");
    });
});

describe('내 운동 메모 체크리스트', () => {
    it('items마다 체크박스와 월/일, 예전 한 덩어리 메모는 한 항목(날짜 없음)', () => {
        const html = generatePinnedMemosHTML([], [{ exercise: '스쿼트', items: [{ text: '무릎 바깥으로', at: '2026-10-21T03:00:00Z' }, { text: '호흡 먼저', at: '2026-10-23T03:00:00Z' }] }], '스쿼트');
        expect(html.match(/<label data-memo-item/g)).toHaveLength(2);
        expect(html).toContain('10/21');
        expect(html).toContain('2개');
        expect(memoItems({ memo: '옛 메모' })).toEqual([{ text: '옛 메모', at: '' }]);
        expect(memoItems({})).toEqual([]);
        expect(memoText([{ text: 'a' }, { text: 'b' }])).toBe('a\nb');
    });
});
