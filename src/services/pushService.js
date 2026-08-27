import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import app, { auth, db } from '../config/firebase';

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

/**
 * 권한 확보 후 FCM 토큰을 users/{이름}에 저장.
 * @param {string} userName
 * @param {boolean} ask - true면 권한 요청 팝업을 띄운다. 아이폰은 사용자 제스처 안에서만 통하므로
 *                        버튼 클릭 핸들러에서만 true로 부를 것.
 */
export const initPush = async (userName, ask = false) => {
  try {
    if (!userName || !(await isPushAvailable())) return null;

    let permission = Notification.permission;
    if (permission === 'default' && ask) permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;

    // 접속마다 write 하지 않도록 직전 토큰과 비교 (프로젝트 전반의 "내용 같으면 write 생략" 패턴)
    const cacheKey = `push_token_${userName}`;
    if (localStorage.getItem(cacheKey) === token) return token;
    await setDoc(doc(db, 'users', userName), { fcmToken: token, fcmUpdatedAt: serverTimestamp() }, { merge: true });
    localStorage.setItem(cacheKey, token);
    return token;
  } catch (err) {
    console.warn('푸시 초기화 실패(무시):', err?.message);
    return null;
  }
};

/** 로그아웃/계정 전환 시 토큰 캐시만 비운다 (users 문서의 토큰은 서버가 무효 응답 받을 때 정리) */
export const clearPushTokenCache = (userName) => {
  try { localStorage.removeItem(`push_token_${userName}`); } catch { /* noop */ }
};

const callPush = async (payload) => {
  try {
    const current = auth?.currentUser;
    if (!current) return false;
    const idToken = await current.getIdToken();
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
export const pushNotice = (names, title, content) =>
  callPush({ type: 'notice', names, title, content });

// 아래 둘은 대상·문구를 서버가 문서에서 직접 읽어 정한다. 여기선 어느 문서인지만 알려준다.
/** 내 글에 댓글 — 서버가 posts/{postId}의 작성자에게 보낸다 */
export const pushComment = (postId) => callPush({ type: 'comment', postId });

/** 내 댓글에 답글 — 서버가 그 댓글의 작성자에게 보낸다 */
export const pushReply = (postId, parentId) => callPush({ type: 'reply', postId, parentId });

/** 보강 대기 자리 발생 — 서버가 makeupWaitlists/{id}가 notified인지 확인하고 그 문서로 문구를 만든다 */
export const pushMakeupSeat = (waitlistId) => callPush({ type: 'makeupSeat', waitlistId });
