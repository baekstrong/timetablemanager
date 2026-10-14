import { state, db } from '../state.js';
import { STAMP_GRADES, STAMP_ORDER, prevMonthRange, suggestGrade } from './stamp-logic.js';
import { FUNCTIONS_BASE } from '../config.js';
import { createMonthlySummaryClient } from '../monthlySummary.js?v=20261014-analytics';

export function currentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

// ===== 코치: 도장 모달 =====

const currentSessionKey = () => window.firebase?.auth().currentUser?.uid || '';
const loadMonthlySummary = createMonthlySummaryClient({
    getToken: () => window.firebase.auth().currentUser.getIdToken(),
    getSessionKey: currentSessionKey,
    endpoint: `${FUNCTIONS_BASE}/analytics/monthly`,
});
const memoCache = new Map();
const memoInflight = new Map();
const MEMO_CACHE_MS = 30_000;
let modalRequest = 0;
let stampContext = null;

function isCurrentContext(context) {
    return context.request === modalRequest && context.owner === state.currentUser
        && context.session === currentSessionKey() && state.isCoach
        && document.getElementById('stampModal')?.classList.contains('active');
}

export async function openStampModal(refresh = false) {
    const modal = document.getElementById('stampModal');
    if (!modal || !state.currentUser || !state.isCoach || !db || !currentSessionKey()) return;
    const month = currentMonthStr();
    const context = { request: ++modalRequest, owner: state.currentUser, session: currentSessionKey(), month, students: [] };
    stampContext = null;
    modal.classList.add('active');
    const body = document.getElementById('stampModalBody');
    const confirmButton = document.getElementById('stampConfirmBtn');
    confirmButton.disabled = true;
    confirmButton.textContent = '불러오는 중…';
    body.innerHTML = '<div class="text-center text-gray-500 py-8" role="status">불러오는 중...</div>';

    const { prevMonth } = prevMonthRange(month);
    document.getElementById('stampModalSubtitle').textContent = `지난달(${prevMonth}) 기준`;

    try {
        // 원본 기록은 서버에서 집계하고, 펼치지 않은 메모는 읽지 않는다.
        const [usersSnap, summary, stampSnap, fdoc] = await Promise.all([
            db.collection('users').get(),
            loadMonthlySummary(prevMonth, { refresh }),
            db.collection('monthlyStamps').where('month', '==', month).get(),
            db.collection('studentMeta').doc('frequencies').get().catch(() => null),
        ]);
        if (!isCurrentContext(context)) return;
        if (summary.month !== prevMonth || !Array.isArray(summary.students)) throw new Error('월간 집계를 확인할 수 없습니다.');

        const students = [];
        usersSnap.forEach(d => { if (!d.data().isCoach) students.push(d.id); });
        students.sort((a, b) => a.localeCompare(b, 'ko'));
        const statsByStudent = new Map();
        for (const student of summary.students) {
            // 도장은 자율운동 합집합이 아닌 기록 날짜 수와 문서 수를 사용한다.
            const activeDays = student.trainingDays;
            const totalExercises = student.totalExercises;
            if (!Number.isInteger(activeDays) || activeDays < 0 || !Number.isInteger(totalExercises) || totalExercises < activeDays) {
                throw new Error('월간 집계 형식을 확인할 수 없습니다.');
            }
            statsByStudent.set(student.userName, {
                activeDays,
                avgExercises: activeDays === 0 ? 0 : Math.round((totalExercises / activeDays) * 10) / 10,
            });
        }
        const existing = new Map();
        stampSnap.forEach(d => { existing.set(d.data().userName, d.data()); });
        const freqByStudent = fdoc?.exists ? fdoc.data().map || {} : {};

        const rows = students.map((name, idx) => {
            const stats = statsByStudent.get(name) || { activeDays: 0, avgExercises: 0 };
            const prefGrade = existing.get(name)?.grade || suggestGrade(stats.activeDays, freqByStudent[name]);
            const comment = existing.get(name)?.comment || '';
            const warn = stats.activeDays >= 6 && stats.avgExercises > 0 && stats.avgExercises < 1.5;
            const options = STAMP_ORDER.map(g =>
                `<option value="${g}" ${g === prefGrade ? 'selected' : ''}>${STAMP_GRADES[g].label}</option>`
            ).join('');
            return `
                <div class="border-b border-gray-200 py-2" data-student="${escapeHtml(name)}">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-bold text-gray-800 w-20">${escapeHtml(name)}</span>
                        <span class="text-xs text-gray-500">활동 ${stats.activeDays}일 · 일평균 ${stats.avgExercises}종목 ${warn ? '⚠️' : ''}</span>
                        <button type="button" id="stamp-memo-btn-${idx}" onclick="toggleStampMemos(${idx})" aria-expanded="false" aria-controls="stamp-memos-${idx}" class="text-xs text-[#329BE7] underline">📝 메모 보기</button>
                        <select class="stamp-grade-select ml-auto px-2 py-1 border rounded-lg text-sm">${options}</select>
                    </div>
                    <div id="stamp-memos-${idx}" class="hidden mt-1 pl-2 border-l-2 border-gray-200 space-y-1"></div>
                    <input type="text" class="stamp-comment-input w-full mt-1 px-2 py-1 border rounded-lg text-sm"
                           placeholder="💬 한 줄 코멘트 (선택)" value="${escapeHtml(comment)}">
                </div>`;
        }).join('');

        context.students = students;
        stampContext = context;
        body.innerHTML = rows || '<div class="text-center text-gray-500 py-8">수강생이 없습니다.</div>';
        confirmButton.disabled = students.length === 0;
        confirmButton.textContent = `전체 확정 (${students.length}명)`;
    } catch (error) {
        if (!isCurrentContext(context)) return;
        console.error('도장 집계 조회 실패:', error);
        body.innerHTML = '<div class="text-center text-gray-500 py-8" role="alert">지난달 기록을 확인하지 못했어요. <button type="button" onclick="openStampModal(true)" class="text-xs text-[#329BE7] underline">다시 시도</button></div>';
        confirmButton.textContent = '기록 확인 후 확정';
    }
}

