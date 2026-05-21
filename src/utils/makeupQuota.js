function readField(record, fieldName) {
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, fieldName)) return record[fieldName];

  const normalizedTarget = fieldName.replace(/\s+/g, '').toLowerCase();
  const matchedKey = Object.keys(record).find(key =>
    key.replace(/\s+/g, '').toLowerCase() === normalizedTarget
  );
  return matchedKey ? record[matchedKey] : undefined;
}

export function getMakeupWeeklyLimit(studentData, studentSchedule = []) {
  const rawFrequency = readField(studentData, '주횟수');
  const parsedFrequency = Number(String(rawFrequency ?? '').match(/\d+/)?.[0]);

  if (Number.isFinite(parsedFrequency) && parsedFrequency >= 1) {
    return parsedFrequency;
  }

  if (Array.isArray(studentSchedule) && studentSchedule.length >= 1) {
    return studentSchedule.length;
  }

  return 1;
}
