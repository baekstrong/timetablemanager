// 순수 날짜 계산 모듈 — Sheets/Firebase/env를 import하지 않는다.

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * E열 특이사항에서 YY.M.D 날짜 토큰을 모두 추출해 'YYYY-MM-DD' 배열로 반환.
 * 보수적 용도(확장 제외)이므로 결석 키워드 유무와 무관하게 추출한다.
 * @param {string|null|undefined} notes
 * @returns {string[]}
 */
export function parseAbsenceDatesFromNotes(notes) {
  if (!notes) return [];
  const out = [];
  const re = /(\d{2})\.(\d{1,2})\.(\d{1,2})/g;
  let m;
  while ((m = re.exec(String(notes))) !== null) {
    const yyyy = 2000 + parseInt(m[1], 10);
    out.push(`${yyyy}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`);
  }
  return out;
}
