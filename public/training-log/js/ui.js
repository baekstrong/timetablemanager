import { state } from './state.js';
import { localDate, escapeHTML } from './modules/student-workspace-logic.js?v=20260925-student-ux';
import { formatDate, loadSavedLogin } from './utils.js';

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
                    ${state.authRestoreError ? `<div role="alert"><p class="text-sm text-gray-600">${escapeHTML(state.authRestoreError)}</p><button type="button" id="retrySavedLogin" onclick="autoLogin()" class="w-full bg-gray-100 text-gray-800 py-3 rounded-lg">저장된 로그인 다시 확인</button></div>` : ''}
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
        <div class="student-workspace max-w-2xl mx-auto p-4 pb-20">
            <header class="student-workspace-header">
                <h2>훈련일지</h2>
                <div class="student-header-tools"><button type="button" onclick="openOneRMModal()">1RM 계산기</button></div>
            </header>
            <div id="myStampContainer"></div>
            <!-- 2026-10-23: 달력 → 입력칸 → 기록 내역을 한 화면에 (화면 전환 없음). 달력에서 고른 날짜가 작성일. -->
            <section id="studentCalendarView">
                <section class="student-calendar-card" aria-label="월간 운동 기록"><div id="calendar"><p class="student-help" role="status">운동 기록 확인 중…</p></div></section>
                <div id="studentDraftList"></div>
            </section>
            <section id="studentWriteView">
                <input type="hidden" id="studentWriteDate" value="${localDate()}">
                <div class="student-record-form">
                    <h3 id="recordFormTitle">운동 기록 남기기</h3>
                    <p id="studentDraftStatus" class="student-help" role="status"></p>
                    <div class="relative student-exercise-search">
                        <label for="exercise">운동 종목</label>
                        <input type="text" id="exercise" placeholder="운동 이름을 검색하세요" autocomplete="off" aria-controls="exerciseSuggestions" aria-expanded="false"
                            oninput="autoSaveFormData(); handleExerciseSearch(this.value); renderExerciseMemo();" onfocus="handleExerciseSearch(this.value); renderExerciseMemo();"
                            onkeydown="handleExerciseSearchKeydown(event)">
                        <button type="button" id="exerciseClearBtn" onclick="clearExerciseSelection()" aria-label="다른 운동 검색" class="hidden">✕</button>
                        <div id="exerciseSuggestions" class="hidden" aria-label="운동 검색 결과" onkeydown="handleExerciseSuggestionKeydown(event)"></div>
                    </div>
                    <div id="oneRMQuickCard"></div><div id="exerciseMemoCard"></div>
                    <div id="studentReference"></div>
                    <div id="setsContainer"></div>
                    <details class="student-form-details"><summary>메모·통증 남기기</summary><label for="memo">운동 메모</label><textarea id="memo" placeholder="기록 저장 시 이 종목 메모에 한 줄 추가돼요" rows="2" oninput="autoSaveFormData()"></textarea><label class="student-pain-label"><input type="checkbox" id="painCheck" onchange="autoSaveFormData()"> 운동 중 통증이 있었습니다</label></details>
                    <button id="addRecordBtn" onclick="addRecord()" class="student-main-button">기록 저장</button>
                    <div id="studentRecordSaved" class="student-saved-notice" hidden><p role="status"></p><button type="button" onclick="document.getElementById('exercise').focus()">다른 운동 기록</button></div>
                </div>
            </section>
            <section class="student-records-card">
                <h3 id="recordsListTitle">${formatDate(state.selectedDate)} 기록</h3>
                <div id="recordsList"></div>
            </section>

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

            <!-- 지금(또는 방금 끝난) 수업 교시 + 명단 새로고침 -->
            <div id="classSlotBanner" class="mb-4"></div>

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

            <!-- 코치 전용 비공개 메모 (선택한 수강생마다 항상 상단 노출) -->
            <div id="coachPrivateNotesSection" class="mb-4"></div>

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
    // 메모는 record가 아닌 종목별 고정 메모(pinnedExercises)에 저장됨.
    // 입력 폼과 동일하게 [카드(수정/보관/삭제) + 새 메모 textarea] 구성으로 렌더한다.
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
                <div id="editExerciseMemoCard">${generatePinnedMemosHTML(state.coachPinnedMemos, state.pinnedExercises, data.exercise)}</div>
                <textarea id="edit-memo" rows="2" placeholder="운동 메모 (여기에 입력하면 자동으로 고정됩니다)"
                          class="w-full px-3 py-2 border rounded-lg mt-2"></textarea>
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
                <button onclick="closeEditModal()" type="button"
                        class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 py-2 rounded-lg font-semibold">
                    취소
                </button>
                <button onclick="saveEdit('${docId}')" type="button"
                        class="flex-1 bg-[#329BE7] hover:bg-[#327AB8] text-white py-2 rounded-lg font-semibold">
                    저장
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

