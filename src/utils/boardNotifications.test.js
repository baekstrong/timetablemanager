import { describe, expect, it } from 'vitest';
import { shouldNotifyBoardAuthor } from './boardNotifications';

describe('게시판 본인 댓글 알림 제외', () => {
    const user = { username: '김수강', role: 'student' };
    it('본인 글·부모 댓글은 이름의 공백·한글 인코딩이 달라도 제외한다', () => {
        for (const author of ['김수강', ' 김수강 ', '김수강'.normalize('NFD')]) {
            expect(shouldNotifyBoardAuthor({ author }, user)).toBe(false);
        }
    });
    it('코치의 예전 표시 이름으로 쓴 댓글도 본인 댓글로 처리한다', () => {
        expect(shouldNotifyBoardAuthor({ author: '예전 코치 이름', isCoach: true }, { username: '백관장', role: 'coach' })).toBe(false);
    });
    it('다른 사람에게 남긴 댓글·답글은 계속 알린다', () => {
        expect(shouldNotifyBoardAuthor({ author: '박수강' }, user)).toBe(true);
        expect(shouldNotifyBoardAuthor({ author: '백관장', isCoach: true }, user)).toBe(true);
        expect(shouldNotifyBoardAuthor({ author: '박수강' }, { username: '백관장', role: 'coach' })).toBe(true);
    });
    it('없는 댓글·삭제한 댓글·작성자가 없는 기록은 알리지 않는다', () => {
        for (const record of [null, {}, { author: '박수강', deleted: true }]) {
            expect(shouldNotifyBoardAuthor(record, user)).toBe(false);
        }
    });
});
