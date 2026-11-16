/**
 * 알림(웹 푸시) 상태 판정 — 화면에 어떤 안내를 보여줄지 정한다.
 *
 * 'on'은 권한이 아니라 **토큰이 실제로 저장됐는지**로 판정한다.
 * 허용해놓고 getToken이 조용히 실패하면 알림은 안 오는데 권한만 granted라,
 * 예전 배너(권한 'default'일 때만 노출)는 그 사람에게 아무것도 보여주지 못했다.
 *
 * @param {{available:boolean, permission:string, token:?string}} _
 * @returns {'unsupported'|'denied'|'off'|'on'}
 */
export const resolvePushState = ({ available, permission, token }) => {
  if (!available) return 'unsupported';
  if (permission === 'denied') return 'denied';
  return token ? 'on' : 'off';
};

/** 알림을 켤 수 없는 상태(차단·미지원)일 때 사용자가 직접 할 일 안내 — PushSettings·보강 대기 안내 공용 */
export const pushBlockedGuide = (state, isIOS) => state === 'denied'
  ? (isIOS ? '아이폰 설정 → 알림 → 근력학교에서 알림을 허용해주세요.' : '주소창 왼쪽 사이트 설정 → 알림 → 허용으로 바꿔주세요.')
  : (isIOS ? '사파리에서 공유 → 홈 화면에 추가한 뒤 앱을 열어 알림을 켜주세요.' : '이 브라우저에서는 알림을 켤 수 없어요. 카톡·인스타 안에서 열었다면 크롬으로 다시 열어주세요.');

/**
 * '알림 켜기'가 중간 단계에서 실패·시간 초과했을 때 안내 (initPushDetailed의 step).
 * 허용 창이 안 뜨는 경우(크롬 조용한 알림 요청)와 허용은 됐는데 등록이 막힌 경우를 구분한다.
 */
export const pushFailureGuide = (step, isIOS) => {
  if (!step) return '';
  if (step === 'permission') {
    return isIOS
      ? '허용 창이 보이지 않았어요. 아이폰 설정 → 알림 → 근력학교에서 알림을 허용한 뒤 다시 눌러주세요.'
      : '허용 창이 보이지 않았어요. 주소창 왼쪽 아이콘(또는 화면 아래 작은 알림 표시) → 알림 → 허용으로 바꾼 뒤 다시 눌러주세요.';
  }
  return isIOS
    ? '알림 등록이 끝나지 않았어요. 와이파이·데이터를 확인하고 앱을 완전히 닫았다 연 뒤 다시 눌러주세요.'
    : '알림 등록이 끝나지 않았어요. 앱을 완전히 닫았다 연 뒤 다시 눌러주세요. 계속 안 되면 크롬 앱을 최신으로 업데이트하고, 삼성 인터넷이라면 크롬으로 열어주세요.';
};