// 내 운동 메모 체크리스트 (2026-10-23): 종목별 메모 한 덩어리 → items:[{text, at(ISO)}].
// memo 필드는 남은 항목을 줄바꿈으로 이어 계속 저장한다 — 코치 화면·기록 카드·구버전 모듈이 그대로 읽는다.
// items가 없는 예전 메모는 통째로 한 항목(날짜 없음)으로 본다.
export const memoItems = p => Array.isArray(p?.items) ? p.items : p?.memo ? [{ text: p.memo, at: '' }] : [];
export const memoText = items => items.map(i => i.text).join('\n');
// 기록 카드의 메모 박스 — 항목마다 점(•) + 오른쪽 작은 월/일. 예전 기록 자체 메모(fallback)는 한 항목으로.
// coach.js에 같은 모양의 사본이 있다(모듈 간 새 import를 만들지 않으려고).
export function memoListHTML(pinned, fallbackMemo = '') {
    const items = memoItems(pinned).length ? memoItems(pinned) : fallbackMemo ? [{ text: fallbackMemo, at: '' }] : [];
    if (!items.length) return '';
    const md = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
    return `<ul class="mt-2 mb-2 bg-[#F7F7F8] border-l-4 border-[#329BE7] rounded px-3 py-1.5">${items.map(item => `
        <li class="flex items-start gap-2 py-1 text-sm text-gray-800 leading-relaxed">
            <span class="text-[#329BE7] shrink-0">•</span>
            <span class="flex-1 min-w-0" style="white-space: pre-wrap;">${esc(item.text)}</span>
            ${item.at ? `<span class="text-[11px] text-gray-400 shrink-0 pt-0.5">${md(item.at)}</span>` : ''}
        </li>`).join('')}</ul>`;
}

