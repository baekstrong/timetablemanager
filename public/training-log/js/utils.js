import { studentColors, studentBadgeColors, studentTextColors } from './config.js';

// ============================================
// 유틸리티 함수
// ============================================

export function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const weekday = weekdays[date.getDay()];
    return `${month}월 ${day}일 (${weekday})`;
}

// 한글 초성 추출 함수
export function getKoreanInitial(name) {
    if (!name || name.length === 0) return '#';

    const char = name.charAt(0);
    const code = char.charCodeAt(0);

    // 한글이 아닌 경우
    if (code < 0xAC00 || code > 0xD7A3) {
        return '#';
    }

    const initial = Math.floor((code - 0xAC00) / 588);
    const initials = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

    return initials[initial] || '#';
}

export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 색상 관련 함수 (Deterministic Hash-based)
// userName의 해시값을 구해서 항상 같은 색상을 반환하도록 수정
export function getStudentColor(userName) {
    if (!userName) return '#FFFFFF';

    let hash = 0;
    for (let i = 0; i < userName.length; i++) {
        hash = userName.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % studentColors.length;
    return studentColors[index];
}

export function getStudentBadgeColor(userName) {
    if (!userName) return '#E5E7EB';

    let hash = 0;
    for (let i = 0; i < userName.length; i++) {
        hash = userName.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % studentBadgeColors.length;
    return studentBadgeColors[index];
}

export function getStudentTextColor(userName) {
    if (!userName) return '#374151';

    let hash = 0;
    for (let i = 0; i < userName.length; i++) {
        hash = userName.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % studentTextColors.length;
    return studentTextColors[index];
}

// ============================================
// localStorage 관련
// ============================================
export function saveLogin(name, password, coach) {
    localStorage.setItem('savedUser', JSON.stringify({
        name: name,
        password: password,
        isCoach: coach
    }));
}

export function loadSavedLogin() {
    const saved = localStorage.getItem('savedUser');
    if (saved) {
        const data = JSON.parse(saved);
        return data;
    }
    return null;
}

export function clearSavedLogin() {
    localStorage.removeItem('savedUser');
}
