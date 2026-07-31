import { describe, it, expect } from 'vitest';
import { filterRecentStudentSheets } from './recentSheets';

const TODAY = new Date(2026, 6, 31); // 2026-07-31

describe('filterRecentStudentSheets', () => {
  it('이전 3개월 ~ 이후 2개월 창만 남긴다 (연 경계 포함)', () => {
    const names = [
      '등록생 목록(25년12월)', // -7개월 → 제외
      '등록생 목록(26년3월)',  // -4개월 → 제외
      '등록생 목록(26년4월)',  // -3개월 → 포함
      '등록생 목록(26년7월)',  // 현재 → 포함
      '등록생 목록(26년9월)',  // +2개월 → 포함
      '등록생 목록(26년10월)', // +3개월 → 제외
    ];
    expect(filterRecentStudentSheets(names, TODAY)).toEqual([
      '등록생 목록(26년4월)',
      '등록생 목록(26년7월)',
      '등록생 목록(26년9월)',
    ]);
  });

  it('연말 기준으로 다음 해 시트도 포함한다', () => {
    const dec = new Date(2026, 11, 15); // 2026-12-15
    const names = ['등록생 목록(26년12월)', '등록생 목록(27년1월)', '등록생 목록(27년2월)', '등록생 목록(27년3월)'];
    expect(filterRecentStudentSheets(names, dec)).toEqual([
      '등록생 목록(26년12월)',
      '등록생 목록(27년1월)',
      '등록생 목록(27년2월)',
    ]);
  });

  it('창 안에 시트가 하나도 없으면 전체를 그대로 반환한다 (안전 폴백)', () => {
    const names = ['등록생 목록(24년1월)', '이상한 시트'];
    expect(filterRecentStudentSheets(names, TODAY)).toEqual(names);
  });
});
