import { getStudentField } from './googleSheetsService';

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
