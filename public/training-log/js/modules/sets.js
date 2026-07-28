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
        const isFreeform = isFreeformIntensity(set.intensity.unit);

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
                                inputmode="${isFreeform ? 'text' : 'decimal'}"
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
                                inputmode="numeric"
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
                                inputmode="numeric"
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
                                inputmode="numeric"
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

// 숫자 단위(kg/회/초)에는 숫자만 허용. '자율'·'높이'·'맨몸'은 자유 입력.
// ponytail: 정규식 한 줄로 입력 시 + 저장 시 두 지점에서만 거른다. 입력 마스킹 라이브러리 불필요.
export function numericOnly(value) {
    const cleaned = String(value ?? '').replace(/[^0-9.]/g, '');
    const [head, ...rest] = cleaned.split('.');
    return rest.length ? head + '.' + rest.join('') : head;
}

export const isFreeformIntensity = unit => unit === '자율' || unit === '높이' || unit === '맨몸';

// 저장 직전 방어 — 자동복원(localStorage)·옛 기록 등 입력 핸들러를 안 거친 값도 여기서 정리된다.
export function sanitizeSet(set) {
    const s = normalizeSet(set);
    const intensity = { ...s.intensity };
    const reps = { ...s.reps };
    if (!isFreeformIntensity(intensity.unit)) intensity.value = numericOnly(intensity.value);
    reps.value = numericOnly(reps.value);
    if (reps.count !== undefined && reps.count !== '') reps.count = numericOnly(reps.count);
    return { ...s, intensity, reps };
}

// 입력칸에 남은 문자 제거 후 화면 값도 맞춰준다(붙여넣기·한글 입력 대응)
// 실제로 뭔가 지워졌을 때만 입력칸 아래에 안내를 잠깐 띄운다 — alert은 글자마다 뜨므로 금지.
export function syncInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el || el.value === value) return;
    el.value = value;
    showNumericHint(el);
}

function showNumericHint(el) {
    const block = el.parentElement?.parentElement; // [강도/반복 블록] > [flex 행] > input
    if (!block) return;
    let hint = block.querySelector('.numeric-hint');
    if (!hint) {
        hint = document.createElement('p');
        hint.className = 'numeric-hint text-xs text-[#E94E58] mt-1';
        hint.textContent = '숫자만 입력할 수 있어요 (자율·높이는 자유 입력)';
        block.appendChild(hint);
    }
    hint.style.display = '';
    clearTimeout(hint._hideTimer);
    hint._hideTimer = setTimeout(() => { hint.style.display = 'none'; }, 2500);
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
        const clean = isFreeformIntensity(state.currentSets[index].intensity.unit) ? value : numericOnly(value);
        state.currentSets[index].intensity.value = clean;
        syncInputValue(`intensity-value-${index}`, clean);
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
        const clean = numericOnly(value);
        state.currentSets[index].reps.value = clean;
        syncInputValue(`reps-value-${index}`, clean);
        if (window.autoSaveFormData) window.autoSaveFormData();
    }
}

export function updateSetRepsCount(index, count) {
    if (state.currentSets[index]) {
        if (!state.currentSets[index].reps) state.currentSets[index].reps = { value: '', unit: '회' };
        const clean = numericOnly(count);
        state.currentSets[index].reps.count = clean;
        syncInputValue(`reps-count-${index}`, clean);
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
