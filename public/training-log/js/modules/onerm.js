// 1RM(1회 최대 중량) 계산기 — Epley 공식.
// 순수 함수(estimate1RM/trainingTable)는 Firebase/DOM 무관 → 브라우저·Vitest 양쪽 import 가능.

const PERCENTS = [95, 90, 85, 80, 75, 70];

// 0.5kg 단위 반올림 (원판 맞추기 편하게)
const round05 = (x) => Math.round(x * 2) / 2;

// Epley: 1RM = w × (1 + reps/30). 무게>0·횟수≥1 아니면 null.
// 1회는 정의상 그 무게가 곧 1RM (Epley는 reps>1용) → 무게 그대로.
export function estimate1RM(weight, reps) {
    const w = parseFloat(weight), r = parseFloat(reps);
    if (!(w > 0) || !(r >= 1)) return null;
    if (r === 1) return round05(w);
    return round05(w * (1 + r / 30));
}

// 예상 1RM → [{ pct, weight }] (%별 훈련 중량표)
export function trainingTable(oneRM) {
    if (!(oneRM > 0)) return [];
    return PERCENTS.map((pct) => ({ pct, weight: round05(oneRM * pct / 100) }));
}

// ============================================
// DOM (모달 열기/닫기/계산)
// ============================================

export function openOneRMModal() {
    const m = document.getElementById('onermModal');
    if (m) m.classList.remove('hidden');
}

export function closeOneRMModal() {
    const m = document.getElementById('onermModal');
    if (m) m.classList.add('hidden');
}

export function calcOneRM() {
    const out = document.getElementById('onermResult');
    if (!out) return;

    const weight = document.getElementById('onermWeight')?.value;
    const reps = document.getElementById('onermReps')?.value;
    const oneRM = estimate1RM(weight, reps);

    if (oneRM === null) {
        out.innerHTML = `<p class="text-sm text-gray-500 text-center py-2">무게(kg)와 횟수를 입력하세요</p>`;
        return;
    }

    const warn = parseFloat(reps) > 12
        ? `<p class="text-xs text-[#EDBC40] text-center mb-2">※ 12회 이하에서 더 정확해요</p>`
        : '';

    const cells = trainingTable(oneRM)
        .map(({ pct, weight }) => `
            <div class="flex justify-between px-3 py-1.5 bg-gray-50 rounded">
                <span class="text-gray-500">${pct}%</span>
                <span class="font-semibold text-gray-800">${weight} kg</span>
            </div>`).join('');

    out.innerHTML = `
        ${warn}
        <div class="text-center mb-3">
            <div class="text-sm text-gray-500">예상 1RM</div>
            <div class="text-3xl font-bold text-[#329BE7]">≈ ${oneRM} kg</div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm">${cells}</div>`;
}
