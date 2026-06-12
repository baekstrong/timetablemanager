const getStudentValue = (student, fieldName) => {
  if (!student) return '';
  const normalizedField = fieldName.replace(/\s/g, '');
  const exact = student[fieldName];
  if (exact !== undefined && exact !== null) return exact;

  const matchedKey = Object.keys(student).find(key => key.replace(/\s/g, '') === normalizedField);
  return matchedKey ? student[matchedKey] : '';
};

const parseSheetDate = (dateStr) => {
  if (!dateStr) return null;
  const cleaned = String(dateStr).replace(/\D/g, '');

  if (cleaned.length === 6) {
    return new Date(
      parseInt(`20${cleaned.substring(0, 2)}`, 10),
      parseInt(cleaned.substring(2, 4), 10) - 1,
      parseInt(cleaned.substring(4, 6), 10),
    );
  }

  if (cleaned.length === 8) {
    return new Date(
      parseInt(cleaned.substring(0, 4), 10),
      parseInt(cleaned.substring(4, 6), 10) - 1,
      parseInt(cleaned.substring(6, 8), 10),
    );
  }

  return null;
};

const atStartOfDay = (date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

export const shouldShowInCoachStudentList = (student) => {
  const schedule = String(getStudentValue(student, '요일 및 시간') || '').trim();
  return schedule.length > 0;
};

/**
 * 결제유무(K열)가 'X'인 수강생 이름 집합.
 * 같은 이름의 등록 행이 여러 개면(현재 + 미리 등록) 오늘 기준 활성 행을 우선 판정하고,
 * 활성 행이 없으면 시작날짜가 가장 늦은 행을 기준으로 한다.
 */
export const getUnpaidStudentNames = (students, referenceDate = new Date()) => {
  const today = atStartOfDay(referenceDate);
  const rowsByName = new Map();
  (students || []).forEach(s => {
    const name = getStudentValue(s, '이름');
    if (!name || !shouldShowInCoachStudentList(s)) return;
    if (!rowsByName.has(name)) rowsByName.set(name, []);
    rowsByName.get(name).push(s);
  });

  const unpaid = new Set();
  rowsByName.forEach((rows, name) => {
    const active = rows.find(r => {
      const start = parseSheetDate(getStudentValue(r, '시작날짜'));
      const end = parseSheetDate(getStudentValue(r, '종료날짜'));
      return start && end && atStartOfDay(start) <= today && today <= atStartOfDay(end);
    });
    const target = active || rows.reduce((latest, r) => {
      if (!latest) return r;
      const start = parseSheetDate(getStudentValue(r, '시작날짜'));
      const latestStart = parseSheetDate(getStudentValue(latest, '시작날짜'));
      return (start && (!latestStart || start > latestStart)) ? r : latest;
    }, null);
    if (target && String(getStudentValue(target, '결제유무')).trim() === 'X') {
      unpaid.add(name);
    }
  });
  return unpaid;
};

export const getCoachStudentListStatus = (student, referenceDate = new Date()) => {
  if (!shouldShowInCoachStudentList(student)) return 'ended';

  const endDate = parseSheetDate(getStudentValue(student, '종료날짜'));
  if (endDate && endDate < atStartOfDay(referenceDate)) return 'expired';

  return 'active';
};
