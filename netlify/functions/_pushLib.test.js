import { describe, it, expect } from 'vitest';
import { buildMessage } from './_pushLib.js';

const coach = { name: '백관장', isCoach: true };
const student = { name: '김수강', isCoach: false };

describe('buildMessage', () => {
  it('공지는 코치만 — 학생이 부르면 null', () => {
    expect(buildMessage({ type: 'notice', names: ['A'], title: '아무거나' }, student)).toBeNull();
  });

  it('공지는 받은 이름을 그대로 대상으로 쓴다', () => {
    const m = buildMessage({ type: 'notice', names: ['A', 'B'], title: '휴관 안내', content: '내용' }, coach);
    expect(m.names).toEqual(['A', 'B']);
    expect(m.title).toContain('휴관 안내');
    expect(m.body).toBe('내용');
  });

  it('공지 대상이 비면 null (전원 발송 사고 방지)', () => {
    expect(buildMessage({ type: 'notice', names: [], title: 'x' }, coach)).toBeNull();
  });

  it('댓글 문구는 서버가 만들고 대상은 1명', () => {
    const m = buildMessage({ type: 'comment', to: '박학생', preview: '좋아요' }, student);
    expect(m.names).toEqual(['박학생']);
    expect(m.title).toBe('김수강님이 댓글을 남겼습니다');
    expect(m.body).toBe('좋아요');
  });

  it('답글은 답글 문구', () => {
    expect(buildMessage({ type: 'reply', to: '박학생' }, student).title).toContain('답글');
  });

  it('본문 길이는 잘린다', () => {
    const m = buildMessage({ type: 'comment', to: 'A', preview: 'ㄱ'.repeat(200) }, student);
    expect(m.body.length).toBe(80);
  });

  it('대상 없거나 모르는 타입이면 null', () => {
    expect(buildMessage({ type: 'comment' }, student)).toBeNull();
    expect(buildMessage({ type: 'makeupSeat' }, student)).toBeNull();
    expect(buildMessage({ type: '해킹' }, coach)).toBeNull();
  });

  it('보강 자리 안내는 날짜·교시만 받고 문구는 고정', () => {
    const m = buildMessage({ type: 'makeupSeat', to: 'A', dateText: '9/1(월)', periodLabel: '5교시' }, student);
    expect(m.title).toBe('보강 자리가 났습니다 — 9/1(월) 5교시');
    expect(m.body).toContain('보강승인중');
  });
});
