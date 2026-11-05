import { escapeHTML } from './student-workspace-logic.js?v=20260925-student-ux';

// 기록 카드에 그 종목의 코치 체크리스트(음성 메모 자동화·코치 고정 메모)를 보여준다(2026-11-05).
// 입력 카드와 같은 기준: 미완료 + 오늘 체크한 항목(줄 그음). 체크는 입력 카드에서만 한다(읽기 전용).
// 새 파일로 둔 이유: 해시 없는 ES 모듈이라 기존 URL 모듈에 export를 추가하면 옛 캐시와 섞일 때 import가 깨진다.
// Firebase/DOM 의존 없음 — Vitest에서 바로 import 가능.
export function coachChecklistListHTML(coachMemos, exercise) {
    const today = new Date().toDateString();
    const list = (coachMemos || []).filter(m => m && m.exercise === exercise && m.memo
        && (!m.done || new Date(m.doneAt).toDateString() === today));
    if (!list.length) return '';
    const md = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`; };
    return `<ul class="mt-2 mb-2 bg-[#FAEEDA] border border-[#FAC775] rounded px-3 py-1.5">
        <li class="text-xs font-semibold text-[#854F0B] pt-1">✅ 코치 체크리스트</li>${list.map(m => `
        <li class="flex items-start gap-2 py-1 text-sm text-gray-800 leading-relaxed ${m.done ? 'opacity-50' : ''}">
            <span class="text-[#854F0B] shrink-0">${m.done ? '✓' : '•'}</span>
            <span class="flex-1 min-w-0 ${m.done ? 'line-through' : ''}" style="white-space: pre-wrap;">${escapeHTML(m.memo)}</span>
            ${md(m.createdAt) ? `<span class="text-[11px] text-[#854F0B] shrink-0 pt-0.5">${md(m.createdAt)}</span>` : ''}
        </li>`).join('')}</ul>`;
}
