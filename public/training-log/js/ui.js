import { state } from './state.js';
import { formatDate, getStudentColor, getStudentBadgeColor, getStudentTextColor, loadSavedLogin, getKoreanInitial } from './utils.js';

// ============================================
// 화면 렌더링 함수들 (HTML String Generation)
// ============================================

export function renderLoginScreen() {
    const saved = loadSavedLogin();

    return `
        <div class="flex items-center justify-center min-h-screen p-4">
            <div class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
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
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-lg"
                        >
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">비밀번호</label>
                        <input 
                            type="password" 
                            id="passwordInput" 
                            placeholder="비밀번호 입력"
                            value="${saved ? saved.password : ''}"
                            class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-lg"
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
                        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition duration-200"
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
            <div class="bg-white rounded-lg shadow-md p-4 mb-4 flex justify-between items-center">
                <div>
                    <h2 class="text-xl font-bold text-gray-800">${state.currentUser}님의 훈련일지</h2>
                    <p class="text-sm text-gray-600">오늘도 화이팅! 💪</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="navigateToTimetable()" class="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                        ← 시간표
                    </button>
                    <button onclick="logout()" class="text-red-600 hover:text-red-800 font-semibold">
                        로그아웃
                    </button>
                </div>
            </div>

            <!-- 고정된 메모 목록 (캘린더 바로 위) -->
            <div id="pinnedMemosContainer"></div>
            
            <!-- 달력 -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-4">
                <h3 class="text-lg font-bold mb-3 text-gray-800">📅 출석 캘린더</h3>
                <div class="mb-2 text-xs text-gray-600">
                    <span class="inline-block w-4 h-4 bg-gradient-to-r from-purple-500 to-purple-700 rounded mr-1"></span> 운동한 날
                    <span class="inline-block w-4 h-4 bg-gradient-to-r from-red-500 to-red-700 rounded mr-1 ml-3"></span> 피드백 받은 날
                </div>
                <div id="calendar"></div>
            </div>

            <!-- 운동 기록 입력 폼 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-4">
                <h3 class="text-lg font-bold mb-4 text-gray-800">🏋️ ${formatDate(state.selectedDate)} 운동 기록</h3>
                <div class="space-y-3">
                    <div class="relative">
                        <input type="text" id="exercise" placeholder="운동 종목 (예: 벤치프레스)" 
                               autocomplete="off"
                               oninput="autoSaveFormData(); handleExerciseSearch(this.value);"
                               onfocus="handleExerciseSearch(this.value)"
                               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-800 font-medium">
                        
                        <!-- Custom Autocomplete Dropdown -->
                        <div id="exerciseSuggestions" 
                             class="hidden absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                        </div>
                    </div>
                    
                    <!-- 세트별 입력 -->
                    <div id="setsContainer"></div>
                    
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="addSet()" class="bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded-lg">
                            + 세트 추가
                        </button>
                        <button onclick="addSameSet()" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg">
                            ↻ 같은 세트 추가
                        </button>
                    </div>
                    
                    <!-- 통증 체크박스 -->
                    <div class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg">
                        <input type="checkbox" id="painCheck" class="w-5 h-5">
                        <label for="painCheck" class="text-sm font-semibold text-red-700">⚠️ 운동 중 통증이 있었습니다</label>
                    </div>
                    
                    <!-- 메모 고정 버튼 제거됨 (자동 저장) -->
                    
                    <textarea id="memo" placeholder="운동 메모 (여기에 입력하면 자동으로 고정됩니다)" rows="2"
                              oninput="autoSaveFormData()"
                              class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:border-blue-500"></textarea>
                    
                    <button onclick="addRecord()" 
                            class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition">
                        ✅ 운동 완료!
                    </button>
                </div>
            </div>

            <!-- 선택한 날짜 기록 리스트 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h3 class="text-lg font-bold mb-4 text-gray-800">📝 ${formatDate(state.selectedDate)} 기록</h3>
                <div id="recordsList"></div>
            </div>
        </div>
    `;
}

