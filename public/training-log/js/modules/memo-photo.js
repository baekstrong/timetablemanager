// 내 운동 메모 줄마다 사진 한 장 (2026-11-24 사용자 결정: 어떤 메모인지 눈으로 기억).
// 메모 항목에 photo:{url, publicId, width, height}만 저장한다(문서는 주소뿐이라 Firestore 크기·읽기량 영향 미미).
// 업로드는 게시판과 같은 Cloudinary unsigned preset — 이 값은 메인 앱 번들에도 이미 공개돼 있다.
// unsigned 업로드라 앱에서 사진 파일을 지울 수 없다: 메모에서 빼도 Cloudinary에는 남는다.
// Firebase는 쓰지 않는다(저장은 records.js). 순수 함수는 테스트에서 import.
export const CLOUD_NAME = 'dr8acof78';
const UPLOAD_PRESET = 'ml_default';
const FOLDER = 'training-memo';
const MAX_SIDE = 1280;

const PREFIX = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;

// 메모 문서는 로그인한 누구나 쓸 수 있으므로 우리 Cloudinary 주소만 그린다(엉뚱한 외부 주소·스크립트 차단).
export function isMemoPhotoUrl(url) {
    return typeof url === 'string' && url.startsWith(PREFIX) && !/["'<>\s\\]/.test(url);
}

// 변환 주소: 썸네일은 정사각형으로 잘라 작게, 크게 보기는 긴 변 1200px.
export function memoPhotoUrl(photo, kind = 'thumb') {
    const url = photo?.url;
    if (!isMemoPhotoUrl(url)) return '';
    const t = kind === 'full' ? 'c_limit,w_1200,h_1200,q_auto,f_auto' : 'c_fill,w_144,h_144,q_auto,f_auto';
    return PREFIX + t + '/' + url.slice(PREFIX.length);
}

// 크게 보기 등에서 쓰는 작은 썸네일 마크업. onclick은 호출하는 쪽이 넘긴다(이미 이스케이프된 JS 문자열).
export function memoPhotoThumbHTML(photo, onclick = '', size = 40) {
    const src = memoPhotoUrl(photo);
    if (!src) return '';
    return `<button type="button" ${onclick ? `onclick="event.stopPropagation(); ${onclick}"` : 'disabled'} aria-label="메모 사진 크게 보기"
        style="width:${size}px;height:${size}px;flex-shrink:0;padding:0;border:1px solid #EFEFF0;border-radius:8px;overflow:hidden;background:#F7F7F8;">
        <img src="${src}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;"></button>`;
}

// 긴 변 MAX_SIDE로 줄인 JPEG. 실패하면 원본을 그대로 올린다(아이폰 HEIC는 사파리가 고를 때 JPEG로 바꿔 준다).
async function shrink(file) {
    try {
        const url = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = url;
        });
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size < 600 * 1024) return file;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        return blob || file;
    } catch {
        return file;
    }
}

export async function uploadMemoPhoto(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('사진 파일만 올릴 수 있어요.');
    const body = new FormData();
    body.append('file', await shrink(file));
    body.append('upload_preset', UPLOAD_PRESET);
    body.append('folder', FOLDER);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body, signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !isMemoPhotoUrl(data.secure_url)) throw new Error(data?.error?.message || '사진을 올리지 못했어요.');
        return { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height };
    } finally {
        clearTimeout(timer);
    }
}

// 크게 보기 — 수강생 메모 카드·기록 카드·코치 화면 공용. onRemove가 있으면 '사진 빼기'를 보여준다(닫기 왼쪽, 빼기 오른쪽).
export function openMemoPhotoViewer(fullUrl, onRemove) {
    if (!isMemoPhotoUrl(fullUrl)) return;
    document.getElementById('memoPhotoViewer')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'memoPhotoViewer';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', '메모 사진');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;';
    const img = document.createElement('img');
    img.src = fullUrl;
    img.alt = '메모 사진';
    img.style.cssText = 'max-width:100%;max-height:calc(100dvh - 120px);border-radius:12px;object-fit:contain;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:12px;';
    const btn = (label, primary) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = `min-height:44px;padding:0 20px;border-radius:12px;font-size:15px;font-weight:700;border:0;${primary ? 'background:#E94E58;color:#fff;' : 'background:#fff;color:rgba(0,0,0,.85);'}`;
        return b;
    };
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const closeBtn = btn('닫기', false);
    closeBtn.onclick = close;
    bar.append(closeBtn);
    if (onRemove) {
        const removeBtn = btn('사진 빼기', true);
        removeBtn.onclick = () => {
            if (!confirm('이 메모에서 사진을 뺄까요?')) return;
            close();
            onRemove();
        };
        bar.append(removeBtn);
    }
    wrap.onclick = e => { if (e.target === wrap) close(); };
    document.addEventListener('keydown', onKey);
    wrap.append(img, bar);
    document.body.append(wrap);
    closeBtn.focus();
}
if (typeof window !== 'undefined') window.openMemoPhotoViewer = openMemoPhotoViewer;

// 올리는 동안 화면 아래 작은 안내(앱을 닫으면 사진이 안 붙는다는 걸 알 수 있게).
export function showMemoPhotoBusy(on) {
    let el = document.getElementById('memoPhotoBusy');
    if (!on) { el?.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'memoPhotoBusy';
    el.setAttribute('role', 'status');
    el.textContent = '📷 사진 올리는 중… 잠시만요';
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3000;background:#242428;color:#fff;font-size:14px;padding:10px 16px;border-radius:12px;';
    document.body.append(el);
}

// 사진 고르기 창. 고르면 File, 취소하면 아무 일도 없다.
export function pickImageFile(onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.onchange = () => {
        const file = input.files && input.files[0];
        input.remove();
        if (file) onPick(file);
    };
    document.body.append(input);
    input.click();
}
