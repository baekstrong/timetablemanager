// 코치 직접 등록 모달의 '대상 시트' 기본값.
// 신규: 시작날짜가 있는 달의 시트 (신규 신청 승인 경로와 같은 기준). 그 달 시트가 아직 없으면 이번 달.
// 재등록: 이번 달 (행은 결제한 달 시트에 둔다).
// 2026-11-24: 신우현님(12월 시작)이 기본값 11월 시트로 들어간 사례.

const sheetNameOf = (date) => `등록생 목록(${String(date.getFullYear()).slice(-2)}년${date.getMonth() + 1}월)`;

export const defaultRegistrationSheet = ({ type, startDate, availableSheets = [], today = new Date() }) => {
    const current = sheetNameOf(today);
    if (type !== 'new' || !startDate) return current;
    const start = new Date(startDate + 'T00:00:00');
    if (Number.isNaN(start.getTime())) return current;
    const byStart = sheetNameOf(start);
    return availableSheets.includes(byStart) ? byStart : current;
};
