// 초기 로드가 읽을 월 시트 창(window) 계산.
// 시트는 매달 1개씩 늘어나 "전부 읽기"는 무한 증가 → 앱이 갈수록 느려진다.
// 운영에 실제로 필요한 창(이전 6개월 ~ 이후 2개월)만 남긴다.
// - 현재/다음 등록, 미리 등록(_nextStartDate), 직전 등록(_prevEndDate) 판단에 충분
// - 개별 학생 조회는 findStudentAcrossSheets가 ±2개월 + 전체 시트 폴백으로 커버
// - 과거 월 상세는 changeMonth(단일 시트 읽기)와 매출 통계(getAllRawRows)가 별도 경로로 커버
//
// ⚠️ 행이 있는 시트 = "결제한 달"이지 "수강하는 달"이 아니다. 결제월과 종료일은
// 시작 지연(1) + 등록 개월(3) + 홀딩 3회(~2)로 최대 6개월까지 벌어진다.
// 3개월이었을 때 5월 시트에 있는 6/30~9/22 등록이 9월 1일자로 창 밖으로 밀려
// 수강 중인 사람이 시간표에서 통째로 사라졌다(2026-09-01, 심성희). 줄이지 말 것.
const PAST_MONTHS = 6;
const FUTURE_MONTHS = 2;

export const filterRecentStudentSheets = (sheetNames, today = new Date()) => {
  const base = today.getFullYear() * 12 + today.getMonth();
  const inWindow = (sheetNames || []).filter(name => {
    const m = name.match(/등록생 목록\((\d+)년(\d+)월\)/);
    if (!m) return false;
    const idx = (2000 + parseInt(m[1], 10)) * 12 + (parseInt(m[2], 10) - 1);
    const diff = idx - base;
    return diff >= -PAST_MONTHS && diff <= FUTURE_MONTHS;
  });
  // 안전 폴백: 창 안에 시트가 하나도 없으면(이름 규칙 변경 등) 기존 동작(전체) 유지
  return inWindow.length > 0 ? inWindow : (sheetNames || []);
};
