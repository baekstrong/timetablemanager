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

    let html = '';
    state.currentSets.forEach((set, index) => {
        // 하위 호환
        if (typeof set.weight === 'string' || typeof set.reps === 'string') {
            set = normalizeSet(set);
            state.currentSets[index] = set;
        }

        const isSecXReps = set.reps.unit === '초 x 회';
        const isBodyweight = set.intensity.unit === '맨몸';

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
                        ${!isBodyweight ? `
                            <input 
                                type="text" 
                                id="intensity-value-${index}" 
                                value="${set.intensity.value}"
                                placeholder="80"
                                onchange="updateSetIntensity(${index}, this.value)"
                                class="intensity-input px-3 py-2 border rounded-lg text-sm"
                            >
                        ` : `
                            <div class="flex-1 px-3 py-2 border rounded-lg text-sm bg-gray-50 flex items-center text-gray-600">
                                맨몸 운동
                            </div>
                        `}
                        <select 
                            id="intensity-unit-${index}"
                            onchange="updateSetIntensityUnit(${index}, this.value)"
                            class="px-2 py-2 border rounded-lg text-sm bg-white"
                        >
                            <option value="kg" ${set.intensity.unit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="높이" ${set.intensity.unit === '높이' ? 'selected' : ''}>높이</option>
                            <option value="맨몸" ${set.intensity.unit === '맨몸' ? 'selected' : ''}>맨몸</option>
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
                                onchange="updateSetRepsValue(${index}, this.value)"
                                class="w-16 px-2 py-2 border rounded-lg text-sm"
                            >
                            <span class="text-xs text-gray-600">초</span>
                            <span class="text-gray-400">×</span>
                            <input 
                                type="text" 
                                id="reps-count-${index}" 
                                value="${set.reps.count || ''}"
                                placeholder="3"
                                onchange="updateSetRepsCount(${index}, this.value)"
                                class="w-16 px-2 py-2 border rounded-lg text-sm"
                            >
                            <span class="text-xs text-gray-600">회</span>
                        ` : `
                            <input 
                                type="text" 
                                id="reps-value-${index}" 
                                value="${set.reps.value}"
                                placeholder="10"
                                onchange="updateSetRepsValue(${index}, this.value)"
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

export function addSet() {
    state.currentSets.push({
        intensity: { value: '', unit: 'kg' },
        reps: { value: '', unit: '회' }
    });
    renderSets();
    if (window.autoSaveFormData) window.autoSaveFormData();
}

export function removeSet(index) {
    state.currentSets.splice(index, 1);
    renderSets();
    if (window.autoSaveFormData) window.autoSaveFormData();
}

export function addSameSet() {
    if (state.currentSets.length === 0) {
        state.currentSets.push({
            intensity: { value: '', unit: 'kg' },
            reps: { value: '', unit: '회' }
        });
        renderSets();
        return;
    }

    const lastSet = state.currentSets[state.currentSets.length - 1];
    const normalized = normalizeSet(lastSet);

    if (!normalized.intensity.value && !normalized.reps.value) {
        alert('마지막 세트의 강도와 횟수를 먼저 입력해주세요!');
        return;
    }

    // 모달 HTML 생성
    const modalHTML = `
        <div id="addSetModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000;">
            <div style="background: white; border-radius: 16px; padding: 24px; max-width: 300px; width: 90%;">
                <h3 style="text-align: center; font-size: 18px; font-weight: bold; margin-bottom: 20px;">세트 추가</h3>
                <div style="display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 20px;">
                    <button onclick="changeAddSetCount(-1)" style="width: 50px; height: 50px; font-size: 24px; background: #e5e7eb; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; touch-action: manipulation; -webkit-user-select: none; user-select: none;">−</button>
                    <span id="addSetCountDisplay" style="font-size: 32px; font-weight: bold; min-width: 50px; text-align: center; -webkit-user-select: none; user-select: none;">${state.addSetCount}</span>
                    <button onclick="changeAddSetCount(1)" style="width: 50px; height: 50px; font-size: 24px; background: #e5e7eb; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; touch-action: manipulation; -webkit-user-select: none; user-select: none;">+</button>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="confirmAddSameSet()" style="flex: 1; background: #2563eb; color: white; padding: 12px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">확인</button>
                    <button onclick="closeAddSetModal()" style="flex: 1; background: #6b7280; color: white; padding: 12px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">취소</button>
                </div>
            </div>
        </div>
    `;

    const modalDiv = document.createElement('div');
    modalDiv.innerHTML = modalHTML;
    document.body.appendChild(modalDiv.firstElementChild);
}

export function changeAddSetCount(delta) {
    state.addSetCount += delta;
    if (state.addSetCount < 1) state.addSetCount = 1;
    if (state.addSetCount > 20) state.addSetCount = 20;
    const display = document.getElementById('addSetCountDisplay');
    if (display) display.textContent = state.addSetCount;
}

export function closeAddSetModal() {
    const modal = document.getElementById('addSetModal');
    if (modal) modal.remove();
    state.addSetCount = 1;
}

export function confirmAddSameSet() {
    const lastSet = state.currentSets[state.currentSets.length - 1];
    const normalized = normalizeSet(lastSet);

    for (let i = 0; i < state.addSetCount; i++) {
        state.currentSets.push(JSON.parse(JSON.stringify(normalized)));
    }

    closeAddSetModal();
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
    }
}

export function updateSetRepsUnit(index, unit) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].reps) state.currentSets[index].reps = { value: '', unit: '회' };
        state.currentSets[index].reps.unit = unit;
        renderSets();
    }
}
