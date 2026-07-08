import { state } from './state.js';
import { formatDate, getStudentColor, getStudentBadgeColor, getStudentTextColor, loadSavedLogin, getKoreanInitial } from './utils.js';

// ============================================
// 화면 렌더링 함수들 (HTML String Generation)
// ============================================

export function renderLoginScreen() {
    const saved = loadSavedLogin();

    return `
        <div class="flex items-center justify-center min-h-screen p-4">
            <div class="bg-white rounded-2xl border border-[#EFEFF0] p-8 w-full max-w-md">
                <div class="text-center mb-8">
                    <h1 class="text-3xl font-bold text-gray-800 mb-2">💪 실전 훈련일지</h1>
                    <p class="text-gray-600">이름과 비밀번호를 입력하세요</p>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이름</label>
                        <input 
                            type="text" 
                            id="nameInput" 
                            placeholder="이름 입력"
                            value="${saved ? saved.name : ''}"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#329BE7] text-lg"
                        >
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">비밀번호</label>
                        <input 
                            type="password" 
                            id="passwordInput" 
                            placeholder="비밀번호 입력"
                            value="${saved ? saved.password : ''}"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#329BE7] text-lg"
                            onkeypress="if(event.key === 'Enter') login()"
                        >
                        <p class="text-xs text-gray-500 mt-2">* 처음 입력한 비밀번호가 자동 등록됩니다</p>
                    </div>
                    
                    <div class="flex items-center">
                        <input type="checkbox" id="rememberMe" ${saved ? 'checked' : ''} class="mr-2">
                        <label for="rememberMe" class="text-sm text-gray-700">아이디/비밀번호 기억하기</label>
                    </div>
                    
                    <button 
                        onclick="login()"
                        class="w-full bg-[#329BE7] hover:bg-[#327AB8] text-white font-bold py-3 rounded-lg transition duration-200"
                    >
                        입장하기
                    </button>
                </div>
            </div>
        </div>
    `;
}

