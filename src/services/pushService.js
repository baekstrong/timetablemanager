import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import app, { auth, db } from '../config/firebase';
import * as Sentry from '@sentry/react';
import { shouldNotifyBoardAuthor } from '../utils/boardNotifications';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// smsService.getSmsUrl과 같은 규칙 (VITE_FUNCTIONS_URL의 /sheets를 떼고 /push를 붙임)
const getPushUrl = () => {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  if (functionsUrl) return `${functionsUrl.replace(/\/sheets\/?$/, '')}/push`;
  return import.meta.env.PROD ? '/.netlify/functions/push' : 'http://localhost:5001/push';
};

/** 브라우저가 웹 푸시를 지원하는가 (아이폰은 홈 화면에 추가한 경우에만 true) */
export const isPushAvailable = async () => {
  try {
    return !!VAPID_KEY && !!app && 'Notification' in window && (await isSupported());
  } catch {
    return false;
  }
};

/** 현재 권한 상태 — 'default' | 'granted' | 'denied' | 'unsupported' */
export const getPushPermission = () =>
  'Notification' in window ? Notification.permission : 'unsupported';

// 단계별 시간 제한 (2026-11-16, 갤럭시 S24에서 허용 후에도 '설정 중…'에 영원히 멈춘 사례).
// 허용 요청·토큰 발급·저장 중 하나가 응답하지 않으면 버튼이 풀리지 않았다.
export const PUSH_STEP_TIMEOUTS = { permission: 30000, serviceWorker: 5000, token: 12000, identity: 10000, save: 10000 };

class PushStepError extends Error {
  constructor(step, reason, cause) {
    super(`${step}: ${reason}${cause?.message ? ` (${cause.message})` : ''}`);
    this.step = step;
    this.reason = reason;
  }
}

const withTimeout = (promise, ms, step) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new PushStepError(step, 'timeout')), ms);
  Promise.resolve(promise).then(
    (value) => { clearTimeout(timer); resolve(value); },
    (err) => { clearTimeout(timer); reject(err instanceof PushStepError ? err : new PushStepError(step, 'error', err)); },
  );
});

const reportPushFailure = (err) => {
  try {
    Sentry.captureMessage(`푸시 켜기 실패: ${err.message}`, {
      level: 'warning',
      tags: { pushStep: err.step || 'unknown', pushReason: err.reason || 'error' },
      extra: { userAgent: navigator.userAgent, standalone: window.matchMedia?.('(display-mode: standalone)')?.matches },
    });
  } catch { /* 보고 실패는 무시 */ }
};

const fetchToken = (registration) => getToken(getMessaging(app), {
  vapidKey: VAPID_KEY,
  serviceWorkerRegistration: registration,
});

/**
 * 권한 확보 후 FCM 토큰을 users/{이름}에 저장하고, 어느 단계에서 멈췄는지 함께 돌려준다.
 * @returns {Promise<{token: ?string, step?: string, reason?: string}>}
 *   step: 'permission'|'serviceWorker'|'token'|'identity'|'save' — 실패한 단계 (성공·권한 없음이면 없음)
 */
