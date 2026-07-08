import { state, db, firebaseInitialized } from '../state.js';

// ============================================
// 운동 종목 관리 (Exercises Collection)
// ============================================

export async function loadExercisesList() {
    const CACHE_KEY = 'exercisesListCache';

    // 캐시에서 즉시 로드 (UI 빠르게 표시)
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        try {
            const names = JSON.parse(cached);
            exercisesCache = names;
            updateExerciseDatalistFromNames(names);
        } catch (e) { /* 캐시 파싱 실패 시 무시 */ }
    }

    try {
        const snapshot = await db.collection('exercises').orderBy('name').get();

        // 1. Update Admin List UI (if exists)
        const listContainer = document.getElementById('adminExerciseList');
        if (listContainer) {
            if (snapshot.empty) {
                listContainer.innerHTML = '<div class="text-gray-500 text-sm text-center py-4">등록된 운동이 없습니다.</div>';
            } else {
                let html = '<div class="grid grid-cols-2 gap-2">';
                snapshot.forEach(doc => {
                    const data = doc.data();
                    // 종목명은 코치 입력 → HTML 이스케이프 후 삽입. 삭제는 data 속성+위임(아래 리스너).
                    html += `
                        <div class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-200">
                            <span class="text-sm font-medium text-gray-700">${escapeHtml(data.name)}</span>
                            <button data-delid="${escapeHtml(doc.id)}" data-delname="${escapeHtml(data.name)}" class="text-red-500 hover:text-red-700 text-xs px-2 py-1">
                                ✕
                            </button>
                        </div>
                    `;
                });
                html += '</div>';
                listContainer.innerHTML = html;
            }
        }

        // 2. Update Datalist (Always) + 캐시 갱신
        updateExerciseDatalist(snapshot);
        const names = [];
        snapshot.forEach(doc => names.push(doc.data().name));
        localStorage.setItem(CACHE_KEY, JSON.stringify(names));

    } catch (error) {
        console.error('Error loading exercises:', error);
        const listContainer = document.getElementById('adminExerciseList');
        if (listContainer) listContainer.innerHTML = '<div class="text-red-500 text-sm">목록 로딩 실패</div>';
    }
}

// 이름 비교용 정규화 — 띄어쓰기/대소문자 무시 ("하이크 패스" == "하이크패스")
function normalizeExerciseName(name) {
    return (name || '').replace(/\s+/g, '').toLowerCase();
}