export function renderCoachScreen() {
    if (!state.isCoach) return '';
    return `
        <div class="max-w-6xl mx-auto p-4">
            <!-- 헤더 -->
            <div class="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg shadow-lg p-6 mb-6 text-white">
                <div class="flex justify-between items-center">
                    <div>
                        <h2 class="text-2xl font-bold">👨‍🏫 코치 대시보드</h2>
                        <p class="text-purple-100 mt-1">전체 수강생 훈련 현황</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="navigateToTimetable()" class="bg-white text-blue-600 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-blue-50 transition flex items-center gap-1">
                            ← 시간표
                        </button>
                        <button onclick="logout()" class="bg-white text-purple-600 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-purple-50 transition">
                            로그아웃
                        </button>
                    </div>
                </div>
            </div>

            <!-- 어드민 메뉴 (운동 관리) -->
            <div class="mb-4 text-right flex justify-end gap-2">
                <button onclick="openAdminModal()" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900 transition flex items-center inline-flex gap-2">
                    ⚙️ 운동 종목 관리
                </button>
            </div>

            <!-- 수강생 선택 (아코디언) -->
            <div class="bg-white rounded-lg shadow-md mb-4">
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
            
            <!-- 날짜 필터 & 통증 필터 -->
            <div class="bg-white rounded-lg shadow-md p-4 mb-6">
                <div class="mb-4">
                    <label class="block text-sm font-semibold text-gray-700 mb-2">기록 조회 날짜</label>
                    <input 
                        type="date" 
                        id="coachDateFilter" 
                        value=""
                        onchange="changeCoachDate(this.value)"
                        class="px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                    <button onclick="showAllDates()" class="ml-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                        전체 보기
                    </button>
                </div>
                
                <!-- 필터 옵션 -->
                <div class="space-y-2">
                    <!-- 운동 종목 필터 (Feature 2) -->
                    <div class="mb-3">
                        <select id="coachExerciseFilter" onchange="changeCoachExerciseFilter(this.value)" 
                                style="max-width: 100%;"
                                class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 font-bold text-lg text-gray-700 bg-white">
                            <option value="">🏋️ 운동 종목 선택 (전체 보기)</option>
                            <!-- Javascript 로딩됨 -->
                        </select>
                    </div>

                    <div class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg">
                        <input type="checkbox" id="painFilterCheck" ${state.painFilter ? 'checked' : ''} onchange="togglePainFilter()" class="w-5 h-5">
                        <label for="painFilterCheck" class="text-sm font-semibold text-red-700">⚠️ 통증 있는 기록만 보기</label>
                    </div>
                    

                    
                    <div class="flex items-center space-x-2 p-3 bg-purple-50 rounded-lg">
                        <input type="checkbox" id="pinnedMemoFilterCheck" ${state.pinnedMemoFilter ? 'checked' : ''} onchange="togglePinnedMemoFilter()" class="w-5 h-5">
                        <label for="pinnedMemoFilterCheck" class="text-sm font-semibold text-purple-700">📝 운동 메모만 보기</label>
                    </div>
                    <div class="flex items-center space-x-2 p-3 bg-blue-50 rounded-lg">
                        <input type="checkbox" id="recordsFilterCheck" ${state.recordsFilter ? 'checked' : ''} onchange="toggleRecordsFilter()" class="w-5 h-5">
                        <label for="recordsFilterCheck" class="text-sm font-semibold text-blue-700">📋 운동 기록 보기</label>
                    </div>
                </div>
            </div>

            <!-- 코치 고정 메모 현황 (선택한 수강생만) -->
            <div id="coachPinnedMemosSection" class="mb-4"></div>

            <!-- 전체 기록 카드 (기본 숨김, 운동 기록 보기 체크 시 표시) -->
            <div id="allRecordsList" class="grid gap-4 md:grid-cols-2 lg:grid-cols-3" style="display: ${state.recordsFilter ? 'grid' : 'none'}"></div>
            
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
                        <button onclick="viewAllPinnedMemos()" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold text-sm">
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
                    <input type="text" id="newExerciseInput" placeholder="새 운동 이름 입력" 
                           class="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-blue-500"
                           onkeypress="if(event.key === 'Enter') addExercise()">
                    <button onclick="addExercise()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold">
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

// 편집 모달 렌더링
export function renderEditModalContent(data, docId) {
    return `
        <div class="space-y-3">
            <div>
                <label class="block text-sm font-semibold mb-1">날짜 변경</label>
                <input type="date" id="edit-date" value="${data.date}" 
                       class="w-full px-3 py-2 border rounded-lg mb-2">
            </div>
            <div>
                <label class="block text-sm font-semibold mb-1">운동 종목</label>
                <input type="text" id="edit-exercise" value="${data.exercise}" 
                       class="w-full px-3 py-2 border rounded-lg">
            </div>
            
            <div>
                <label class="block text-sm font-semibold mb-2">세트별 기록</label>
                <div id="editSetsContainer"></div>
                <div class="flex gap-2 mt-2">
                    <button onclick="addEditSet()" type="button" class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded-lg text-sm">
                        + 세트 추가
                    </button>
                    <button onclick="addSameEditSet()" type="button" class="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-sm">
                        ↻ 같은 세트 추가
                    </button>
                </div>
            </div>
            
            <div class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg">
                <input type="checkbox" id="edit-pain" ${data.pain ? 'checked' : ''} class="w-5 h-5">
                <label for="edit-pain" class="text-sm font-semibold text-red-700">⚠️ 통증 있음</label>
            </div>
            

            
            <div>
                <label class="block text-sm font-semibold mb-1">메모</label>
                <textarea id="edit-memo" rows="2" class="w-full px-3 py-2 border rounded-lg">${data.memo || ''}</textarea>
            </div>
            
            <div class="flex gap-2">
                <button onclick="saveEdit('${docId}')" type="button"
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold">
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

export function generatePinnedMemosHTML(coachPinnedMemos, studentPinnedMemos) {
    let html = '<div class="space-y-6">';

    // 1. 코치 고정 메모 렌더링 (최상단)
    if (coachPinnedMemos && coachPinnedMemos.length > 0) {
        html += `
            <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 shadow-sm mb-6">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-yellow-800 flex items-center gap-2">
                        <span>👨‍🏫 코치 운동 메모</span>
                        <span class="bg-yellow-200 text-yellow-800 text-xs px-2 py-0.5 rounded-full">${coachPinnedMemos.length}</span>
                    </h3>
                </div>
                <div class="space-y-4">
                     ${coachPinnedMemos.map(memo => `
                        <div class="bg-white rounded-lg p-4 border border-yellow-200 shadow-sm relative group">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="text-base font-bold text-gray-800">${memo.exercise}</span>
                                    <span class="text-xs text-gray-400 ml-2">${new Date(memo.createdAt || Date.now()).toLocaleDateString()}</span>
                                </div>
                                <button onclick="deleteCoachMessage('${memo.exercise}')" class="text-red-500 hover:bg-red-50 p-1 rounded transition text-xs font-bold border border-red-200">
                                    삭제
                                </button>
                            </div>
                            <div class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-yellow-50 p-3 rounded border border-yellow-100">${memo.memo}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // 2. 수강생 고정 메모
    if (studentPinnedMemos.length > 0) {
        html += `
            <div class="bg-blue-50 border-2 border-blue-400 rounded-lg p-4 shadow-sm">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-blue-800">📌 운동 메모 (${studentPinnedMemos.length}개)</h3>
                </div>
                <div class="space-y-4">
                     ${studentPinnedMemos.map((pinned, idx) => `
                        <div class="bg-white rounded-lg p-4 border border-blue-200 relative">
                            <div class="flex items-start justify-between">
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="text-base font-bold text-gray-800">${pinned.exercise}</div>
                                        ${pinned.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">⚠️ 통증</span>' : ''}
                                    </div>
                                    ${pinned.memo ? `<div class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">${pinned.memo}</div>` : '<div class="text-sm text-gray-400 italic">메모 없음</div>'}
                                </div>
                                
                                <div class="flex flex-col gap-1 ml-2 w-16">
                                     <div class="flex gap-1 mb-1">
                                        <button onclick="movePinnedMemo(${idx}, -1)" class="flex-1 bg-gray-100 hover:bg-gray-200 text-xs py-1 rounded text-center">▲</button>
                                        <button onclick="movePinnedMemo(${idx}, 1)" class="flex-1 bg-gray-100 hover:bg-gray-200 text-xs py-1 rounded text-center">▼</button>
                                     </div>
                                    <button 
                                        onclick="editStudentMemo('${pinned.exercise}', \`${(pinned.memo || '').replace(/`/g, '\\`').replace(/'/g, "\\'")}\`)" 
                                        class="text-xs px-2 py-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition text-center">
                                        수정
                                    </button>
                                    <button 
                                        onclick="removePinnedExercise(${idx});" 
                                        class="text-xs px-2 py-1.5 bg-red-100 text-red-600 rounded hover:bg-red-200 transition text-center">
                                        삭제
                                    </button>
                                </div>
                            </div>

                            ${pinned.coachComment && pinned.coachComment.trim() !== '' ? `
                                <div class="mt-3 bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded-r-md group relative">
                                    <div class="flex items-center justify-between mb-1">
                                        <div class="flex items-center gap-1">
                                            <span class="text-xs font-bold text-yellow-800 bg-yellow-200 px-2 py-0.5 rounded">👨‍🏫 코치 코멘트</span>
                                        </div>
                                        <button onclick="removeCoachComment('${pinned.exercise}')" class="text-xs text-red-400 hover:text-red-600 font-bold px-2 py-1 opacity-50 group-hover:opacity-100 transition">
                                            삭제
                                        </button>
                                    </div>
                                    <div class="text-sm text-yellow-900 whitespace-pre-wrap font-medium">${pinned.coachComment}</div>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