export const initPushDetailed = async (userName, ask = false) => {
  try {
    if (!userName || !(await isPushAvailable())) return { token: null };

    let permission = Notification.permission;
    if (permission === 'default' && ask) {
      // 크롬 '조용한 알림 요청'이면 팝업 없이 작은 표시만 뜨고, 그걸 누르기 전까지 끝나지 않는다.
      permission = await withTimeout(Notification.requestPermission(), PUSH_STEP_TIMEOUTS.permission, 'permission');
    }
    if (permission !== 'granted') return { token: null };

    // SW 등록이 실패하면 ready는 reject가 아니라 **영원히 대기**한다 → 버튼이 먹통이 된다.
    const registration = await withTimeout(navigator.serviceWorker.ready, PUSH_STEP_TIMEOUTS.serviceWorker, 'serviceWorker');

    let token;
    try {
      token = await withTimeout(fetchToken(registration), PUSH_STEP_TIMEOUTS.token, 'token');
    } catch (err) {
      // 사용자가 직접 누른 경우에만: 기존 구독이 꼬였을 수 있어 한 번 지우고 다시 받는다.
      if (!ask) throw err;
      try {
        const sub = await withTimeout(registration.pushManager?.getSubscription(), 3000, 'token');
        if (sub) await withTimeout(sub.unsubscribe(), 3000, 'token');
      } catch { /* 지우기 실패해도 재시도는 해본다 */ }
      token = await withTimeout(fetchToken(registration), PUSH_STEP_TIMEOUTS.token, 'token');
    }
    if (!token) return { token: null, step: 'token', reason: 'empty' };

    // 빙의 화면이나 다른 계정의 이름으로 현재 기기 토큰을 등록하지 않는다.
    const identity = await withTimeout(auth?.currentUser?.getIdTokenResult(), PUSH_STEP_TIMEOUTS.identity, 'identity');
    if (identity?.claims?.name !== userName) return { token: null };

    // 접속마다 write 하지 않도록 직전 토큰과 비교 (프로젝트 전반의 "내용 같으면 write 생략" 패턴)
    const cacheKey = `push_token_${userName}`;
    if (localStorage.getItem(cacheKey) === token) return { token };
    await withTimeout(
      setDoc(doc(db, 'users', userName), { fcmToken: token, fcmUpdatedAt: serverTimestamp() }, { merge: true }),
      PUSH_STEP_TIMEOUTS.save, 'save',
    );
    localStorage.setItem(cacheKey, token);
    return { token };
  } catch (err) {
    console.warn('푸시 초기화 실패:', err?.message);
    if (ask) reportPushFailure(err);
    return { token: null, step: err?.step || 'unknown', reason: err?.reason || 'error' };
  }
};

/**
 * 권한 확보 후 FCM 토큰을 users/{이름}에 저장. 토큰 또는 null.
 * @param {string} userName
 * @param {boolean} ask - true면 권한 요청 팝업을 띄운다. 아이폰은 사용자 제스처 안에서만 통하므로
 *                        버튼 클릭 핸들러에서만 true로 부를 것.
 */
export const initPush = async (userName, ask = false) => (await initPushDetailed(userName, ask)).token;

/** 로그아웃/계정 전환 시 토큰 캐시만 비운다 (users 문서의 토큰은 서버가 무효 응답 받을 때 정리) */
export const clearPushTokenCache = (userName) => {
  try { localStorage.removeItem(`push_token_${userName}`); } catch { /* noop */ }
};

const callPush = async (payload, boardAuthor) => {
  try {
    const current = auth?.currentUser;
    if (!current) return false;
    let idToken;
    if (['comment', 'reply'].includes(payload.type)) {
      // 빙의 화면의 표시 계정과 실제 로그인 계정은 다를 수 있다.
      // 발송 직전에는 서버에 전달할 인증 신원으로도 본인 알림을 차단한다.
      const identity = await current.getIdTokenResult();
      if (!shouldNotifyBoardAuthor(boardAuthor, {
        username: identity.claims.name,
        role: identity.claims.isCoach === true ? 'coach' : 'student',
      })) return false;
      idToken = identity.token;
    } else {
      idToken = await current.getIdToken();
    }
    if (current !== auth.currentUser) return false;
    const res = await fetch(getPushUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data.sent > 0;
  } catch (err) {
    console.error('푸시 발송 실패:', payload?.type, '-', err.message);
    return false;
  }
};

/** 공지 — 코치만. names는 수강중 수강생 이름 배열. */
export const pushNotice = (names, title, content, postId) =>
  callPush({ type: 'notice', names, title, content, postId });

// 아래 둘은 대상·문구를 서버가 문서에서 직접 읽어 정한다. 여기선 어느 문서인지만 알려준다.
/** 내 글에 댓글 — 서버가 posts/{postId}의 작성자에게 보낸다 */
export const pushComment = (postId, post) => callPush({ type: 'comment', postId }, post);

/** 내 댓글에 답글 — 서버가 그 댓글의 작성자에게 보낸다 */
export const pushReply = (postId, parentId, parent) => callPush({ type: 'reply', postId, parentId }, parent);

/** 보강 대기 자리 발생 — 서버가 makeupWaitlists/{id}가 notified인지 확인하고 그 문서로 문구를 만든다 */
export const pushMakeupSeat = (waitlistId) => callPush({ type: 'makeupSeat', waitlistId });

/** 보강 맞교환 확정 — 서버가 makeupWaitlists/{id}가 accepted이고 swapWith가 호출자인지 확인한 뒤 대기 주인에게 보낸다 */
export const pushMakeupSwap = (waitlistId) => callPush({ type: 'makeupSwap', waitlistId });
