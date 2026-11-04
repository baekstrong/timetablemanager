/* global exports */
// 수강생 증표로 오는 시트 쓰기는 본인 행만 허용한다(2026-11-04).
// 수강생 화면이 쓰는 경로: 홀딩 신청·취소(M/N/O/H, 다음 등록 G/H), 보강 종료일 조정(H, 다음 등록 G/H),
// 시간표 변경 수락(D/G/H), 재등록 계약 동의(빈 행에 본인 이름으로 A:R 한 줄). 그 외(남의 행·이름/결제/연락처 열·
// 여러 행 범위·행 추가)는 코치만.

const OWN_ROW_COLUMNS = new Set(['C', 'D', 'E', 'G', 'H', 'M', 'N', 'O']);
const LAST_COLUMN = 'R';
const colIndex = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colLetter = i => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const normName = v => String(v ?? '').normalize('NFC').trim();

/** 'Sheet!A5', "'Sheet'!A5:R5", (시트 없이) 'H12' → { sheet, row, c1, c2 } — 한 행 범위만, 아니면 null */
function parseRowRange(range, defaultSheet) {
  const m = String(range).match(/^(?:(?:'((?:[^']|'')+)'|([^!']+))!)?([A-Z]{1,2})(\d+)(?::([A-Z]{1,2})(\d+))?$/);
  if (!m) return null;
  const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] ?? defaultSheet);
  const row = Number(m[4]);
  if (!sheet || row < 3 || (m[6] && Number(m[6]) !== row)) return null; // 1·2행은 헤더
  const c1 = colIndex(m[3]); const c2 = m[5] ? colIndex(m[5]) : c1;
  if (c2 < c1 || c2 > colIndex(LAST_COLUMN)) return null;
  return { sheet, row, c1, c2 };
}

const quote = sheet => `'${sheet.replace(/'/g, "''")}'`;

/**
 * 수강생의 쓰기 요청을 검사한다. 통과면 null, 아니면 거부 사유 문자열.
 * @param {{kind:'values'|'format', items:Array<{range:string, values?:any[][]}>, sheetName?:string}} req
 * @param {string} name 증표의 이름
 * @param {(ranges:string[]) => Promise<string[]>} readNames 각 'Sheet'!B{row}의 값(빈칸은 '')
 */
exports.checkStudentWrite = async (req, name, readNames) => {
  const me = normName(name);
  if (!me || !Array.isArray(req.items) || req.items.length === 0 || req.items.length > 40) return '잘못된 요청';
  const parsed = req.items.map(item => ({ ...item, at: parseRowRange(item.range, req.sheetName) }));
  if (parsed.some(p => !p.at)) return '한 행 범위만 쓸 수 있습니다';
  const keys = [...new Set(parsed.map(p => `${quote(p.at.sheet)}!B${p.at.row}`))];
  const names = await readNames(keys);
  const owners = new Map(keys.map((k, i) => [k, normName(names[i])]));
  for (const p of parsed) {
    const owner = owners.get(`${quote(p.at.sheet)}!B${p.at.row}`);
    if (owner === me) {
      if (req.kind === 'format') continue;
      for (let c = p.at.c1; c <= p.at.c2; c++) {
        if (!OWN_ROW_COLUMNS.has(colLetter(c))) return `본인 행의 ${colLetter(c)}열은 코치만 바꿀 수 있습니다`;
      }
      continue;
    }
    // 빈 행: 재등록 계약 동의가 본인 이름으로 A:R 한 줄을 쓰는 경우만
    if (owner === '' && req.kind === 'values' && p.at.c1 === 0 && p.at.c2 === colIndex(LAST_COLUMN)
      && Array.isArray(p.values) && p.values.length === 1 && normName(p.values[0]?.[1]) === me) continue;
    return '다른 사람의 행은 코치만 바꿀 수 있습니다';
  }
  return null;
};

exports.parseRowRange = parseRowRange;
