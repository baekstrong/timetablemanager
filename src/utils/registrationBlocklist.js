// 신규 신청 차단 명단(블랙리스트) 순수 로직 (2026-11-14 사용자 요청).
// 정본 문서 registrationBlocklist/main = { entries:[{id,name,phone,memo,createdAt}], names:[], phones:[], updatedAt }
// names/phones 는 Firestore 규칙이 신청서와 비교하는 정규화 값이다 — 규칙의 정규화와 반드시 같게 유지할 것.
//   이름: 공백 제거 + 소문자 (규칙: name.replace(' ', '').lower())
//   번호: 숫자만 (규칙: phone.replace('[^0-9]', ''))
// 이름 또는 번호 중 하나라도 같으면 신청을 막는다.

export const normalizeBlockName = name => String(name || '').replace(/ /g, '').toLowerCase();
export const normalizeBlockPhone = phone => String(phone || '').replace(/[^0-9]/g, '');

export function validateBlockEntry({ name, phone } = {}) {
    const n = String(name || '').trim();
    const p = normalizeBlockPhone(phone);
    if (!n && !p) throw new Error('이름이나 핸드폰 번호 중 하나는 입력해주세요.');
    if (n.length > 50) throw new Error('이름은 50자 이내로 입력해주세요.');
    if (p && !/^01\d{8,9}$/.test(p)) throw new Error('핸드폰 번호를 010으로 시작하는 숫자로 입력해주세요.');
}

export function blocklistIndex(entries = []) {
    const names = new Set();
    const phones = new Set();
    for (const e of entries) {
        const n = normalizeBlockName(e.name);
        const p = normalizeBlockPhone(e.phone);
        if (n) names.add(n);
        if (p) phones.add(p);
    }
    return { names: [...names], phones: [...phones] };
}

export function addBlockEntry(entries = [], entry, now = Date.now()) {
    validateBlockEntry(entry);
    const name = String(entry.name || '').trim();
    const phone = normalizeBlockPhone(entry.phone);
    const dup = entries.find(e => (name && normalizeBlockName(e.name) === normalizeBlockName(name))
        || (phone && normalizeBlockPhone(e.phone) === phone));
    if (dup) throw new Error(`이미 차단 명단에 있습니다: ${[dup.name, formatBlockPhone(dup.phone)].filter(Boolean).join(' · ')}`);
    return [...entries, {
        id: `b${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name, phone, memo: String(entry.memo || '').trim().slice(0, 200), createdAt: now,
    }];
}

export const removeBlockEntry = (entries = [], id) => entries.filter(e => e.id !== id);

export function findBlockMatch(entries = [], { name, phone } = {}) {
    const n = normalizeBlockName(name);
    const p = normalizeBlockPhone(phone);
    return entries.find(e => (n && normalizeBlockName(e.name) === n) || (p && normalizeBlockPhone(e.phone) === p)) || null;
}

export function formatBlockPhone(phone) {
    const p = normalizeBlockPhone(phone);
    if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
    if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
    return p;
}

// 비로그인 신청자는 명단을 읽을 수 없어 규칙 거부(permission-denied)로만 막힌다. 차단 사실은 드러내지 않는다.
export const BLOCKED_SUBMIT_MESSAGE = '신청을 접수할 수 없습니다. 근력학교로 직접 문의해주세요.';
export const isPermissionDenied = error => error?.code === 'permission-denied'
    || /insufficient permissions/i.test(String(error?.message || ''));
