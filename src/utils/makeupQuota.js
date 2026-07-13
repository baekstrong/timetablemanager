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
 * 이번 주 보강 '약속(commitment)' 건수 = 보강 신청 이력(취소 포함) + 활성 대기(waiting/notified).
 * 대기도 자리가 나면 보강이 되므로 미리 횟수로 계산해야, 이미 보강을 쓴 사람이 대기를 걸고
 * 수락 단계에서 실패(데드엔드)하는 상황을 막을 수 있다.
 * @param {any[]} weekMakeups - 이번 주 보강 신청 이력(취소 포함, 이미 주 단위로 필터됨)
 * @param {{status?:string,date?:string}[]} myWaitlists - 내 대기 목록
 * @param {string} weekStart - 이번 주 시작(YYYY-MM-DD)
 * @param {string} weekEnd - 이번 주 끝(YYYY-MM-DD)
 */
export function countWeekMakeupCommitments(weekMakeups, myWaitlists, weekStart, weekEnd) {
  const makeupCount = (weekMakeups || []).length;
  const waitlistCount = (myWaitlists || []).filter(w =>
    (w.status === 'waiting' || w.status === 'notified') &&
    w.date >= weekStart && w.date <= weekEnd
  ).length;
  return makeupCount + waitlistCount;
}
