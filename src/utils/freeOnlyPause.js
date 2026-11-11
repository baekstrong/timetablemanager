// 자율 전용 정지 (2026-11-11 사용자 결정, 원유경님 사례)
//
// 정규 수업에 못 나오고 자율운동만 혼자 하는 수강생은 '정지' 상태로 두되, 출석을 세지 않고
// 기준일(월요일)부터 1주가 지날 때마다 1회씩 남은 횟수를 줄인다.
// 시트 특이사항(E)에 `[자율전용:YYMMDD]`(기준일)만 적어 두고, 남은 횟수는 화면이 계산한다
// — 매주 시트를 고쳐 쓰는 예약 작업이 필요 없다. 시트 H열(N회)은 기준일 시점의 값이며,
// 코치가 잔여 조정·재개·해제를 할 때만 그때까지의 차감분을 시트에 실제로 기록(정산)한다.
//
// 여러 등록(결제 행)이 정지돼 있으면 원래 시작일 순으로(오래된 것부터) 차감한다.
// 같은 사람의 모든 정지 행에 같은 기준일 태그를 붙인다(어느 행을 읽어도 같은 결과).

export const FREE_ONLY_TAG_RE = /\s*\[자율전용:(\d{6})\]/;

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

/** `[자율전용:YYMMDD]`의 기준일. 없거나 잘못된 날짜면 null. */
export const parseFreeOnlyAnchor = (notes) => {
  const match = String(notes || '').match(FREE_ONLY_TAG_RE);
  if (!match) return null;
  const digits = match[1];
  const year = 2000 + Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

export const formatFreeOnlyAnchor = (date) => {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

export const freeOnlyTag = (date) => `[자율전용:${formatFreeOnlyAnchor(date)}]`;

/** 특이사항의 자율전용 태그를 새 기준일로 바꾸거나(date) 지운다(null). */
export const replaceFreeOnlyTag = (notes, date) => {
  const base = String(notes || '').replace(FREE_ONLY_TAG_RE, '').trim();
  if (!date) return base;
  return `${base}${base ? ' ' : ''}${freeOnlyTag(date)}`;
};

/** 기준일부터 오늘까지 꽉 찬 주 수 (기준일 당일·미래는 0). */
export const freeOnlyWeeksElapsed = (anchor, today = new Date()) => {
  if (!anchor) return 0;
  const days = Math.floor((utcDay(today) - utcDay(anchor)) / DAY_MS);
  return days > 0 ? Math.floor(days / 7) : 0;
};

export const addWeeks = (date, weeks) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + weeks * 7);
  return result;
};

/** 기준일 이후 오늘·미래 중 가장 가까운 월요일. 오늘이 월요일이면 오늘. */
export const nextMondayOnOrAfter = (date = new Date()) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (8 - result.getDay()) % 7;
  result.setDate(result.getDate() + offset);
  return result;
};

/**
 * 정지 행들(오래된 순)에 주간 차감을 적용한다.
 * @param {Array<{n:number, notes:string}>} rows - n = 시트 H열의 N회(기준일 시점)
 * @returns {{ rows: Array<{n:number, rawN:number, consumed:number}>, anchor: Date|null,
 *   weeks: number, total: number, rawTotal: number, nextDeduction: Date|null }}
 */
export const applyFreeOnlyDecay = (rows, today = new Date()) => {
  const anchor = rows.map(row => parseFreeOnlyAnchor(row.notes)).find(Boolean) || null;
  const weeks = freeOnlyWeeksElapsed(anchor, today);
  let remaining = weeks;
  const decayed = rows.map(row => {
    const rawN = row.n;
    const consumed = anchor ? Math.min(rawN, remaining) : 0;
    remaining -= consumed;
    return { ...row, rawN, n: rawN - consumed, consumed };
  });
  const total = decayed.reduce((sum, row) => sum + row.n, 0);
  const rawTotal = rows.reduce((sum, row) => sum + row.n, 0);
  return {
    rows: decayed,
    anchor,
    weeks,
    total,
    rawTotal,
    nextDeduction: anchor && total > 0 ? addWeeks(anchor, weeks + 1) : null,
  };
};
