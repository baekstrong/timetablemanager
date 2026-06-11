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
