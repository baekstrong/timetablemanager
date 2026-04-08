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
                    html += `
                        <div class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-200">
                            <span class="text-sm font-medium text-gray-700">${data.name}</span>
                            <button onclick="deleteExercise('${doc.id}', '${data.name}')" class="text-red-500 hover:text-red-700 text-xs px-2 py-1">
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

export async function addExercise() {
    const input = document.getElementById('newExerciseInput');
    const name = input.value.trim();

    if (!name) {
        alert('운동 이름을 입력해주세요.');
        return;
    }

    try {
        // 중복 체크
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
        loadExercisesList();
        alert('✅ 운동이 추가되었습니다.');
    } catch (error) {
        console.error('Error adding exercise:', error);
        alert('추가 실패: ' + error.message);
    }
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
            coachOptions += `<option value="${name}">${name}</option>`;
        });
        coachSelect.innerHTML = coachOptions;
    }
}

// Called on input/focus in the student exercise input
export function handleExerciseSearch(query) {
    const suggestionBox = document.getElementById('exerciseSuggestions');
    if (!suggestionBox) return;

    // Filter Logic
    const filtered = query
        ? exercisesCache.filter(name => name.toLowerCase().includes(query.toLowerCase()))
        : exercisesCache; // Show all if empty query (optional: or show nothing)

    if (filtered.length === 0) {
        suggestionBox.classList.add('hidden');
        return;
    }

    // Render Suggestions
    suggestionBox.innerHTML = filtered.map(name => `
        <div class="px-4 py-3 hover:bg-blue-50 cursor-pointer text-gray-700 font-medium border-b border-gray-100 last:border-0 transition-colors"
             onclick="selectExerciseSuggestion('${name}')">
            ${name}
        </div>
    `).join('');

    suggestionBox.classList.remove('hidden');
}

export function selectExerciseSuggestion(name) {
    const input = document.getElementById('exercise');
    if (input) {
        input.value = name;
        if (window.autoSaveFormData) window.autoSaveFormData();
    }

    const suggestionBox = document.getElementById('exerciseSuggestions');
    if (suggestionBox) suggestionBox.classList.add('hidden');

    // 이전 기록 불러오기 confirm
    if (window.loadPreviousRecord) window.loadPreviousRecord(name);
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
