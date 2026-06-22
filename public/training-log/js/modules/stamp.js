import { state, db } from '../state.js';
import { getKoreanInitial } from '../utils.js';
import { STAMP_GRADES, STAMP_ORDER, prevMonthRange, computeStampStats, suggestGrade } from './stamp-logic.js';

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

export async function openStampModal() {
    const modal = document.getElementById('stampModal');
    if (!modal) return;
    modal.classList.add('active');
    const body = document.getElementById('stampModalBody');
    body.innerHTML = '<div class="text-center text-gray-500 py-8">불러오는 중...</div>';

    const month = currentMonthStr();
    const { prevMonth, start, end } = prevMonthRange(month);
    document.getElementById('stampModalSubtitle').textContent = `지난달(${prevMonth}) 기준`;

    // 1) 학생 목록
    const usersSnap = await db.collection('users').get();
    const students = [];
    usersSnap.forEach(d => {
        const u = d.data();
        if (!u.isCoach) students.push(d.id);
    });
    students.sort((a, b) => a.localeCompare(b, 'ko'));

    // 2) 지난달 기록 1회 범위 조회 후 학생별 그룹핑
    const recSnap = await db.collection('records')
        .where('date', '>=', start).where('date', '<=', end).get();
    const byStudent = {};
    recSnap.forEach(d => {
        const r = d.data();
        (byStudent[r.userName] = byStudent[r.userName] || []).push({ date: r.date, exercise: r.exercise });
    });

    // 3) 이미 이번 달 찍은 도장 프리필
    const stampSnap = await db.collection('monthlyStamps').where('month', '==', month).get();
    const existing = {};
    stampSnap.forEach(d => { existing[d.data().userName] = d.data(); });

    // 3.5) 학생별 고정 메모 (전체 1회 조회)
    const pmSnap = await db.collection('pinnedMemos').get();
    const memosByStudent = {};
    pmSnap.forEach(d => { memosByStudent[d.id] = (d.data().memos || []); });

    // 4) 행 렌더
    const rows = students.map((name, idx) => {
        const stats = computeStampStats(byStudent[name] || []);
        const prefGrade = existing[name]?.grade || suggestGrade(stats.activeDays);
        const comment = existing[name]?.comment || '';
        const warn = stats.activeDays >= 6 && stats.avgExercises > 0 && stats.avgExercises < 1.5;
        const options = STAMP_ORDER.map(g =>
            `<option value="${g}" ${g === prefGrade ? 'selected' : ''}>${STAMP_GRADES[g].label}</option>`
        ).join('');
        const memos = memosByStudent[name] || [];
        const memoBtn = `<button type="button" onclick="document.getElementById('stamp-memos-${idx}').classList.toggle('hidden')" class="text-xs text-[#329BE7] underline ${memos.length ? '' : 'opacity-40 pointer-events-none'}">📝 메모 ${memos.length}개</button>`;
        const memoList = memos.length === 0 ? '' : `
                <div id="stamp-memos-${idx}" class="hidden mt-1 pl-2 border-l-2 border-gray-200 space-y-1">
                    ${memos.map(m => `<div class="text-xs text-gray-600">${m.pain ? '⚠️ ' : ''}<b>${escapeHtml(m.exercise)}</b> ${escapeHtml(m.memo)}</div>`).join('')}
                </div>`;
        return `
            <div class="border-b border-gray-200 py-2" data-student="${escapeHtml(name)}">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-gray-800 w-20">${escapeHtml(name)}</span>
                    <span class="text-xs text-gray-500">활동 ${stats.activeDays}일 · 일평균 ${stats.avgExercises}종목 ${warn ? '⚠️' : ''}</span>
                    ${memoBtn}
                    <select class="stamp-grade-select ml-auto px-2 py-1 border rounded-lg text-sm">${options}</select>
                </div>
                ${memoList}
                <input type="text" class="stamp-comment-input w-full mt-1 px-2 py-1 border rounded-lg text-sm"
                       placeholder="💬 한 줄 코멘트 (선택)" value="${escapeHtml(comment)}">
            </div>`;
    }).join('');

    body.innerHTML = rows || '<div class="text-center text-gray-500 py-8">수강생이 없습니다.</div>';
    document.getElementById('stampConfirmBtn').textContent = `전체 확정 (${students.length}명)`;
}

export function closeStampModal() {
    const modal = document.getElementById('stampModal');
    if (modal) modal.classList.remove('active');
}

export async function confirmAllStamps() {
    const month = currentMonthStr();
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
    const comment = stamp.comment
        ? `<p class="text-sm text-gray-600 mt-1">${escapeHtml(stamp.comment)}</p>` : '';
    return `
        <div class="rounded-lg p-4 mb-4 text-center" style="border:2px solid ${g.color};background:${g.color}1A">
            <div class="inline-block px-4 py-1 rounded-full font-bold text-white" style="background:${g.color}">
                ${g.label}
            </div>
            ${comment}
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
            <p class="text-sm text-gray-500 mb-3">이번 달 코치님의 도장이 도착했어요</p>
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
