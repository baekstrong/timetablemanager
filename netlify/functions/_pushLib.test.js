import { describe, it, expect } from 'vitest';
import { buildMessage, verifyPathFor } from './_pushLib.js';

const coach = { name: '백관장', isCoach: true };
const student = { name: '김수강', isCoach: false };

describe('verifyPathFor — 무엇을 대조할지', () => {
  it('공지는 대조할 문서가 없다', () => {
    expect(verifyPathFor({ type: 'notice' })).toBeNull();
  });
  it('댓글·답글·보강자리는 각자의 문서를 가리킨다', () => {
    expect(verifyPathFor({ type: 'comment', postId: 'p1' })).toEqual(['posts', 'p1']);
    expect(verifyPathFor({ type: 'reply', postId: 'p1', parentId: 'c1' }))
      .toEqual(['posts', 'p1', 'comments', 'c1']);
    expect(verifyPathFor({ type: 'makeupSeat', waitlistId: 'w1' })).toEqual(['makeupWaitlists', 'w1']);
  });
  it('식별자가 없으면 undefined — 핸들러가 400으로 끊는다', () => {
    expect(verifyPathFor({ type: 'comment' })).toBeUndefined();
    expect(verifyPathFor({ type: 'reply', postId: 'p1' })).toBeUndefined();
    expect(verifyPathFor({ type: 'makeupSeat' })).toBeUndefined();
  });
});

describe('buildMessage — 공지', () => {
  it('학생이 부르면 null (자유 텍스트는 코치만)', () => {
    expect(buildMessage({ type: 'notice', names: ['A'], title: 'x' }, student, null)).toBeNull();
  });
  it('코치는 받은 이름 그대로 대상', () => {
    const m = buildMessage({ type: 'notice', names: ['A', 'B'], title: '휴관 안내', content: '내용' }, coach, null);
    expect(m.names).toEqual(['A', 'B']);
    expect(m.title).toContain('휴관 안내');
    expect(m.body).toBe('내용');
  });
  it('대상이 비면 null (전원 발송 사고 방지)', () => {
    expect(buildMessage({ type: 'notice', names: [], title: 'x' }, coach, null)).toBeNull();
  });
  it('길이는 잘린다', () => {
    const m = buildMessage({ type: 'notice', names: ['A'], title: 'ㄱ'.repeat(99), content: 'ㄴ'.repeat(999) }, coach, null);
    expect(m.body.length).toBe(120);
  });
});

describe('buildMessage — 댓글/답글', () => {
  it('대상은 클라이언트가 아니라 조회한 글의 작성자', () => {
    const m = buildMessage({ type: 'comment', postId: 'p1', to: '엉뚱한사람' }, student, { author: '박학생' });
    expect(m.names).toEqual(['박학생']);
    expect(m.title).toBe('김수강님이 댓글을 남겼습니다');
  });

  it('본문에 클라이언트 텍스트가 섞이지 않는다', () => {
    const m = buildMessage({ type: 'comment', postId: 'p1', preview: '악성문구' }, student, { author: '박학생' });
    expect(JSON.stringify(m)).not.toContain('악성문구');
  });

  it('답글은 부모 댓글 작성자에게, 답글 문구로', () => {
    const m = buildMessage({ type: 'reply', postId: 'p1', parentId: 'c1' }, student, { author: '박학생' });
    expect(m.names).toEqual(['박학생']);
    expect(m.title).toContain('답글');
  });

  it('글이 없거나 삭제됐거나 본인 글이면 null', () => {
    expect(buildMessage({ type: 'comment', postId: 'p1' }, student, null)).toBeNull();
    expect(buildMessage({ type: 'comment', postId: 'p1' }, student, { author: '박학생', deleted: true })).toBeNull();
    expect(buildMessage({ type: 'comment', postId: 'p1' }, student, { author: '김수강' })).toBeNull();
  });
});

describe('buildMessage — 보강 자리', () => {
  const entry = { status: 'notified', studentName: '박학생', date: '2026-09-01', period: 5 };

  it('notified 대기 항목의 날짜·교시로 문구를 만든다', () => {
    const m = buildMessage({ type: 'makeupSeat', waitlistId: 'w1' }, student, entry);
    expect(m.names).toEqual(['박학생']);
    expect(m.title).toBe('보강 자리가 났습니다 — 9/1(화) 5교시');
    expect(m.body).toContain('보강승인중');
  });

  it('3교시는 자율 표기', () => {
    const m = buildMessage({ type: 'makeupSeat', waitlistId: 'w1' }, student, { ...entry, period: 3 });
    expect(m.title).toContain('3교시(자율)');
  });

  it('아직 안내되지 않았거나 없는 항목이면 null (가짜 자리 알림 차단)', () => {
    expect(buildMessage({ type: 'makeupSeat', waitlistId: 'w1' }, student, { ...entry, status: 'waiting' })).toBeNull();
    expect(buildMessage({ type: 'makeupSeat', waitlistId: 'w1' }, student, null)).toBeNull();
  });
});

it('모르는 타입은 null', () => {
  expect(buildMessage({ type: '해킹' }, coach, null)).toBeNull();
});

describe('TTL — 오프라인이었던 사람에게 언제까지 유효한가', () => {
  it('공지는 1주, 댓글은 하루, 보강 자리는 수락 데드라인과 같은 1시간', () => {
    expect(buildMessage({ type: 'notice', names: ['A'], title: 'x' }, coach, null).ttl).toBe(604800);
    expect(buildMessage({ type: 'comment', postId: 'p1' }, student, { author: '박학생' }).ttl).toBe(86400);
    expect(buildMessage({ type: 'makeupSeat', waitlistId: 'w1' }, student,
      { status: 'notified', studentName: '박학생', date: '2026-09-01', period: 5 }).ttl).toBe(3600);
  });
});
