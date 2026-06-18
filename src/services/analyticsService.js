import { getStudentField, getAllStudents, readSheetData, batchReadSheetData, getSheetNameByYearMonth, getAllSheetNames, parseStudentData } from './googleSheetsService';
import { getTerminations } from './firebaseService';

// ─── 직업 키워드 그룹핑 ───
const OCCUPATION_RULES = [
  { category: '회사원', keywords: ['회사', '직장', '사무', '직장인'] },
  { category: '자영업', keywords: ['사업', '자영', '대표', '사장', '장사'] },
  { category: '전문직', keywords: ['의사', '변호사', '약사', '교사', '강사', '디자이너', '개발', '간호'] },
  { category: '학생', keywords: ['학생', '대학', '대학생'] },
  { category: '주부', keywords: ['주부', '가정'] },
];

export function categorizeOccupation(text) {
  const t = (text || '').trim();
  if (!t) return '기타';
  for (const rule of OCCUPATION_RULES) {
    if (rule.keywords.some(k => t.includes(k))) return rule.category;
  }
  return '기타';
}

export function tallyOccupations(students) {
  const result = {};
  for (const s of students || []) {
    const cat = categorizeOccupation(getStudentField(s, '직업'));
    result[cat] = (result[cat] || 0) + 1;
  }
  return result;
}

// ─── 학생 구성 ───
export function normalizeGender(g) {
  const t = (g || '').trim();
  if (t.startsWith('남')) return '남';
  if (t.startsWith('여')) return '여';
  return '';
}

export function tallyGenders(students) {
  const result = {};
  for (const s of students || []) {
    const g = normalizeGender(getStudentField(s, '성별'));
    if (!g) continue;
    result[g] = (result[g] || 0) + 1;
  }
  return result;
}

export function tallyPaymentMethods(students) {
  const result = {};
  for (const s of students || []) {
    const method = (getStudentField(s, '결제방식') || '').trim();
    if (!method) continue;
    const amount = parseInt((getStudentField(s, '결제금액') || '0').replace(/[^0-9]/g, ''), 10) || 0;
    if (!result[method]) result[method] = { count: 0, amount: 0 };
    result[method].count += 1;
    result[method].amount += amount;
  }
  return result;
}

export function countNewVsRenewal(students) {
  const result = { 신규: 0, 재등록: 0 };
  for (const s of students || []) {
    const v = (getStudentField(s, '신규/재등록') || '').trim();
    if (v === '신규') result.신규 += 1;
    else if (v === '재등록') result.재등록 += 1;
  }
  return result;
}

// ─── 이탈 (종료날짜 기준 + Firebase 종료기록) ───
const ymKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// 'YYMMDD' 또는 'YYYYMMDD' → ms(로컬 자정). 형식이 아니면 null.
export function parseYmd(raw) {
  const s = String(raw ?? '').replace(/[^0-9]/g, '');
  let yy, mm, dd;
  if (s.length === 6) { yy = 2000 + Number(s.slice(0, 2)); mm = Number(s.slice(2, 4)); dd = Number(s.slice(4, 6)); }
  else if (s.length === 8) { yy = Number(s.slice(0, 4)); mm = Number(s.slice(4, 6)); dd = Number(s.slice(6, 8)); }
  else return null;
  if (!mm || !dd || mm > 12 || dd > 31) return null;
  return new Date(yy, mm - 1, dd).getTime();
}

const monthKeyFromMs = (ms) => {
  const d = new Date(ms);
  return ymKey(d.getFullYear(), d.getMonth() + 1);
};