function loadStampMemos(context, student) {
    const key = JSON.stringify([context.session, context.owner, student]);
    const cached = memoCache.get(key);
    if (cached && Date.now() - cached.at < MEMO_CACHE_MS) return Promise.resolve(cached.memos);
    if (memoInflight.has(key)) return memoInflight.get(key);
    const request = db.collection('pinnedMemos').doc(student).get().then(doc => {
        // 이전 계정의 응답을 새 계정의 표시나 캐시에 반영하지 않는다.
        if (context.owner !== state.currentUser || context.session !== currentSessionKey() || !state.isCoach) return null;
        const memos = doc.exists && Array.isArray(doc.data().memos) ? doc.data().memos : [];
        memoCache.set(key, { at: Date.now(), memos });
        return memos;
    }).finally(() => { if (memoInflight.get(key) === request) memoInflight.delete(key); });
    memoInflight.set(key, request);
    return request;
}

export async function toggleStampMemos(index) {
    const context = stampContext;
    if (!context || !isCurrentContext(context) || !Number.isInteger(index) || !context.students[index]) return;
    const list = document.getElementById(`stamp-memos-${index}`);
    const button = document.getElementById(`stamp-memo-btn-${index}`);
    if (!list || !button) return;
    const hidden = list.classList.toggle('hidden');
    button.setAttribute('aria-expanded', String(!hidden));
    if (hidden) return;
    list.innerHTML = '<div class="text-xs text-gray-500" role="status">메모 확인 중…</div>';
    try {
        const memos = await loadStampMemos(context, context.students[index]);
        if (!memos || !isCurrentContext(context) || stampContext !== context || document.getElementById(`stamp-memos-${index}`) !== list) return;
        button.textContent = `📝 메모 ${memos.length}개`;
        list.innerHTML = memos.length ? memos.map(m => `<div class="text-xs text-gray-600">${m.pain ? '⚠️ ' : ''}<b>${escapeHtml(m.exercise)}</b> ${escapeHtml(m.memo)}</div>`).join('')
            : '<div class="text-xs text-gray-500">등록된 메모가 없어요.</div>';
    } catch (error) {
        if (!isCurrentContext(context) || stampContext !== context || document.getElementById(`stamp-memos-${index}`) !== list) return;
        console.error('도장 메모 조회 실패:', error);
        list.innerHTML = `<div class="text-xs text-gray-500" role="alert">메모를 확인하지 못했어요. <button type="button" onclick="retryStampMemos(${index})" class="text-xs text-[#329BE7] underline">다시 시도</button></div>`;
    }
}

export function retryStampMemos(index) {
    document.getElementById(`stamp-memos-${index}`)?.classList.add('hidden');
    return toggleStampMemos(index);
}

export function closeStampModal() {
    modalRequest++;
    stampContext = null;
    const modal = document.getElementById('stampModal');
    if (modal) modal.classList.remove('active');
}

export async function confirmAllStamps() {
    const context = stampContext;
    if (!context || !isCurrentContext(context)) return;
    const month = currentMonthStr();
    if (month !== context.month) { await openStampModal(); return; }
    const rows = document.querySelectorAll('#stampModalBody [data-student]');
    if (rows.length === 0) { closeStampModal(); return; }

    const batch = db.batch();
    rows.forEach(row => {
        const name = row.getAttribute('data-student');
        const grade = row.querySelector('.stamp-grade-select').value;
        const comment = row.querySelector('.stamp-comment-input').value.trim();
        const ref = db.collection('monthlyStamps').doc(`${name}__${month}`);
        batch.set(ref, {
            userName: name,
            month,
            grade,
            comment,
            stampedBy: state.currentUser,
            stampedAt: new Date().toISOString(),
            seenByStudent: false, // ponytail: 재확정 시 학생 팝업 다시 뜸 — 월 1회라 허용
        });
    });
    await batch.commit();
    closeStampModal();
    alert(`${rows.length}명에게 도장을 찍었습니다.`);
}

