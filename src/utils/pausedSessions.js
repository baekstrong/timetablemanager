// 등록 순서대로 차감한다. 금액·등록개월·실제 출석 기록은 바꾸지 않는다.
export function planPausedSessionAdjustment(registrations, targetTotal) {
  const total = registrations.reduce((sum, row) => sum + row.n, 0);
  if (!registrations.length || registrations.some(row => !Number.isSafeInteger(row.n) || row.n <= 0)) {
    throw new Error('조정할 일시정지 등록을 확인해주세요.');
  }
  if (targetTotal === '' || !Number.isSafeInteger(Number(targetTotal)) || Number(targetTotal) < 0 || Number(targetTotal) >= total) {
    throw new Error(`최종 잔여 횟수는 0~${total - 1}회 정수로 입력해주세요.`);
  }
  let deduction = total - Number(targetTotal);
  return registrations.map(row => {
    const deducted = Math.min(row.n, deduction);
    deduction -= deducted;
    return { ...row, before: row.n, after: row.n - deducted, deducted };
  });
}

export const pausedRegistrationSnapshot = rows => JSON.stringify(rows.map(
  ({ sheetName, sheetRow, n, origStartDigits, origWeekly, origSchedule, notes }) =>
    [sheetName, sheetRow, n, origStartDigits, origWeekly, origSchedule, notes],
));
