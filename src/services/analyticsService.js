import { getStudentField, getAllStudents, readSheetData, getSheetNameByYearMonth } from './googleSheetsService';
import { getNewStudentRegistrations, getTerminations } from './firebaseService';

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

// ─── 이탈 (시트 기반) ───
const ymKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export function computeSheetChurnByMonth(months) {
  // months: [{ year, month, students }] — 입력 순서 무관, 내부에서 정렬
  const ordered = [...(months || [])].sort((a, b) =>
    (a.year * 100 + a.month) - (b.year * 100 + b.month)
  );
  const hasSchedule = (s) => (getStudentField(s, '요일 및 시간') || '').trim() !== '';

  // 이름이 특정 인덱스 이후(배타적)에 활성 등록을 갖는지
  const activeAfter = (name, idx) => {
    for (let j = idx + 1; j < ordered.length; j++) {
      const found = ordered[j].students.find(s => (s['이름'] || '').trim() === name);
      if (found && hasSchedule(found)) return true;
    }
    return false;
  };

  const churnedNames = new Set();
  const result = {};
  // 가장 최근 달(마지막 인덱스)은 제외 → length - 1 까지만
  for (let i = 0; i < ordered.length - 1; i++) {
    const { year, month, students } = ordered[i];
    for (const s of students) {
      const name = (s['이름'] || '').trim();
      if (!name || churnedNames.has(name)) continue;
      if (hasSchedule(s)) continue;            // D열 채워짐 → 종료 아님
      if (activeAfter(name, i)) continue;      // 이후 활성 → 이탈 아님
      const key = ymKey(year, month);
      if (!result[key]) result[key] = [];
      result[key].push(name);
      churnedNames.add(name);
    }
  }
  return result;
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

// 이탈 합치기: 과거달=시트, 최근달=Firebase 종료기록
function mergeChurn(sheetChurnByMonth, terminations, months) {
  const counts = {};
  for (const { year, month } of months) {
    const key = ymKey(year, month);
    counts[key] = (sheetChurnByMonth[key] || []).length;
  }
  // 가장 최근 달은 Firebase 종료기록으로 대체
  const latest = months[months.length - 1];
  const latestKey = ymKey(latest.year, latest.month);
  const inLatest = (terminations || []).filter(t => {
    const ms = t.terminatedAt?.toMillis?.();
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() === latest.year && (d.getMonth() + 1) === latest.month;
  });
  counts[latestKey] = inLatest.length;
  return counts;
}

export async function buildDashboard(monthsCount = 6, baseDate = new Date()) {
  const months = recentMonths(monthsCount, baseDate);
  const latest = months[months.length - 1];

  // 월별 학생 배열 + 매출 (병렬)
  const perMonth = await Promise.all(months.map(async ({ year, month }) => ({
    year, month,
    students: await getAllStudents(year, month).catch(() => []),
    revenue: await getMonthlyRevenue(year, month),
  })));

  const latestMonthData = perMonth[perMonth.length - 1];
  const [registrations, terminations] = await Promise.all([
    getNewStudentRegistrations().catch(() => []),
    getTerminations().catch(() => []),
  ]);

  const revenueTrend = computeRevenueTrend(
    perMonth.map(m => ({ year: m.year, month: m.month, revenue: m.revenue }))
  );
  const sheetChurn = computeSheetChurnByMonth(
    perMonth.map(m => ({ year: m.year, month: m.month, students: m.students }))
  );
  const churnByMonth = mergeChurn(sheetChurn, terminations, months);

  // 최근 N개월 내 신청만 유입경로 집계
  const cutoff = new Date(months[0].year, months[0].month - 1, 1).getTime();
  const recentRegs = registrations.filter(r => (r.createdAt?.toMillis?.() || 0) >= cutoff);

  return {
    months,
    latest,
    revenueTrend,
    payments: tallyPaymentMethods(latestMonthData.students),
    genders: tallyGenders(latestMonthData.students),
    occupations: tallyOccupations(latestMonthData.students),
    referrals: tallyReferralSources(recentRegs),
    newVsRenewal: countNewVsRenewal(latestMonthData.students),
    totalStudents: latestMonthData.students.filter(s => (s['이름'] || '').trim()).length,
    churnByMonth,
    churnLatest: churnByMonth[ymKey(latest.year, latest.month)] || 0,
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