// ===== 학생: 배지 + 팝업 =====

export function renderStampBadge(stamp) {
    if (!stamp || !STAMP_GRADES[stamp.grade]) return '';
    const g = STAMP_GRADES[stamp.grade];
    const monthNum = parseInt((stamp.month || '').split('-')[1], 10) || '';
    const note = stamp.comment
        ? `<p class="stamp-note">“${escapeHtml(stamp.comment)}”<span class="stamp-note-by"> — 코치</span></p>` : '';
    return `
        <style>
          @keyframes stamp-press {
            0% { opacity:0; transform: rotate(-7deg) scale(1.6); }
            60% { opacity:.9; transform: rotate(-7deg) scale(.94); }
            100% { opacity:.9; transform: rotate(-7deg) scale(1); }
          }
          .stamp-wrap { text-align:center; margin:6px 0 18px; }
          .stamp-headline { font-size:13px; font-weight:700; color:#6b7280; margin:0 0 8px; letter-spacing:-.3px; }
          .stamp-seal { position:relative; display:inline-flex; align-items:center; justify-content:center;
            width:128px; height:128px; border-radius:50%; border:3px solid var(--ink); color:var(--ink);
            transform:rotate(-7deg); opacity:.9; mix-blend-mode:multiply;
            box-shadow: inset 0 0 10px rgba(0,0,0,.06);
            animation: stamp-press .5s cubic-bezier(.2,.8,.2,1.2) both; }
          .stamp-seal::before { content:''; position:absolute; inset:8px; border-radius:50%;
            border:1.5px dashed currentColor; opacity:.55; }
          .stamp-core { display:flex; flex-direction:column; align-items:center; line-height:1.15; }
          .stamp-star { font-size:11px; opacity:.8; }
          .stamp-label { font-weight:800; font-size:16px; letter-spacing:-.5px; max-width:92px; text-align:center; padding:2px 0; }
          .stamp-month { font-size:10px; font-weight:700; opacity:.75; letter-spacing:1px; }
          .stamp-note { margin-top:12px; font-size:13.5px; color:#4b5563; font-style:italic; }
          .stamp-note-by { color:#9ca3af; font-style:normal; font-size:12px; }
        </style>
        <div class="stamp-wrap">
          ${g.headline ? `<p class="stamp-headline">${escapeHtml(g.headline)}</p>` : ''}
          <div class="stamp-seal" style="--ink:${g.color}">
            <div class="stamp-core">
              <span class="stamp-star">✦</span>
              <span class="stamp-label">${g.label}</span>
              <span class="stamp-month">${monthNum}월 근력학교</span>
            </div>
          </div>
          ${note}
        </div>`;
}

export async function loadMyStamp() {
    const container = document.getElementById('myStampContainer');
    if (!container) return;
    const month = currentMonthStr();
    const ref = db.collection('monthlyStamps').doc(`${state.currentUser}__${month}`);
    const doc = await ref.get();
    if (!doc.exists) { container.innerHTML = ''; return; }
    const stamp = doc.data();
    container.innerHTML = renderStampBadge(stamp);

    if (!stamp.seenByStudent) {
        showStampPopup(stamp);
        await ref.update({ seenByStudent: true });
    }
}

function showStampPopup(stamp) {
    const g = STAMP_GRADES[stamp.grade];
    if (!g) return;
    const comment = stamp.comment
        ? `<p class="text-gray-600 mt-2">${escapeHtml(stamp.comment)}</p>` : '';
    const overlay = document.createElement('div');
    overlay.id = 'stampPopupOverlay';
    overlay.className = 'modal active';
    overlay.innerHTML = `
        <div class="modal-content max-w-sm w-full text-center">
            <p class="text-sm text-gray-500 mb-1">이번 달 코치님의 도장이 도착했어요</p>
            ${g.headline ? `<p class="text-base font-bold text-gray-700 mb-2">${escapeHtml(g.headline)}</p>` : ''}
            <div class="inline-block px-6 py-2 rounded-full text-xl font-bold text-white mb-2" style="background:${g.color}">
                ${g.label}
            </div>
            ${comment}
            <button onclick="closeStampPopup()" class="mt-4 w-full bg-[#329BE7] hover:bg-[#327AB8] text-white py-2 rounded-lg font-bold">확인</button>
        </div>`;
    document.body.appendChild(overlay);
}

export function closeStampPopup() {
    document.getElementById('stampPopupOverlay')?.remove();
}
