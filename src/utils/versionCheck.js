// 배포된 새 빌드를 감지해 사용자에게 새로고침을 안내한다.
//
// 배경: index.html은 GitHub Pages에서 max-age=600으로 캐시되고, 홈 화면 PWA를
// 백그라운드로 계속 띄워두는 사용자는 페이지를 다시 navigate 하지 않으므로
// 새 배포가 있어도 옛 번들을 계속 실행한다. 서비스 워커(sw.js)는 이미지/폰트만
// 캐시하고 JS/HTML은 캐시하지 않으므로, index.html이 참조하는 진입 번들 해시를
// 주기적으로 비교해 새 배포 여부를 판단한다.

const BASE = import.meta.env.BASE_URL || '/';
const BUNDLE_RE = /assets\/index-[^."'\s]+\.js/;

// 현재 실행 중인 앱이 로드한 진입 번들 파일명 (페이지의 module script src)
function getRunningBundle() {
  const scripts = document.querySelectorAll('script[type="module"][src]');
  for (const s of scripts) {
    const m = (s.getAttribute('src') || '').match(BUNDLE_RE);
    if (m) return m[0];
  }
  return null; // dev 모드(번들 해시 없음) 등에서는 null
}

// 서버의 최신 index.html이 참조하는 진입 번들 파일명
async function fetchServerBundle() {
  const res = await fetch(`${BASE}index.html?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(BUNDLE_RE);
  return m ? m[0] : null;
}

/**
 * 새 버전 감지를 시작한다. 새 배포가 확인되면 onUpdateAvailable()을 한 번 호출한다.
 * @param {() => void} onUpdateAvailable
 * @param {{ intervalMs?: number }} [opts]
 * @returns {() => void} 정리(cleanup) 함수
 */
export function startVersionCheck(onUpdateAvailable, { intervalMs = 5 * 60 * 1000 } = {}) {
  const running = getRunningBundle();
  if (!running) return () => {}; // dev 모드에서는 비활성

  let notified = false;

  const check = async () => {
    if (notified || document.hidden) return;
    try {
      const server = await fetchServerBundle();
      if (server && server !== running) {
        notified = true;
        onUpdateAvailable();
      }
    } catch {
      // 네트워크 오류는 무시 (다음 주기에 재시도)
    }
  };

  const onVisible = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', check);
  const id = setInterval(check, intervalMs);
  const initial = setTimeout(check, 3000); // 초기 진입 직후 1회

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', check);
    clearInterval(id);
    clearTimeout(initial);
  };
}
