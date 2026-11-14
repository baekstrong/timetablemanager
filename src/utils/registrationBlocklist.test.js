import { describe, expect, it } from 'vitest';
import { addBlockEntry, blocklistIndex, findBlockMatch, formatBlockPhone, isPermissionDenied, normalizeBlockName, removeBlockEntry } from './registrationBlocklist';

describe('신규 신청 차단 명단', () => {
    it('이름은 공백 제거·소문자, 번호는 숫자만으로 색인한다 (규칙과 같은 정규화)', () => {
        const entries = addBlockEntry([], { name: ' 홍 길동 ', phone: '010-1234-5678' }, 1);
        expect(entries[0]).toMatchObject({ name: '홍 길동', phone: '01012345678' });
        expect(blocklistIndex(entries)).toEqual({ names: ['홍길동'], phones: ['01012345678'] });
        expect(normalizeBlockName('Kim Ann')).toBe('kimann');
    });

    it('이름 또는 번호 하나만 있어도 등록하고, 하나만 같아도 걸린다', () => {
        let entries = addBlockEntry([], { name: '홍길동' }, 1);
        entries = addBlockEntry(entries, { phone: '01099998888' }, 2);
        expect(blocklistIndex(entries)).toEqual({ names: ['홍길동'], phones: ['01099998888'] });
        expect(findBlockMatch(entries, { name: '홍 길동', phone: '01011112222' })?.name).toBe('홍길동');
        expect(findBlockMatch(entries, { name: '다른사람', phone: '010-9999-8888' })?.phone).toBe('01099998888');
        expect(findBlockMatch(entries, { name: '다른사람', phone: '01011112222' })).toBeNull();
    });

    it('빈 입력·잘못된 번호·중복은 거부한다', () => {
        expect(() => addBlockEntry([], { name: ' ', phone: '' })).toThrow();
        expect(() => addBlockEntry([], { phone: '1234' })).toThrow();
        const entries = addBlockEntry([], { name: '홍길동', phone: '01012345678' }, 1);
        expect(() => addBlockEntry(entries, { name: '다른', phone: '010 1234 5678' })).toThrow(/이미/);
    });

    it('해제하면 색인에서도 빠진다', () => {
        const entries = addBlockEntry([], { name: '홍길동', phone: '01012345678' }, 1);
        expect(blocklistIndex(removeBlockEntry(entries, entries[0].id))).toEqual({ names: [], phones: [] });
        expect(formatBlockPhone('01012345678')).toBe('010-1234-5678');
        expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true);
        expect(isPermissionDenied(new Error('offline'))).toBe(false);
    });
});
