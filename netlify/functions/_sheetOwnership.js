/* global exports */
// 수강생 증표로 오는 시트 쓰기는 본인 행만 허용한다(2026-11-04).
// 수강생 화면이 쓰는 경로: 홀딩 신청·취소(M/N/O/H, 다음 등록 G/H), 보강 종료일 조정(H, 다음 등록 G/H),
// 시간표 변경 수락(D/G/H), 재등록 계약 동의(빈 행에 A:R 한 줄 — 코치가 만든 대기 계약서와 같은 값만).
// 그 외(남의 행·이름/결제/연락처 열·여러 행 범위·행 추가·등록생 목록 밖 탭·수식)는 코치만.

const OWN_ROW_COLUMNS = new Set(['C', 'D', 'E', 'G', 'H', 'M', 'N', 'O']);
const LAST_COLUMN = 'R';
const ROSTER_SHEET = /^등록생 목록\(\d{2}년\d{1,2}월\)$/;
const colIndex = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colLetter = i => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const norm = v => String(v ?? '').normalize('NFC').trim();
// USER_ENTERED라 '='로 시작하면 수식으로 실행된다(다른 시트·외부 참조). 날짜·숫자·메모에는 필요 없다.
const looksLikeFormula = v => typeof v === 'string' && /^\s*([=+@]|-\D)/.test(v);

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
 * @param {(ranges:string[]) => Promise<any[][]>} readRows 각 'Sheet'!A{r}:R{r}의 행 값(빈 행은 [])
 * @param {(sheet:string) => Promise<any[]|null>} expectedNewRow 이 탭에 대기 중인 본인 재등록 계약의 A:R 값(없으면 null)
 */
exports.checkStudentWrite = async (req, name, readRows, expectedNewRow = async () => null) => {
  const me = norm(name);
  if (!me || !Array.isArray(req.items) || req.items.length === 0 || req.items.length > 40) return '잘못된 요청';
  const parsed = req.items.map(item => ({ ...item, at: parseRowRange(item.range, req.sheetName) }));
  if (parsed.some(p => !p.at)) return '한 행 범위만 쓸 수 있습니다';
  if (parsed.some(p => !ROSTER_SHEET.test(p.at.sheet))) return '등록생 목록 탭만 쓸 수 있습니다';
  if (parsed.some(p => (p.values || []).flat().some(looksLikeFormula))) return '수식은 쓸 수 없습니다';
  const keys = [...new Set(parsed.map(p => `${quote(p.at.sheet)}!A${p.at.row}:R${p.at.row}`))];
  const rows = await readRows(keys);
  const byKey = new Map(keys.map((k, i) => [k, rows[i] || []]));
  for (const p of parsed) {
    const current = byKey.get(`${quote(p.at.sheet)}!A${p.at.row}:R${p.at.row}`);
    const owner = norm(current[1]);
    if (owner === me) {
      if (req.kind === 'format') continue;
      for (let c = p.at.c1; c <= p.at.c2; c++) {
        if (!OWN_ROW_COLUMNS.has(colLetter(c))) return `본인 행의 ${colLetter(c)}열은 코치만 바꿀 수 있습니다`;
      }
      continue;
    }
    // 빈 행: 재등록 계약 동의. 행 전체가 비어 있고, 코치가 만든 대기 계약서와 B~R이 같아야 한다(A는 번호).
    if (current.every(v => norm(v) === '') && req.kind === 'values' && p.at.c1 === 0 && p.at.c2 === colIndex(LAST_COLUMN)
      && Array.isArray(p.values) && p.values.length === 1 && norm(p.values[0]?.[1]) === me) {
      const expected = await expectedNewRow(p.at.sheet);
      const row = p.values[0];
      if (expected && /^\d+$/.test(norm(row[0])) && expected.every((v, c) => c === 0 || norm(v) === norm(row[c]))) continue;
      return '재등록 계약서와 다른 내용은 쓸 수 없습니다';
    }
    return '다른 사람의 행은 코치만 바꿀 수 있습니다';
  }
  return null;
};

/** 재등록 계약서(registrationData) → 시트 A:R 값. ContractView의 행 구성과 같아야 한다. */
exports.contractRow = data => [
  '', data.이름, data.주횟수, data['요일 및 시간'], data.특이사항, '재등록', data.시작날짜, data.종료날짜,
  data.결제금액, data.결제일, data.결제유무, data.결제방식, data['홀딩 사용여부'], '', '', data.핸드폰, data.성별, data.직업,
];

exports.parseRowRange = parseRowRange;
