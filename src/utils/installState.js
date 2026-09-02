/**
 * 홈 화면 추가 안내를 어떤 형태로 보여줄지 판정.
 *
 * 'installed'는 이미 홈 화면에서 실행 중이라 안내가 필요 없는 상태.
 * 안드로이드/크롬은 beforeinstallprompt를 받아두면 버튼 한 번으로 설치되지만,
 * 아이폰은 그런 API가 없어 공유 시트를 손으로 안내하는 수밖에 없다.
 * 아이폰의 인앱 브라우저·크롬은 '홈 화면에 추가'가 없거나 PWA로 안 붙으므로 사파리로 보낸다.
 *
 * @param {{standalone:boolean, ua:string, canPrompt:boolean}} _
 * @returns {'installed'|'android'|'ios-safari'|'ios-other'|null} null = 안내할 방법이 없음
 */
export const resolveInstallState = ({ standalone, ua, canPrompt }) => {
  if (standalone) return 'installed';
  // ponytail: iPadOS 13+는 UA가 Macintosh라 여기서 안 걸린다. 그때는 canPrompt가 false라
  // 아무것도 안 뜰 뿐이라 오안내는 없다. 아이패드 문의가 생기면 maxTouchPoints로 보강.
  if (/iPad|iPhone|iPod/.test(ua)) {
    return /CriOS|FxiOS|EdgiOS|KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua)
      ? 'ios-other'
      : 'ios-safari';
  }
  return canPrompt ? 'android' : null;
};