export function renderStudentScreen() {
    return `
        <div class="max-w-2xl mx-auto p-4 pb-20">
            <!-- 헤더 -->
            <div class="bg-white rounded-lg border border-[#EFEFF0] p-4 mb-4 flex justify-between items-center">
                <div>
                    <h2 class="text-xl font-bold text-gray-800">${state.currentUser}님의 훈련일지</h2>
                    <p class="text-sm text-gray-600">오늘도 화이팅! 💪</p>
                </div>
                <div class="flex flex-col gap-2 shrink-0">
                    <button onclick="openMemoArchiveModal()"
                            class="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap">
                        📦 메모 보관함
                    </button>
                    <button onclick="openOneRMModal()"
                            class="bg-[#329BE7] hover:bg-[#327AB8] text-white px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap">
                        🧮 1RM 계산기
                    </button>
                </div>
            </div>

            <!-- 이번 달 도장 -->
            <div id="myStampContainer"></div>

            <!-- 달력 -->
            <div class="bg-white rounded-lg border border-[#EFEFF0] p-4 mb-4">
                <h3 class="text-lg font-bold mb-3 text-gray-800">📅 출석 캘린더</h3>
                <div class="mb-2 text-xs text-gray-600">
                    <span class="inline-block w-4 h-4 bg-[#329BE7] rounded mr-1"></span> 운동한 날
                    <span class="inline-block w-4 h-4 bg-red-600 rounded mr-1 ml-3"></span> 피드백 받은 날
                </div>
                <div id="calendar"></div>
            </div>

            <!-- 운동 기록 입력 폼 -->
            <div class="bg-white rounded-lg border border-[#EFEFF0] p-6 mb-4">
                <h3 class="text-lg font-bold mb-4 text-gray-800">🏋️ ${formatDate(state.selectedDate)} 운동 기록</h3>
                <div class="space-y-3">
                    <div class="relative">
                        <input type="text" id="exercise" placeholder="운동 종목 검색 후 선택 (예: 벤치프레스)"
                               autocomplete="off"
                               oninput="autoSaveFormData(); handleExerciseSearch(this.value); renderExerciseMemo();"
                               onfocus="handleExerciseSearch(this.value); renderExerciseMemo();"
                               class="w-full px-4 py-3 pr-10 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7] text-gray-800 font-medium">
                        <button type="button" id="exerciseClearBtn" onclick="clearExerciseSelection()"
                                class="hidden absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>

                        <!-- Custom Autocomplete Dropdown -->
                        <div id="exerciseSuggestions" 
                             class="hidden absolute top-full left-0 right-0 mt-1 bg-white border border-[#EFEFF0] rounded-lg z-50 max-h-60 overflow-y-auto">
                        </div>
                    </div>

                    <!-- 선택한 종목의 저장된 메모 — 이름 바로 아래(이전 메모 불러올 때 스크롤 없이 보이게) -->
                    <div id="exerciseMemoCard"></div>

                    <textarea id="memo" placeholder="운동 메모 (여기에 입력하면 자동으로 고정됩니다)" rows="2"
                              oninput="autoSaveFormData()"
                              class="w-full px-4 py-2 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7]"></textarea>

                    <!-- 세트별 입력 (세트 수 드롭다운은 setsContainer 상단에서 렌더) -->
                    <div id="setsContainer"></div>

                    <!-- 통증 체크박스 -->
                    <div class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg">
                        <input type="checkbox" id="painCheck" class="w-5 h-5">
                        <label for="painCheck" class="text-sm font-semibold text-red-700">⚠️ 운동 중 통증이 있었습니다</label>
                    </div>
                    
                    <button id="addRecordBtn" onclick="addRecord()"
                            class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed">
                        ✅ 운동 완료!
                    </button>
                </div>
            </div>

            <!-- 선택한 날짜 기록 리스트 -->
            <div class="bg-white rounded-lg border border-[#EFEFF0] p-6">
                <h3 class="text-lg font-bold mb-4 text-gray-800">📝 ${formatDate(state.selectedDate)} 기록</h3>
                <div id="recordsList"></div>
            </div>

            <!-- 1RM 계산기 모달 -->
            <div id="onermModal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                 onclick="if(event.target===this)closeOneRMModal()">
                <div class="bg-white rounded-lg p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-1">
                        <h3 class="text-lg font-bold text-gray-800">🧮 1RM 계산기</h3>
                        <button onclick="closeOneRMModal()" class="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
                    </div>
                    <p class="text-xs text-gray-500 mb-4">방금 든 무게·횟수로 예상 최대중량(1RM)을 계산해요. 1~10회에서 정확합니다.</p>
                    <div class="space-y-3 mb-4">
                        <div>
                            <label class="text-xs text-gray-600 mb-1 block">종목</label>
                            <input type="text" id="onermExercise" list="onermExerciseList" placeholder="예: 벤치프레스"
                                   class="w-full px-4 py-3 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7]">
                            <datalist id="onermExerciseList"></datalist>
                        </div>
                        <div>
                            <label class="text-xs text-gray-600 mb-1 block">무게 (kg)</label>
                            <input type="number" inputmode="decimal" id="onermWeight" placeholder="100" oninput="calcOneRM()"
                                   class="w-full px-4 py-3 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7]">
                        </div>
                        <div>
                            <label class="text-xs text-gray-600 mb-1 block">횟수 (회)</label>
                            <input type="number" inputmode="numeric" id="onermReps" placeholder="5" oninput="calcOneRM()"
                                   class="w-full px-4 py-3 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7]">
                        </div>
                    </div>
                    <div id="onermResult">
                        <p class="text-sm text-gray-500 text-center py-2">무게(kg)와 횟수를 입력하세요</p>
                    </div>
                    <button onclick="saveOneRM()" type="button"
                            class="w-full mt-3 bg-[#329BE7] hover:bg-[#327AB8] text-white font-semibold py-3 rounded-lg transition">
                        💾 이 값 저장
                    </button>
                    <p id="onermSaveStatus" class="text-xs text-center text-gray-500 mt-2 min-h-[1rem]"></p>

                    <div class="mt-3 pt-4 border-t border-[#EFEFF0]">
                        <h4 class="text-sm font-bold text-gray-700 mb-2">📌 내 1RM</h4>
                        <div id="onermMyList"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderCoachScreen() {
    if (!state.isCoach) return '';
    return `
        <div class="max-w-6xl mx-auto p-4">
            <!-- 헤더 -->
            <div class="bg-[#329BE7] rounded-lg p-6 mb-6 text-white">
                <div class="flex justify-between items-center">
                    <div>
                        <h2 class="text-2xl font-bold">👨‍🏫 코치 대시보드</h2>
                        <p class="text-white/80 mt-1">전체 수강생 훈련 현황</p>
                    </div>
                    <div class="flex gap-2">
                    </div>
                </div>
            </div>

            <!-- 어드민 메뉴 (운동 관리) -->
            <div class="mb-4 text-right flex justify-end gap-2">
                <button onclick="openStampModal()" class="bg-[#E94E58] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition flex items-center inline-flex gap-2">
                    📋 이달의 도장
                </button>
                <button onclick="openAdminModal()" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900 transition flex items-center inline-flex gap-2">
                    ⚙️ 운동 종목 관리
                </button>
            </div>

            <!-- 수강생 선택 (아코디언) -->
            <div class="bg-white rounded-lg border border-[#EFEFF0] mb-4">
                <button onclick="toggleStudentList()" class="w-full p-4 text-left flex items-center justify-between hover:bg-gray-50 transition rounded-lg">
                    <div>
                        <h3 class="text-sm font-semibold text-gray-700">👥 수강생 선택</h3>
                        <p class="text-xs text-gray-500 mt-1" id="studentSelectionSummary">수강생 목록 로딩 중...</p>
                    </div>
                    <span id="studentListIcon" class="text-xl text-gray-600">▼</span>
                </button>
                <div id="studentListContainer" class="hidden p-4 pt-0 border-t border-gray-200">
                    <div id="studentList" class="flex flex-wrap gap-2">
                        <div class="text-gray-500 text-sm">수강생 목록 로딩 중...</div>
                    </div>
                </div>
            </div>

            <!-- 선택된 수강생 빠른 이동 바 (sticky) -->
            <div id="studentQuickNav" class="student-quick-nav" style="display: none;"></div>

            <!-- 코치 고정 메모 현황 (선택한 수강생만) -->
            <div id="coachPinnedMemosSection" class="mb-4"></div>

            <!-- 코치 '바로 전 수업' 세션 뷰 (수강생 선택 시 학생별 블록으로 렌더) -->
            <div id="allRecordsList"></div>
            
            <!-- 고정 메모 관리 (레거시/고급) -->
            <div class="mt-6">
                <button onclick="toggleAdminPanel()" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold text-sm transition flex items-center justify-between px-4">
                    <span>🛠️ 기타 관리 (고정 메모 마이그레이션 등)</span>
                    <span id="adminPanelIcon">▼</span>
                </button>
                <div id="adminPanel" class="hidden mt-2 bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
                    <p class="text-xs text-yellow-700 mb-3">수강생들의 고정 메모를 관리합니다.</p>
                    <div class="space-y-2">
                        <button onclick="migrateAllStudentsPinnedMemos()" class="w-full bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded-lg font-semibold text-sm">
                            🔄 localStorage → Firestore 마이그레이션
                        </button>
                        <button onclick="viewAllPinnedMemos()" class="w-full bg-[#329BE7] hover:bg-[#327AB8] text-white py-2 rounded-lg font-semibold text-sm">
                            👁️ 전체 고정 메모 보기
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderAdminModalHTML() {
    return `
        <div id="adminModal" class="modal">
            <div class="modal-content max-w-lg w-full">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold text-gray-800">⚙️ 운동 종목 관리</h2>
                    <button onclick="closeAdminModal()" class="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>

                <div class="mb-4 flex gap-2">
                    <div class="relative flex-1">
                        <input type="text" id="newExerciseInput" placeholder="새 운동 이름 입력" autocomplete="off"
                               class="w-full px-3 py-2 border border-[#EFEFF0] rounded-lg focus:outline-none focus:border-[#329BE7]"
                               oninput="handleNewExerciseSearch(this.value)"
                               onkeypress="if(event.key === 'Enter') addExercise()">
                        <div id="newExerciseSuggestions" class="hidden absolute z-10 left-0 right-0 mt-1 bg-white border border-[#EFEFF0] rounded-lg shadow-lg max-h-60 overflow-y-auto"></div>
                    </div>
                    <button onclick="addExercise()" class="bg-[#329BE7] hover:bg-[#327AB8] text-white px-4 py-2 rounded-lg font-bold">
                        추가
                    </button>
                </div>

                <div class="mb-2 text-sm text-gray-600 font-semibold">등록된 운동 목록</div>
                <div id="adminExerciseList" class="max-h-96 overflow-y-auto border rounded-lg p-2 bg-gray-50">
                    <!-- Javascript 로딩 -->
                </div>
            </div>
        </div>
    `;
}

export function renderStampModalHTML() {
    return `
        <div id="stampModal" class="modal">
            <div class="modal-content max-w-2xl w-full">
                <div class="flex justify-between items-center mb-1">
                    <h2 class="text-xl font-bold text-gray-800">📋 ${(() => { const n = new Date(); return `${n.getMonth() + 1}월의 도장`; })()}</h2>
                    <button onclick="closeStampModal()" class="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>
                <p id="stampModalSubtitle" class="text-xs text-gray-500 mb-3"></p>
                <div id="stampModalBody" class="max-h-[60vh] overflow-y-auto"></div>
                <button id="stampConfirmBtn" onclick="confirmAllStamps()"
                        class="mt-4 w-full bg-[#E94E58] hover:opacity-90 text-white py-3 rounded-lg font-bold">
                    전체 확정
                </button>
            </div>
        </div>`;
}

// 편집 모달 렌더링
export function renderEditModalContent(data, docId) {
    // 메모는 record가 아닌 종목별 고정 메모(pinnedExercises)에 저장됨 → 편집 시 그 종목 메모를 채운다.
    const pinnedMemo = (state.pinnedExercises || []).find(p => p.exercise === data.exercise)?.memo || '';
    return `
        <div class="space-y-3">
            <div>
                <label class="block text-sm font-semibold mb-1">날짜 변경</label>
                <input type="date" id="edit-date" value="${data.date}" 
                       class="w-full px-3 py-2 border rounded-lg mb-2">
            </div>
            <div>
                <label class="block text-sm font-semibold mb-1">운동 종목 <span class="text-xs font-normal text-gray-400">(변경 불가)</span></label>
                <input type="text" id="edit-exercise" value="${esc(data.exercise)}" readonly
                       class="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed">
            </div>

            <div>
                <label class="block text-sm font-semibold mb-1">메모</label>
                <textarea id="edit-memo" rows="2" class="w-full px-3 py-2 border rounded-lg">${esc(data.memo || pinnedMemo)}</textarea>
            </div>

            <div>
                <label class="block text-sm font-semibold mb-2">세트별 기록</label>
                <div id="editSetsContainer"></div>
            </div>

            <div class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg">
                <input type="checkbox" id="edit-pain" ${data.pain ? 'checked' : ''} class="w-5 h-5">
                <label for="edit-pain" class="text-sm font-semibold text-red-700">⚠️ 통증 있음</label>
            </div>

            <div class="flex gap-2">
                <button onclick="saveEdit('${docId}')" type="button"
                        class="flex-1 bg-[#329BE7] hover:bg-[#327AB8] text-white py-2 rounded-lg font-semibold">
                    저장
                </button>
                <button onclick="closeEditModal()" type="button"
                        class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded-lg font-semibold">
                    취소
                </button>
            </div>
        </div>
    `;
}

// 운동 기록 폼 인라인 표시용 — filterExercise 종목의 저장된 메모만 렌더.
// renderExerciseMemo가 항상 종목명을 넘기므로 단일 종목 카드만 그린다.
// HTML 텍스트는 esc(), onclick 인자(작은따옴표 JS 문자열)는 jsArg()로 이스케이프 — 저장된 메모/코멘트로 인한 XSS 방지.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsArg = s => String(s ?? '')
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function generatePinnedMemosHTML(coachPinnedMemos, studentPinnedMemos, filterExercise = null) {
    const coachList = (coachPinnedMemos || []).filter(m => m.exercise === filterExercise);
    const idx = studentPinnedMemos.findIndex(p => p.exercise === filterExercise);
    const pinned = idx !== -1 ? studentPinnedMemos[idx] : null;

    if (coachList.length === 0 && !pinned) return '';

    let html = '<div class="space-y-6">';

    // 1. 코치 운동 메모
    if (coachList.length > 0) {
        html += `
            <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-yellow-800 flex items-center gap-2">
                        <span>👨‍🏫 코치 운동 메모</span>
                    </h3>
                </div>
                <div class="space-y-4">
                     ${coachList.map(memo => `
                        <div class="bg-white rounded-lg p-4 border border-yellow-200 relative group">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="text-base font-bold text-gray-800">${esc(memo.exercise)}</span>
                                    <span class="text-xs text-gray-400 ml-2">${new Date(memo.createdAt || Date.now()).toLocaleDateString()}</span>
                                </div>
                                <button onclick="deleteCoachMessage('${jsArg(memo.id || '')}')" class="text-red-500 hover:bg-red-50 p-1 rounded transition text-xs font-bold border border-red-200">
                                    삭제
                                </button>
                            </div>
                            <div class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-yellow-50 p-3 rounded border border-yellow-100">${esc(memo.memo)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // 2. 수강생 메모 (단일 종목) — 버튼은 헤더줄, 메모는 전체 폭
    if (pinned) {
        const isHighlighted = pinned.highlighted === true;
        const starBtn = isHighlighted
            ? `<button onclick="toggleStudentMemoHighlight(${idx})" class="text-yellow-400 hover:text-yellow-500 text-lg leading-none" title="중요 해제">★</button>`
            : `<button onclick="toggleStudentMemoHighlight(${idx})" class="text-gray-300 hover:text-yellow-400 text-lg leading-none" title="중요 표시">☆</button>`;
        html += `
            <div class="bg-[#329BE71A] border-2 border-[#329BE7] rounded-lg p-4">
                <div class="flex items-center justify-between mb-3 gap-2">
                    <h3 class="text-sm font-bold text-[#327AB8] whitespace-nowrap">📌 운동 메모</h3>
                    <div class="flex gap-1 flex-shrink-0">
                        <button onclick="editStudentMemo('${jsArg(pinned.exercise)}', '${jsArg(pinned.memo)}')" class="text-xs px-2 py-1 bg-[#329BE71A] text-[#327AB8] rounded hover:bg-[#329BE7]/20 transition">수정</button>
                        <button onclick="archiveWorkoutMemo(${idx})" class="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition">보관</button>
                        <button onclick="removePinnedExercise(${idx});" class="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 transition">삭제</button>
                    </div>
                </div>
                <div class="bg-white rounded-lg p-4 ${isHighlighted ? 'border-yellow-400 bg-yellow-50 ring-1 ring-yellow-200' : 'border border-[#EFEFF0]'}">
                    <div class="flex items-center gap-2 mb-1">
                        ${starBtn}
                        <div class="text-base font-bold text-gray-800">${esc(pinned.exercise)}</div>
                        ${pinned.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">⚠️ 통증</span>' : ''}
                        ${isHighlighted ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-semibold">중요</span>' : ''}
                    </div>
                    ${pinned.memo ? `<div class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">${esc(pinned.memo)}</div>` : '<div class="text-sm text-gray-400 italic">메모 없음</div>'}
                    ${pinned.coachComment && pinned.coachComment.trim() !== '' ? `
                        <div class="mt-3 bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded-r-md group relative">
                            <div class="flex items-center justify-between mb-1">
                                <span class="text-xs font-bold text-yellow-800 bg-yellow-200 px-2 py-0.5 rounded">👨‍🏫 코치 코멘트</span>
                                <button onclick="removeCoachComment('${jsArg(pinned.exercise)}')" class="text-xs text-red-400 hover:text-red-600 font-bold px-2 py-1 opacity-50 group-hover:opacity-100 transition">삭제</button>
                            </div>
                            <div class="text-sm text-yellow-900 whitespace-pre-wrap font-medium">${esc(pinned.coachComment)}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

