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

export const getCoachStudentListStatus = (student, referenceDate = new Date()) => {
  if (!shouldShowInCoachStudentList(student)) return 'ended';

  const endDate = parseSheetDate(getStudentValue(student, '종료날짜'));
  if (endDate && endDate < atStartOfDay(referenceDate)) return 'expired';

  return 'active';
};
