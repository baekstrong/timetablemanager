/* global exports */
// 수강생 증표로 오는 시트 쓰기는 본인 행만 허용한다(2026-11-04).
// 수강생 화면이 쓰는 경로: 홀딩 신청·취소(M/N/O/H, 다음 등록 G/H), 보강 종료일 조정(H, 다음 등록 G/H),
// (본인 행 값은 열별 형식 허용 목록으로만 받는다)
// 시간표 변경 수락(D/G/H), 재등록 계약 동의(빈 행에 A:R 한 줄 — 코치가 만든 대기 계약서와 같은 값만).
// 그 외(남의 행·이름/결제/연락처 열·여러 행 범위·행 추가·등록생 목록 밖 탭·수식)는 코치만.

// 본인 행에서 수강생이 쓸 수 있는 열과 값 형식(허용 목록). USER_ENTERED라 형식 밖 값은 수식·서식으로 해석될 수 있어
// '수식처럼 보이는 것 거부' 대신 열마다 앱이 실제로 쓰는 형식만 받는다.
const YYMMDD = /^(\d{6})?$/;
const OWN_ROW_FORMATS = {
  C: /^(\d{1,2})?$/,                 // 주횟수
  D: /^([월화수목금토일]\d)*$/,        // 요일 및 시간 (월1수1)
  E: /^(?![\s]*[=+\-@])[^\n]{0,500}$/, // 특이사항: 수식 시작 문자 금지
  G: YYMMDD, H: YYMMDD, N: YYMMDD, O: YYMMDD,
  M: /^([OX](\(\d+\/\d+\))?)?$/,      // 홀딩 사용여부 (X, O, X(0/2), O(1/3))
};
const LAST_COLUMN = 'R';
const ROSTER_SHEET = /^등록생 목록\(\d{2}년\d{1,2}월\)$/;
const colIndex = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colLetter = i => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const norm = v => String(v ?? '').normalize('NFC').trim();
// 1차 차단(전체 값). 본인 행은 아래 열별 형식 허용 목록으로 다시 거른다.
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
 * @param {(sheet:string, expected:any[]) => Promise<boolean>} contractRowExists 그 탭에 같은 재등록 행(B·F·G)이 이미 있는지
 */
exports.checkStudentWrite = async (req, name, readRows, expectedNewRow = async () => null, contractRowExists = async () => true) => {
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
      const row = Array.isArray(p.values) && p.values.length === 1 && Array.isArray(p.values[0]) ? p.values[0] : null;
      if (!row || row.length > p.at.c2 - p.at.c1 + 1) return '값 형식이 올바르지 않습니다';
      for (let c = p.at.c1; c <= p.at.c2; c++) {
        const format = OWN_ROW_FORMATS[colLetter(c)];
        if (!format) return `본인 행의 ${colLetter(c)}열은 코치만 바꿀 수 있습니다`;
        const value = row[c - p.at.c1];
        if (value !== undefined && (typeof value === 'object' || !format.test(String(value ?? '')))) {
          return `${colLetter(c)}열 값 형식이 올바르지 않습니다`;
        }
      }
      continue;
    }
    // 빈 행: 재등록 계약 동의. 행 전체가 비어 있고, 코치가 만든 대기 계약서와 B~R이 같아야 한다(A는 번호).
    if (current.every(v => norm(v) === '') && req.kind === 'values' && parsed.length === 1 && p.at.c1 === 0 && p.at.c2 === colIndex(LAST_COLUMN)
      && Array.isArray(p.values) && p.values.length === 1 && norm(p.values[0]?.[1]) === me) {
      const expected = await expectedNewRow(p.at.sheet);
      const row = p.values[0];
      if (!expected || !/^\d+$/.test(norm(row[0])) || !expected.every((v, c) => c === 0 || norm(v) === norm(row[c]))) {
        return '재등록 계약서와 다른 내용은 쓸 수 없습니다';
      }
      // 계약서가 대기 중인 동안 같은 행을 여러 번 써서 등록을 늘리지 못하게: 이미 그 탭에 같은 재등록(이름·시작일)이 있으면 거부
      if (await contractRowExists(p.at.sheet, expected)) return '이미 등록된 재등록입니다';
      continue;
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

// ─── 수강생 증표의 읽기: 남의 행 민감 정보 가리기 (2026-11-04) ───
// 수강생 시간표는 여석·출석 계산에 전체 명단(이름·주횟수·시간표·날짜·홀딩)이 필요하지만 남의 결제(I~L)·연락처(P)·
// 직업(R)은 쓰지 않는다. 성별(Q)은 수강생 랭킹의 남녀 구분에 쓰여 남긴다. 특이사항(E)은 계산에 쓰는 기계 태그([계약변경이력:…], [정지:…])와
// 'YY.M.D 결석' 날짜만 남긴다(parseAgreedAbsenceDates·readContractChange·PAUSE_TAG_RE와 같은 형식).
const HIDDEN_FOR_OTHERS = new Set([8, 9, 10, 11, 15, 17]); // I J K L P R
const NOTES_COLUMN = 4; // E
const KEEP_IN_NOTES = /\[계약변경이력:[^\]]+\]|\[정지:[^\]]*\]|(?:\d{2}\.\d{1,2}\.\d{1,2}(?:\s*,\s*)?)+\s*결석/g;
const keepMachineNotes = notes => (String(notes ?? '').match(KEEP_IN_NOTES) || []).join(' ');

/** Sheets 응답 범위 "'탭'!A1:R706" → { sheet, c1, r1 } */
function parseReturnedRange(range) {
  const m = String(range || '').match(/^(?:'((?:[^']|'')+)'|([^!']+))!([A-Z]{1,3})(\d+)?/);
  if (!m) return null;
  return { sheet: m[1] ? m[1].replace(/''/g, "'") : m[2], c1: colIndex(m[3]), r1: m[4] ? Number(m[4]) : 1 };
}

/**
 * 수강생에게 돌려줄 값에서 남의 행 민감 칸을 비운다. 등록생 목록 탭이 아니면 빈 결과.
 * @param {string} range Sheets가 돌려준 실제 범위
 * @param {any[][]} values
 * @param {string} name 증표 이름
 */
exports.redactForStudent = (range, values, name) => {
  const at = parseReturnedRange(range);
  if (!at || !ROSTER_SHEET.test(at.sheet) || !Array.isArray(values)) return [];
  const me = norm(name);
  const nameIdx = 1 - at.c1; // B열 위치(범위에 B가 없으면 음수 → 주인을 모르니 모두 남의 행으로 본다)
  return values.map((row, i) => {
    if (at.r1 + i < 3 || !Array.isArray(row)) return row; // 1·2행은 헤더
    if (nameIdx >= 0 && norm(row[nameIdx]) === me) return row;
    return row.map((value, j) => {
      const col = at.c1 + j;
      if (col === NOTES_COLUMN) return keepMachineNotes(value);
      return HIDDEN_FOR_OTHERS.has(col) || col > colIndex(LAST_COLUMN) ? '' : value;
    });
  });
};
