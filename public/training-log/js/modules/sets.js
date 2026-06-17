import { state } from '../state.js';

// ============================================
// 세트 추가/제거 및 관리
// ============================================

export function renderSets() {
    const container = document.getElementById('setsContainer');
    if (!container) return;

    if (state.currentSets.length === 0) {
        state.currentSets.push({
            intensity: { value: '', unit: 'kg' },
            reps: { value: '', unit: '회' }
        });
    }

    let html = `
        <div class="flex items-center gap-2 mb-3">
            <label class="text-sm font-semibold text-gray-700">세트 수</label>
            <select onchange="setSetCount(this.value)" class="px-3 py-2 border rounded-lg text-sm bg-white">
                ${Array.from({ length: 20 }, (_, i) => i + 1).map(n =>
                    `<option value="${n}" ${state.currentSets.length === n ? 'selected' : ''}>${n}세트</option>`
                ).join('')}
            </select>
        </div>
    `;
    state.currentSets.forEach((set, index) => {
        // 하위 호환
        if (typeof set.weight === 'string' || typeof set.reps === 'string') {
            set = normalizeSet(set);
            state.currentSets[index] = set;
        }

        const isSecXReps = set.reps.unit === '초 x 회';
        const isBodyweight = set.intensity.unit === '맨몸';
        const isFreeform = set.intensity.unit === '자율';

        html += `
            <div class="set-row">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold text-gray-700 min-w-[60px]">${index + 1}세트</span>
                    ${state.currentSets.length > 1 ? `<button onclick="removeSet(${index})" type="button" class="set-delete-btn text-red-600 text-sm font-semibold">삭제</button>` : ''}
                </div>

                <!-- 강도 입력 -->
                <div class="mb-2">
                    <label class="text-xs text-gray-600 mb-1 block">강도</label>
                    <div class="flex gap-1">
                        ${isBodyweight ? `
                            <div class="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-50 flex items-center text-gray-600">
                                맨몸 운동
                            </div>
                        ` : `
                            <input
                                type="text"
                                id="intensity-value-${index}"
                                value="${set.intensity.value}"
                                placeholder="${isFreeform ? '자유 입력' : '80'}"
                                oninput="updateSetIntensity(${index}, this.value)"
                                class="intensity-input px-3 py-2 border rounded-lg text-sm"
                            >
                        `}
                        <select
                            id="intensity-unit-${index}"
                            onchange="updateSetIntensityUnit(${index}, this.value)"
                            class="px-2 py-2 border rounded-lg text-sm bg-white"
                        >
                            <option value="kg" ${set.intensity.unit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="높이" ${set.intensity.unit === '높이' ? 'selected' : ''}>높이</option>
                            <option value="맨몸" ${set.intensity.unit === '맨몸' ? 'selected' : ''}>맨몸</option>
                            <option value="자율" ${set.intensity.unit === '자율' ? 'selected' : ''}>자율</option>
                        </select>
                    </div>
                </div>
                
                <!-- 반복 입력 -->
                <div>
                    <label class="text-xs text-gray-600 mb-1 block">반복</label>
                    <div class="flex gap-1 items-center">
                        ${isSecXReps ? `
                            <input
                                type="text"
                                id="reps-value-${index}"
                                value="${set.reps.value}"
                                placeholder="30"
                                oninput="updateSetRepsValue(${index}, this.value)"
                                class="w-16 px-2 py-2 border rounded-lg text-sm"
                            >
                            <span class="text-xs text-gray-600">초</span>
                            <span class="text-gray-400">×</span>
                            <input
                                type="text"
                                id="reps-count-${index}"
                                value="${set.reps.count || ''}"
                                placeholder="3"
                                oninput="updateSetRepsCount(${index}, this.value)"
                                class="w-16 px-2 py-2 border rounded-lg text-sm"
                            >
                            <span class="text-xs text-gray-600">회</span>
                        ` : `
                            <input
                                type="text"
                                id="reps-value-${index}"
                                value="${set.reps.value}"
                                placeholder="10"
                                oninput="updateSetRepsValue(${index}, this.value)"
                                class="intensity-input px-3 py-2 border rounded-lg text-sm"
                            >
                        `}
                        <select 
                            id="reps-unit-${index}"
                            onchange="updateSetRepsUnit(${index}, this.value)"
                            class="px-2 py-2 border rounded-lg text-sm bg-white"
                        >
                            <option value="회" ${set.reps.unit === '회' ? 'selected' : ''}>회</option>
                            <option value="초" ${set.reps.unit === '초' ? 'selected' : ''}>초</option>
                            <option value="초 x 회" ${set.reps.unit === '초 x 회' ? 'selected' : ''}>초 x 회</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

export function normalizeSet(set) {
    let normalized = {
        intensity: { value: '', unit: 'kg' },
        reps: { value: '', unit: '회' }
    };

    if (set.weight || set.intensity) {
        if (typeof set.weight === 'string') {
            normalized.intensity.value = set.weight;
        } else if (set.intensity) {
            normalized.intensity = set.intensity;
        }
    }

    if (set.reps) {
        if (typeof set.reps === 'string') {
            normalized.reps.value = set.reps;
        } else {
            normalized.reps = set.reps;
        }
    }

    return normalized;
}

// 세트 수 드롭다운: 늘리면 마지막 세트를 복제, 줄이면 뒤에서부터 제거
export function setSetCount(n) {
    n = parseInt(n, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 20) n = 20;
    const cur = state.currentSets.length;
    if (n > cur) {
        const template = cur > 0
            ? normalizeSet(state.currentSets[cur - 1])
            : { intensity: { value: '', unit: 'kg' }, reps: { value: '', unit: '회' } };
        for (let i = cur; i < n; i++) {
            state.currentSets.push(JSON.parse(JSON.stringify(template)));
        }
    } else if (n < cur) {
        state.currentSets.length = n;
    }
    renderSets();
    if (window.autoSaveFormData) window.autoSaveFormData();
}

export function removeSet(index) {
    state.currentSets.splice(index, 1);
    renderSets();
    if (window.autoSaveFormData) window.autoSaveFormData();
}

// 세트 업데이트 함수들
export function updateSetIntensity(index, value) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].intensity) state.currentSets[index].intensity = { value: '', unit: 'kg' };
        state.currentSets[index].intensity.value = value;
        if (window.autoSaveFormData) window.autoSaveFormData();
    }
}

export function updateSetIntensityUnit(index, unit) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].intensity) state.currentSets[index].intensity = { value: '', unit: 'kg' };
        state.currentSets[index].intensity.unit = unit;

        if (unit === '맨몸') {
            state.currentSets[index].intensity.value = '맨몸';
        } else if (state.currentSets[index].intensity.value === '맨몸') {
            state.currentSets[index].intensity.value = '';
        }
        if (unit === '자율' && state.currentSets[index].intensity.value === '맨몸') {
            state.currentSets[index].intensity.value = '';
        }

        renderSets();
    }
}

export function updateSetRepsValue(index, value) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].reps) state.currentSets[index].reps = { value: '', unit: '회' };
        state.currentSets[index].reps.value = value;
        if (window.autoSaveFormData) window.autoSaveFormData();
    }
}

export function updateSetRepsCount(index, count) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].reps) state.currentSets[index].reps = { value: '', unit: '회' };
        state.currentSets[index].reps.count = count;
        if (window.autoSaveFormData) window.autoSaveFormData();
    }
}

export function updateSetRepsUnit(index, unit) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].reps) state.currentSets[index].reps = { value: '', unit: '회' };
        state.currentSets[index].reps.unit = unit;
        renderSets();
    }
}
