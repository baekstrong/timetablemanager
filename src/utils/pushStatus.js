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