// 이탈 = 오늘 이후까지 가는 등록이 없는 수강생. 이탈 월 = 마지막 종료날짜(H)의 월.
// Firebase 종료기록(terminations: [{studentName, ms}])이 있으면 그 날짜를 우선한다(중도 종료 대응).
// windowKeys('YYYY-MM' 목록) 안에 드는 달만 집계해 { 'YYYY-MM': 인원수 }로 반환.
export function computeChurnByMonth(rows, terminations, windowKeys, todayMs) {
  const windowSet = new Set(windowKeys || []);
  const churned = {}; // 이름 → 'YYYY-MM'

  // 1) Firebase 종료기록 우선(권위 있는 날짜)
  for (const t of terminations || []) {
    const name = (t?.studentName || '').trim();
    if (!name) continue;
    const ms = typeof t?.ms === 'number' ? t.ms : null;
    if (ms == null) continue;
    churned[name] = monthKeyFromMs(ms);
  }

  // 2) 종료날짜(H) 기준 — 이름별 종료일 모음
  const endsByName = {};
  for (const r of rows || []) {
    const name = (getStudentField(r, '이름') || '').trim();
    if (!name) continue;
    if (!endsByName[name]) endsByName[name] = [];
    endsByName[name].push(parseYmd(getStudentField(r, '종료날짜')));
  }
  for (const [name, ends] of Object.entries(endsByName)) {
    if (churned[name]) continue;                 // Firebase 우선
    const valid = ends.filter((e) => e != null);
    if (valid.length === 0) continue;            // 종료일 없음 → 판정 불가
    // NOTE: 현재 진행 중인 등록의 종료날짜(H)가 아직 비어 있고(데이터 입력 지연),
    //       과거 종료 행만 남아 있으면 오탐(이탈로 잡힘) 가능. 보통 H는 채워져 있음.
    if (valid.some((e) => e >= todayMs)) continue; // 오늘 이후까지 등록 있음 → 활성
    churned[name] = monthKeyFromMs(Math.max(...valid));
  }

  // 3) 표시 범위 안에서 월별 카운트
  const counts = {};
  for (const key of Object.values(churned)) {
    if (windowSet.has(key)) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ─── 유입경로 ───
export function tallyReferralSources(registrations) {
  const result = {};
  for (const r of registrations || []) {
    const key = (r.referralSource || '').trim() || '미입력';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

// ─── IO 오케스트레이션 ───

// 최근 N개월의 {year, month} 목록 (오래된→최신). baseDate 기본 오늘.
export function recentMonths(n, baseDate = new Date()) {
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    list.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return list;
}

// 시트의 '엑셀 시트 집계' 블록(T~AH)에 사전 계산된 '최종 매출(환불 포함)' 셀(AF3)을 읽는다.
// ⚠️ 시트의 모든 금액은 '만원' 단위(예: 291 = 291만원)이므로 원 단위로 환산(×10000)한다.
// 셀이 비었거나 읽기 실패 시 컬럼 I(결제유무 'O') 합산으로 폴백 — 컬럼 I도 만원 단위.
const REVENUE_CELL = 'AF3';
const MANWON = 10000;

// ─── 집계 블록 파서 (행2=라벨, 행3=값, 만원 단위) ───
const PAYMENT_LABELS = ['계좌', '카드', '네이버', '탈잉', '제로페이', '어플'];
const toWon = (raw) => {
  const n = parseFloat(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * MANWON) : 0;
};

export function parseAggregateBlock(labelRow, valueRow) {
  const labels = labelRow || [];
  const values = valueRow || [];
  const payments = {};
  let refund = 0;
  let finalRevenue = 0;
  labels.forEach((rawLabel, i) => {
    const label = String(rawLabel ?? '').trim();
    const won = toWon(values[i]);
    if (PAYMENT_LABELS.includes(label)) {
      if (won > 0) payments[label] = won;
    } else if (label === '환불') {
      refund = Math.abs(won);
    } else if (label.includes('최종 매출')) {
      finalRevenue = won;
    }
  });
  return { payments, refund, finalRevenue };
}

export async function getMonthlyRevenue(year, month) {
  const sheet = getSheetNameByYearMonth(year, month);
  // 집계 값은 소수·음수(환불) 가능 → parseFloat, 부호·소수점 보존
  try {
    const rows = await readSheetData(`${sheet}!${REVENUE_CELL}`);
    const raw = rows?.[0]?.[0];
    const num = parseFloat(String(raw ?? '').replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(num) && num > 0) return Math.round(num * MANWON);
  } catch {
    // 셀 읽기 실패 시 폴백
  }
  // 폴백: 결제유무 'O'인 행의 결제금액(만원, 환불은 음수) 합산 → 원 환산
  try {
    const students = await getAllStudents(year, month);
    const manwon = (students || []).reduce((sum, s) => {
      const paid = (getStudentField(s, '결제유무') || '').trim().toUpperCase() === 'O';
      if (!paid) return sum;
      const amt = parseFloat((getStudentField(s, '결제금액') || '0').replace(/[^0-9.-]/g, '')) || 0;
      return sum + amt;
    }, 0);
    return Math.round(manwon * MANWON);
  } catch {
    return 0;
  }
}

// 집계 블록(T2:AF3) 1회 읽기 → { payments(원), refund(원,양수), finalRevenue(원) }
export async function getAggregate(year, month) {
  const sheet = getSheetNameByYearMonth(year, month);
  try {
    const rows = await readSheetData(`${sheet}!T2:AF3`);
    return parseAggregateBlock(rows?.[0], rows?.[1]);
  } catch {
    return { payments: {}, refund: 0, finalRevenue: 0 };
  }
}

// 매출: 집계 최종매출 우선, 0/실패면 getMonthlyRevenue 폴백(컬럼 I 합산)
async function resolveRevenue(year, month, agg) {
  if (agg && agg.finalRevenue > 0) return agg.finalRevenue;
  return getMonthlyRevenue(year, month);
}

// 모든 '등록생 목록(...)' 시트의 원본 행(중복 제거 없이) 읽기 — 이탈 판정용
// 모든 시트를 한 번의 batchGet 요청으로 읽어 할당량 절약(N개 요청 → 1개).
export async function getAllRawRows() {
  const names = await getAllSheetNames();
  const studentSheets = (names || []).filter((n) => n.startsWith('등록생 목록('));
  if (studentSheets.length === 0) return [];
  let valueRanges = [];
  try {
    valueRanges = await batchReadSheetData(studentSheets.map((n) => `${n}!A:R`));
  } catch { valueRanges = []; }
  const arrays = await Promise.all(studentSheets.map(async (name, i) => {
    const m = name.match(/등록생 목록\((\d+)년(\d+)월\)/);
    const ym = m ? `${2000 + parseInt(m[1])}-${String(parseInt(m[2])).padStart(2, '0')}` : null;
    try {
      const parsed = parseStudentData(valueRanges[i]?.values ?? await readSheetData(`${name}!A:R`));
      parsed.forEach((s) => { s._ym = ym; });
      return parsed;
    } catch { return []; }
  }));
  return arrays.flat();
}

// 최근 N개월(고정) 추세: 매출·환불·이탈
export async function getTrends(monthsCount = 6, baseDate = new Date()) {
  const months = recentMonths(monthsCount, baseDate);
  // 월별 집계 블록(T2:AF3)을 한 번의 batchGet으로 읽음 (6개 요청 → 1개)
  const aggRanges = months.map(({ year, month }) => `${getSheetNameByYearMonth(year, month)}!T2:AF3`);
  const aggVrs = await batchReadSheetData(aggRanges).catch(() => []);
  const perMonth = await Promise.all(months.map(async ({ year, month }, i) => {
    const rows = aggVrs[i]?.values;
    const agg = rows ? parseAggregateBlock(rows[0], rows[1]) : await getAggregate(year, month);
    return { year, month, revenue: await resolveRevenue(year, month, agg), refund: agg.refund };
  }));
  const [rawRows, terminations] = await Promise.all([
    getAllRawRows().catch(() => []),
    getTerminations().catch(() => []),
  ]);

  const revenueTrend = computeRevenueTrend(
    perMonth.map(m => ({ year: m.year, month: m.month, revenue: m.revenue }))
  );
  const refundTrend = perMonth.map(m => ({ year: m.year, month: m.month, refund: m.refund }));

  const windowKeys = months.map(m => ymKey(m.year, m.month));
  const terms = (terminations || []).map(t => ({
    studentName: t.studentName,
    ms: t.terminatedAt?.toMillis?.() ?? null,
  }));
  const todayMidnight = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
  const churnByMonth = computeChurnByMonth(rawRows, terms, windowKeys, todayMidnight);

  // 월별 신규 유입수(F열='신규') / 총 수강생수(이름 있는 행) — getAllRawRows의 batchGet 결과 재사용(추가 읽기 없음)
  const newByMonth = {};
  const totalByMonth = {};
  windowKeys.forEach((k) => { newByMonth[k] = 0; totalByMonth[k] = 0; });
  (rawRows || []).forEach((s) => {
    if (!s._ym || newByMonth[s._ym] === undefined) return;
    if (!(s['이름'] || getStudentField(s, '이름') || '').trim()) return;
    totalByMonth[s._ym] += 1;
    if ((getStudentField(s, '신규/재등록') || '').trim() === '신규') newByMonth[s._ym] += 1;
  });

  return { months, revenueTrend, refundTrend, churnByMonth, newByMonth, totalByMonth };
}

// 선택한 달 현황. registrations는 호출측에서 1회 로드해 전달.
export async function getMonthSnapshot(year, month, registrations = []) {
  const agg = await getAggregate(year, month);
  const revenue = await resolveRevenue(year, month, agg);

  // 전월 대비
  const prevDate = new Date(year, month - 2, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth() + 1;
  const prevAgg = await getAggregate(py, pm);
  const prevRevenue = await resolveRevenue(py, pm, prevAgg);
  const trend = computeRevenueTrend([{ revenue: prevRevenue }, { revenue }]);
  const prevDelta = { delta: trend[1].delta, deltaPct: trend[1].deltaPct };

  const students = await getAllStudents(year, month).catch(() => []);
  const inMonth = (registrations || []).filter(r => {
    const ms = r.createdAt?.toMillis?.();
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  return {
    year, month,
    revenue,
    refund: agg.refund,
    prevDelta,
    payments: agg.payments,
    totalStudents: students.filter(s => (s['이름'] || '').trim()).length,
    newVsRenewal: countNewVsRenewal(students),
    genders: tallyGenders(students),
    occupations: tallyOccupations(students),
    referrals: tallyReferralSources(inMonth),
  };
}


// ─── 매출 증감 ───
export function computeRevenueTrend(monthlyRevenues) {
  return (monthlyRevenues || []).map((cur, i) => {
    if (i === 0) return { ...cur, delta: null, deltaPct: null };
    const prev = monthlyRevenues[i - 1].revenue;
    const delta = cur.revenue - prev;
    const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : null;
    return { ...cur, delta, deltaPct };
  });
}