// HTML 문자열 삽입용 이스케이프 (종목명은 코치 입력이라 신뢰하되 방어적으로 처리)
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function addExercise() {
    const input = document.getElementById('newExerciseInput');
    const name = input.value.trim();

    if (!name) {
        alert('운동 이름을 입력해주세요.');
        return;
    }

    try {
        // 중복 체크 — 띄어쓰기만 다른 사실상 같은 종목도 잡음
        const norm = normalizeExerciseName(name);
        const dup = exercisesCache.find(n => normalizeExerciseName(n) === norm);
        if (dup) {
            alert(`이미 등록된 운동입니다: '${dup}'`);
            return;
        }
        // 정확히 같은 이름은 서버에서도 한 번 더 확인(동시 추가 방지)
        const snapshot = await db.collection('exercises').where('name', '==', name).get();
        if (!snapshot.empty) {
            alert('이미 등록된 운동입니다.');
            return;
        }

        await db.collection('exercises').add({
            name: name,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        input.value = '';
        const box = document.getElementById('newExerciseSuggestions');
        if (box) box.classList.add('hidden');
        loadExercisesList();
        alert('✅ 운동이 추가되었습니다.');
    } catch (error) {
        console.error('Error adding exercise:', error);
        alert('추가 실패: ' + error.message);
    }
}

// 코치가 새 종목을 타이핑할 때 이미 등록된 종목을 드롭다운으로 보여줌 (중복 등록 방지)
// 띄어쓰기 무시 매칭 → "하이크패스" 입력해도 기존 "하이크 패스"가 뜸.
export function handleNewExerciseSearch(query) {
    const box = document.getElementById('newExerciseSuggestions');
    if (!box) return;

    const nq = normalizeExerciseName(query);
    const matches = nq ? exercisesCache.filter(n => normalizeExerciseName(n).includes(nq)) : [];
    if (matches.length === 0) {
        box.classList.add('hidden');
        return;
    }

    // data-name + 이벤트 위임 (아래 document click 리스너) — 인라인 JS 없이 안전하게
    box.innerHTML = matches.map(name => `
        <div class="px-4 py-2 hover:bg-[#329BE71A] cursor-pointer text-sm text-gray-700 border-b border-[#EFEFF0] last:border-0"
             data-newexercise="${escapeHtml(name)}">
            ${escapeHtml(name)} <span class="text-xs text-gray-400">(이미 등록됨)</span>
        </div>`).join('');
    box.classList.remove('hidden');
}

// 드롭다운에서 기존 종목 선택 → 입력칸 채우고 닫음 (추가 누르면 중복 안내로 막힘)
export function fillNewExercise(name) {
    const input = document.getElementById('newExerciseInput');
    if (input) input.value = name;
    const box = document.getElementById('newExerciseSuggestions');
    if (box) box.classList.add('hidden');
}

export async function deleteExercise(docId, name) {
    if (!confirm(`'${name}' 운동을 목록에서 삭제하시겠습니까?\n(기존 기록은 유지됩니다)`)) return;

    try {
        await db.collection('exercises').doc(docId).delete();
        loadExercisesList();
    } catch (error) {
        console.error('Error deleting exercise:', error);
        alert('삭제 실패: ' + error.message);
    }
}

// ============================================
// Custom Autocomplete Logic
// ============================================

let exercisesCache = [];

// 학생 개인 전용 종목(코치 공용 목록에 없는, 본인이 '직접 추가'한 운동)
// 새 컬렉션 없이 기기별 localStorage에 기억 → 그 학생 자동완성에만 노출.
// (기록 자체는 custom:true로 records에 남으므로 데이터는 유실되지 않음)
// ponytail: 기기별 localStorage 기억. 다기기 동기화가 필요하면 records custom==true 쿼리로 시드.
let myCustomExercisesCache = [];

function customCacheKey() {
    return 'myCustomExercises_' + (state.currentUser || '');
}

export function loadMyCustomExercises() {
    myCustomExercisesCache = [];
    if (!state.currentUser || state.isCoach) return;
    try {
        const raw = localStorage.getItem(customCacheKey());
        if (raw) myCustomExercisesCache = JSON.parse(raw) || [];
    } catch (e) { /* 캐시 파싱 실패 무시 */ }
}

function rememberCustomExercise(name) {
    if (!name || exercisesCache.includes(name) || myCustomExercisesCache.includes(name)) return;
    myCustomExercisesCache.push(name);
    try { localStorage.setItem(customCacheKey(), JSON.stringify(myCustomExercisesCache)); } catch (e) { /* 무시 */ }
}

// Called when exercises are loaded from Firestore
// Called when exercises are loaded from Firestore
export function updateExerciseDatalist(snapshot) {
    const names = [];
    snapshot.forEach(doc => names.push(doc.data().name));
    updateExerciseDatalistFromNames(names);
}

function updateExerciseDatalistFromNames(names) {
    exercisesCache = names;
    const coachSelect = document.getElementById('coachExerciseFilter');
    if (coachSelect) {
        let coachOptions = '<option value="">🏋️ 운동 종목별 모아보기 (전체)</option>';
        names.forEach(name => {
            coachOptions += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        });
        coachSelect.innerHTML = coachOptions;
    }
}

// Called on input/focus in the student exercise input
export function handleExerciseSearch(query) {
    const suggestionBox = document.getElementById('exerciseSuggestions');
    if (!suggestionBox) return;

    // 공용 종목 + 내 개인 종목 병합 (중복 제거)
    const all = [...exercisesCache, ...myCustomExercisesCache.filter(n => !exercisesCache.includes(n))];
    const q = (query || '').trim();
    const filtered = q
        ? all.filter(name => name.toLowerCase().includes(q.toLowerCase()))
        : all;

    let html = filtered.map(name => {
        const mine = myCustomExercisesCache.includes(name) && !exercisesCache.includes(name);
        return `
        <div class="px-4 py-3 hover:bg-[#329BE71A] cursor-pointer text-gray-700 font-medium border-b border-[#EFEFF0] last:border-0 transition-colors"
             onclick="selectExerciseSuggestion('${name}')">
            ${name}${mine ? ' <span class="text-xs text-gray-400">(내 종목)</span>' : ''}
        </div>`;
    }).join('');

    // 목록에 정확히 일치하는 종목이 없으면 '직접 추가' 옵션 노출 (개인 운동용)
    const safeQ = q.replace(/['"\\<>]/g, '');
    const exact = all.some(name => name.toLowerCase() === q.toLowerCase());
    if (safeQ && !exact) {
        html += `
        <div class="px-4 py-3 hover:bg-[#329BE71A] cursor-pointer text-[#329BE7] font-semibold border-t border-[#EFEFF0] transition-colors"
             onclick="selectCustomExercise('${safeQ}')">
            + '${safeQ}' 직접 추가 <span class="text-xs text-gray-400">(내 운동으로 저장)</span>
        </div>`;
    }

    if (!html) {
        suggestionBox.classList.add('hidden');
        return;
    }

    suggestionBox.innerHTML = html;
    suggestionBox.classList.remove('hidden');
}

export function selectExerciseSuggestion(name) {
    const input = document.getElementById('exercise');
    if (input) {
        input.value = name;
        // 선택 후 이름 수정 불가 — 사람마다 같은 운동을 다르게 적어 데이터가 안 쌓이는 문제 방지
        input.readOnly = true;
        input.classList.add('bg-gray-100', 'cursor-not-allowed');
        const clearBtn = document.getElementById('exerciseClearBtn');
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (window.autoSaveFormData) window.autoSaveFormData();
    }

    const suggestionBox = document.getElementById('exerciseSuggestions');
    if (suggestionBox) suggestionBox.classList.add('hidden');

    // 저장된 메모 인라인 표시
    if (window.renderExerciseMemo) window.renderExerciseMemo();

    // 이전 기록 불러오기 confirm
    if (window.loadPreviousRecord) window.loadPreviousRecord(name);
}

// 개인 운동 직접 추가 — 공용 목록에 없는 종목을 본인 종목으로 등록해 선택
export function selectCustomExercise(rawName) {
    const name = (rawName || '').trim().replace(/['"\\<>]/g, '');
    if (!name) return;
    rememberCustomExercise(name);
    selectExerciseSuggestion(name); // 잠금·이전기록 등 선택 흐름 그대로 재사용
}

// 선택 잠금 해제 — 다시 검색할 수 있게 입력칸 비우고 풀어줌
export function clearExerciseSelection() {
    const input = document.getElementById('exercise');
    if (input) {
        input.value = '';
        input.readOnly = false;
        input.classList.remove('bg-gray-100', 'cursor-not-allowed');
        input.focus();
    }
    const clearBtn = document.getElementById('exerciseClearBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    if (window.renderExerciseMemo) window.renderExerciseMemo();
    if (window.autoSaveFormData) window.autoSaveFormData();
}

// 공용 종목 또는 내 개인 종목이면 허용. 목록 로드 실패(캐시 비어있음) 시엔 막지 않음(완전 잠금 방지)
export function isRegisteredExercise(name) {
    return exercisesCache.length === 0 || exercisesCache.includes(name) || myCustomExercisesCache.includes(name);
}

// 개인 전용(커스텀) 종목인지 — 기록 저장 시 custom 플래그용. 목록 미로드 시 판단 보류(false)
export function isCustomExercise(name) {
    if (exercisesCache.length === 0) return false;
    return !exercisesCache.includes(name);
}

// Close suggestions on click outside
document.addEventListener('click', function (e) {
    const suggestionBox = document.getElementById('exerciseSuggestions');
    const input = document.getElementById('exercise');

    if (suggestionBox && !suggestionBox.classList.contains('hidden')) {
        if (!suggestionBox.contains(e.target) && e.target !== input) {
            suggestionBox.classList.add('hidden');
        }
    }

    // 등록 종목 목록 삭제 버튼(위임)
    const delBtn = e.target.closest('[data-delid]');
    if (delBtn) {
        deleteExercise(delBtn.dataset.delid, delBtn.dataset.delname);
        return;
    }

    // 코치 종목 추가 드롭다운: 항목 클릭 시 채우기(위임), 바깥 클릭 시 닫기
    const newBox = document.getElementById('newExerciseSuggestions');
    const newInput = document.getElementById('newExerciseInput');
    if (newBox && !newBox.classList.contains('hidden')) {
        const item = e.target.closest('[data-newexercise]');
        if (item && newBox.contains(item)) {
            fillNewExercise(item.dataset.newexercise);
        } else if (!newBox.contains(e.target) && e.target !== newInput) {
            newBox.classList.add('hidden');
        }
    }
});

// UI Controls
export function openAdminModal() {
    const modal = document.getElementById('adminModal');
    if (modal) {
        modal.classList.add('active');
        loadExercisesList();
    }
}

export function closeAdminModal() {
    const modal = document.getElementById('adminModal');
    if (modal) modal.classList.remove('active');
}
