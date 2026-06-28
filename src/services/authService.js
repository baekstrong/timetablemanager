import { auth } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

// smsService.js와 동일한 베이스 URL 해석: VITE_FUNCTIONS_URL의 /sheets를 /auth로 교체
function getAuthBaseUrl() {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  if (functionsUrl) {
    const base = functionsUrl.replace(/\/sheets\/?$/, '');
    return `${base}/auth`;
  }
  if (import.meta.env.PROD) return '/.netlify/functions/auth';
  return 'http://localhost:5001/auth';
}

export async function serverLogin(name, password) {
  const res = await fetch(`${getAuthBaseUrl()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `로그인 실패 (${res.status})`);
  }
  await signInWithCustomToken(auth, data.token);
  return { isCoach: data.isCoach };
}

export async function setStudentPassword(coachName, coachPassword, targetName, newPassword) {
  const res = await fetch(`${getAuthBaseUrl()}/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coachName, coachPassword, targetName, newPassword }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `비밀번호 설정 실패 (${res.status})`);
  }
}
