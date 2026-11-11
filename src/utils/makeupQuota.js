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

/**
 * 이번 주 보강 사용 횟수 = 보강 신청 이력(취소 포함).
 * 대기는 성공(보강 확정)해야 1회로 센다 (2026-11-11 사용자 결정). 예전엔 활성 대기도 미리 1회로 셌다.
 * 대신 남은 횟수가 0이면 대기를 걸 수 없고, 자리 안내 직전에 남은 횟수를 다시 확인해
 * 수락할 수 없는 사람에게 자리가 묶이지 않게 한다(`hasMakeupQuotaLeft`).
 * @param {any[]} weekMakeups - 이번 주 보강 신청 이력(취소 포함, 이미 주 단위로 필터됨)
 */
export function countWeekMakeupUsage(weekMakeups) {
  return (weekMakeups || []).length;
}

/**
 * 자리 안내를 보내도 되는가 — 대기 문서에 신청 때의 주간 한도(weeklyLimit)가 있으면
 * 그 주 보강 이력 수와 비교한다. 한도가 없는 예전 대기는 막지 않는다(종전 동작).
 */
export function hasMakeupQuotaLeft(entry, weekMakeups) {
  const limit = Number(entry?.weeklyLimit);
  if (!Number.isFinite(limit) || limit < 1) return true;
  return countWeekMakeupUsage(weekMakeups) < limit;
}
