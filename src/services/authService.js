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

async function requestAuth(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${getAuthBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `인증 요청 실패 (${res.status})`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('인증 서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function serverLogin(name, password) {
  const data = await requestAuth('/login', { name, password });
  await signInWithCustomToken(auth, data.token);
  return { isCoach: data.isCoach };
}

export async function setStudentPassword(coachName, coachPassword, targetName, newPassword) {
  await requestAuth('/set-password', { coachName, coachPassword, targetName, newPassword });
}

export async function changeMyPassword(name, currentPassword, newPassword) {
  await requestAuth('/change-password', { name, currentPassword, newPassword });
}