export function generatePinnedMemosHTML(coachPinnedMemos, studentPinnedMemos, filterExercise = null) {
    const coachAll = (coachPinnedMemos || []).filter(m => m.exercise === filterExercise);
    // 2026-10-28: 실수로 체크해도 되돌릴 수 있게, 오늘 체크한 항목은 줄 그은 채 남기고 다시 누르면 취소. 다음 날부터 숨긴다.
    const today = new Date().toDateString();
    const coachList = coachAll.filter(m => !m.done || new Date(m.doneAt).toDateString() === today);
    const doneCount = coachAll.length - coachList.length;
    const leftCount = coachList.filter(m => !m.done).length;
    const idx = studentPinnedMemos.findIndex(p => p.exercise === filterExercise);
    const pinned = idx !== -1 ? studentPinnedMemos[idx] : null;

    // 메모 한 줄 추가 칸 — 메모가 아직 없는 종목에도 보여서 바로 쌓을 수 있게 한다.
    const addRow = filterExercise ? `
        <div class="flex gap-1.5 mt-2">
            <input type="text" data-exercise="${esc(filterExercise)}" placeholder="메모 한 줄 추가" maxlength="200"
                class="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-[#329BE74D] rounded-lg bg-white focus:outline-none focus:border-[#329BE7]"
                onkeydown="if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); window.addStudentMemoItemFrom?.(this); }">
            <button type="button" onclick="window.addStudentMemoItemFrom?.(this.previousElementSibling)" class="text-xs px-3 rounded-lg bg-[#329BE7] text-white whitespace-nowrap">추가</button>
        </div>` : '';

    if (coachList.length === 0 && doneCount === 0 && !pinned) return addRow;

    // 2026-10-22 사용자 선택 디자인(목업): 얇은 1px 테두리 + 옅은 틴트 + 12px 라운드, 카드 안 흰 상자·굵은 테두리 없음.
    const md = (iso) => { const d = new Date(iso || Date.now()); return `${d.getMonth() + 1}/${d.getDate()}`; };
    let html = '<div class="space-y-2.5">';

    // 1. 코치 체크리스트 — 수강생이 체크하면 done:true로 남기고 목록에서 사라진다(삭제 아님, 코치 화면엔 완료로 보임).
    // completeCoachMemo는 같은 배포의 records.js에 있다. 한쪽만 캐시 갱신된 조합에서도 오류가 나지 않게 존재 확인 후 호출.
    if (coachList.length > 0) {
        html += `
            <div class="bg-[#FAEEDA] border border-[#FAC775] rounded-xl px-3.5 py-3">
                <div class="flex items-center justify-between mb-0.5">
                    <h3 class="text-[13px] font-semibold text-[#854F0B]">✅ 코치 체크리스트</h3>
                    <span class="text-xs text-[#854F0B]">${leftCount}개 남음</span>
                </div>
                ${coachList.map((memo, i) => `
                    <label data-coach-item class="flex items-start gap-2.5 py-2.5 ${i ? 'border-t border-[#FAC775]/60' : ''} cursor-pointer transition-opacity duration-300">
                        <input type="checkbox" ${memo.done ? 'checked' : ''} class="mt-0.5 w-[18px] h-[18px] flex-shrink-0 accent-[#BA7517]"
                            onchange="const f = this.checked ? window.completeCoachMemo : window.undoCoachMemo; if (f) { this.disabled = true; f('${jsArg(memo.id || '')}', ${coachPinnedMemos.indexOf(memo)}); } else this.checked = !this.checked;">
                        <span class="flex-1 min-w-0 ${memo.done ? 'opacity-50' : ''}">
                            <span class="block text-sm text-gray-800 whitespace-pre-wrap leading-relaxed ${memo.done ? 'line-through' : ''}">${esc(memo.memo)}</span>
                            <span class="block text-xs text-gray-500 mt-0.5">${memo.done ? '오늘 완료 · 다시 누르면 취소' : `${md(memo.createdAt)} 코치`}</span>
                        </span>
                    </label>
                `).join('')}
            </div>
        `;
    }
    if (doneCount > 0) {
        html += `<div class="text-xs text-gray-400 pl-1">✓ 완료한 코치 체크리스트 ${doneCount}개는 숨겼어요</div>`;
    }

    // 2. 내 운동 메모 체크리스트 — 체크하면 줄이 그어지고 0.6초 뒤 메모 보관함으로 옮겨진다(삭제 아님).
    // 2026-10-23 사용자 결정: 카드 단위 ☆·보관·삭제 버튼은 뺀다(줄 체크=보관, 줄 수정에서 비우기=삭제로 충분).
    if (pinned) {
        const isHighlighted = pinned.highlighted === true;
        const items = memoItems(pinned);
        html += `
            <div class="bg-[#329BE71A] border ${isHighlighted ? 'border-[#EDBC40]' : 'border-[#329BE74D]'} rounded-xl px-3.5 py-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <h3 class="text-[13px] font-semibold text-[#327AB8] whitespace-nowrap">📌 내 운동 메모</h3>
                        ${items.length ? `<span class="text-xs text-[#327AB8]">${items.length}개</span>` : ''}
                        ${pinned.pain ? '<span class="text-[11px] bg-[#E94E581A] text-[#E94E58] border border-[#E94E584D] px-1.5 py-0.5 rounded-md font-semibold">통증</span>' : ''}
                    </div>
                </div>
                ${items.length ? items.map((item, i) => `
                    <div class="flex items-center gap-2 ${i ? 'border-t border-[#329BE733]' : ''}">
                    <label data-memo-item class="flex flex-1 min-w-0 items-start gap-2.5 py-2 cursor-pointer transition-opacity duration-300">
                        <input type="checkbox" class="mt-0.5 w-[18px] h-[18px] flex-shrink-0 accent-[#329BE7]" aria-label="완료 처리"
                            onchange="if (window.completeStudentMemoItem) { this.disabled = true; this.closest('[data-memo-item]').classList.add('line-through', 'opacity-40'); completeStudentMemoItem('${jsArg(pinned.exercise)}', ${i}); }">
                        <span class="flex-1 min-w-0 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">${esc(item.text)}${item.at ? `<span class="text-[11px] text-gray-400 ml-1.5 whitespace-nowrap">${md(item.at)}</span>` : ''}</span>
                    </label>
                    <button type="button" onclick="window.editStudentMemoItem?.('${jsArg(pinned.exercise)}', ${i})" class="text-xs text-[#327AB8] py-2 flex-shrink-0">수정</button>
                    </div>
                `).join('') : '<div class="text-sm text-gray-400 py-1">메모 없음</div>'}
                ${addRow}
                ${pinned.coachComment && pinned.coachComment.trim() !== '' ? `
                    <div class="mt-2.5 pt-2.5 border-t border-[#329BE74D]">
                        <div class="flex items-center justify-between mb-0.5">
                            <span class="text-xs font-semibold text-[#854F0B]">코치 코멘트</span>
                            <button onclick="removeCoachComment('${jsArg(pinned.exercise)}')" class="text-xs text-gray-400 hover:text-[#E94E58]">삭제</button>
                        </div>
                        <div class="text-sm text-gray-800 whitespace-pre-wrap">${esc(pinned.coachComment)}</div>
                    </div>
                ` : ''}
            </div>
        `;
    } else {
        html += addRow;
    }

    html += '</div>';
    return html;
}

