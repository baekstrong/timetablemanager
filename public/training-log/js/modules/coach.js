import { state, db, firebaseInitialized } from '../state.js';
import { getKoreanInitial, getStudentColor, getStudentBadgeColor, getStudentTextColor, formatDate, debounce } from '../utils.js';

const debouncedLoadAllRecords = debounce(loadAllRecords, 300);
import { normalizeSet } from './sets.js';

// ============================================
// 코치 기능
// ============================================

export async function loadStudentList() {
    const studentListDiv = document.getElementById('studentList');
    if (!studentListDiv) return;

    try {
        // users 컬렉션에서 수강생 목록 조회 (records 전체 조회 대비 훨씬 빠름)
        const usersSnapshot = await db.collection('users').get();

        const studentSet = new Set();
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            const userName = doc.id;
            // 코치가 아닌 사용자만 수강생으로 표시
            if (userName && userName !== state.currentUser && !userData.isCoach) {
                studentSet.add(userName);
            }
        });

        state.allStudents = Array.from(studentSet).sort();

        if (state.allStudents.length === 0) {
            studentListDiv.innerHTML = '<div class="text-gray-500 text-sm">아직 등록된 수강생이 없습니다.</div>';
            return;
        }

        // Restore selection from localStorage if state is empty (first load)
        if (state.selectedStudents.length === 0) {
            const saved = localStorage.getItem('coachSelectedStudents');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        state.selectedStudents = parsed.filter(s => state.allStudents.includes(s));
                    }
                } catch (e) {
                    console.error('Failed to load saved selection:', e);
                }
            }
        }

        // Feature 4: Restore Filters
        if (localStorage.getItem('coachPainFilter') === 'true') {
            state.painFilter = true;
            const chk = document.getElementById('painFilterCheck');
            if (chk) chk.checked = true;
        }
        // 운동 메모만 보기: 저장된 값이 없으면 기본 true (체크)
        const savedMemoFilter = localStorage.getItem('coachPinnedMemoFilter');
        if (savedMemoFilter === null || savedMemoFilter === 'true') {
            state.pinnedMemoFilter = true;
            const chk = document.getElementById('pinnedMemoFilterCheck');
            if (chk) chk.checked = true;
        }

        // 초성별로 그룹화
        const groupedByInitial = {};
        state.allStudents.forEach(student => {
            const initial = getKoreanInitial(student);
            if (!groupedByInitial[initial]) {
                groupedByInitial[initial] = [];
            }
            groupedByInitial[initial].push(student);
        });

        const sortedInitials = Object.keys(groupedByInitial).sort();

        let html = '';

        // 전체 선택 버튼
        const allSelected = state.selectedStudents.length === state.allStudents.length && state.allStudents.length > 0;
        html += `
            <div class="w-full mb-3 pb-3 border-b border-gray-300">
                <button 
                    onclick="toggleSelectAll()"
                    class="px-4 py-2 rounded-lg text-sm font-semibold ${allSelected ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'} hover:opacity-90 transition"
                >
                    ${allSelected ? '✓ 전체 선택됨 (' + state.allStudents.length + '명)' : '👥 전체 선택 (' + state.allStudents.length + '명)'}
                </button>
                <button
                    onclick="clearStudentSelection()"
                    class="ml-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200"
                    style="display: ${state.selectedStudents.length > 0 ? '' : 'none'}"
                >
                    ✕ 선택 해제 (${state.selectedStudents.length})
                </button>
                <button
                    onclick="toggleDeleteMode()"
                    class="ml-2 px-4 py-2 rounded-lg text-sm font-semibold ${state.deleteMode ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'} hover:opacity-90 transition"
                >
                    ${state.deleteMode ? '삭제 모드 ON' : '수강생 삭제'}
                </button>
            </div>
        `;

        sortedInitials.forEach(initial => {
            const students = groupedByInitial[initial];

            html += `
                <div class="w-full mb-4">
                    <div class="flex items-center mb-2">
                        <span class="text-lg font-bold text-gray-800 bg-gray-100 px-3 py-1 rounded">${initial}</span>
                        <span class="text-xs text-gray-500 ml-2">(${students.length}명)</span>
                    </div>
                    <div class="flex flex-wrap gap-2 ml-2">
            `;

            students.forEach(student => {
                const isSelected = state.selectedStudents.includes(student);
                if (state.deleteMode) {
                    html += `
                        <span class="student-badge px-3 py-2 rounded-full text-sm font-semibold bg-red-100 text-red-700 border-2 border-red-300 flex items-center gap-1">
                            ${student}
                            <button onclick="deleteStudentAccount('${student}')" class="ml-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold leading-none hover:bg-red-700">✕</button>
                        </span>
                    `;
                } else {
                    html += `
                        <span
                            class="student-badge px-3 py-2 rounded-full text-sm font-semibold ${isSelected ? 'active' : 'bg-gray-200 text-gray-700'}"
                            onclick="toggleStudent('${student}')"
                        >
                            ${isSelected ? '✓ ' : ''}${student}
                        </span>
                    `;
                }
            });

            html += `
                    </div>
                </div>
            `;
        });

        studentListDiv.innerHTML = html;
        updateStudentSelectionSummary();

        // Quick nav bar 업데이트
        updateStudentQuickNav();

        // Initial render: 선택된 학생이 있을 때만 데이터 로드
        if (state.selectedStudents.length > 0) {
            // 메모 표시 (pinnedMemoFilter가 true일 때)
            if (state.pinnedMemoFilter) {
                renderPinnedMemosForCoach();
            }
            // 운동 기록 표시 (recordsFilter가 true일 때만)
            if (state.recordsFilter) {
                debouncedLoadAllRecords();
            }
        }

    } catch (error) {
        console.error('Error loading student list:', error);
        studentListDiv.innerHTML = '<div class="text-red-500 text-sm">수강생 목록 로딩 실패</div>';
        updateStudentSelectionSummary();
    }
}

export function updateStudentSelectionSummary() {
    const summary = document.getElementById('studentSelectionSummary');
    if (!summary) return;

    if (state.allStudents.length === 0) {
        summary.textContent = '등록된 수강생이 없습니다.';
        return;
    }

    if (state.selectedStudents.length === 0) {
        summary.textContent = `전체 ${state.allStudents.length}명 | 선택: 없음`;
    } else if (state.selectedStudents.length === state.allStudents.length) {
        summary.textContent = `전체 ${state.allStudents.length}명 모두 선택됨`;
    } else {
        summary.textContent = `전체 ${state.allStudents.length}명 | 선택: ${state.selectedStudents.length}명 (${state.selectedStudents.join(', ')})`;
    }
}

export function toggleStudent(studentName) {
    const index = state.selectedStudents.indexOf(studentName);

    if (index === -1) {
        state.selectedStudents.push(studentName);
    } else {
        state.selectedStudents.splice(index, 1);
    }

    // Save selection to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    // Update UI without reloading entire list (which would restore from localStorage)
    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();

    // 메모/기록 업데이트
    if (state.pinnedMemoFilter) renderPinnedMemosForCoach();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

// Helper function to update student badges without full reload
function updateStudentBadges() {
    const badges = document.querySelectorAll('.student-badge');
    badges.forEach(badge => {
        const studentName = badge.textContent.replace('✓ ', '').trim();
        const isSelected = state.selectedStudents.includes(studentName);

        if (isSelected) {
            badge.classList.add('active');
            badge.classList.remove('bg-gray-200', 'text-gray-700');
            if (!badge.textContent.startsWith('✓ ')) {
                badge.textContent = '✓ ' + studentName;
            }
        } else {
            badge.classList.remove('active');
            badge.classList.add('bg-gray-200', 'text-gray-700');
            badge.textContent = studentName;
        }
    });

    // Update select all button
    const allSelected = state.selectedStudents.length === state.allStudents.length && state.allStudents.length > 0;
    const selectAllBtn = document.querySelector('button[onclick="toggleSelectAll()"]');
    if (selectAllBtn) {
        if (allSelected) {
            selectAllBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-green-500 text-white hover:opacity-90 transition';
            selectAllBtn.innerHTML = `✓ 전체 선택됨 (${state.allStudents.length}명)`;
        } else {
            selectAllBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:opacity-90 transition';
            selectAllBtn.innerHTML = `👥 전체 선택 (${state.allStudents.length}명)`;
        }
    }

    // Update clear selection button
    const clearBtn = document.querySelector('button[onclick="clearStudentSelection()"]');
    if (clearBtn) {
        if (state.selectedStudents.length > 0) {
            clearBtn.style.display = '';
            clearBtn.innerHTML = `✕ 선택 해제 (${state.selectedStudents.length})`;
        } else {
            clearBtn.style.display = 'none';
        }
    }
}

// ============================================
// Student Quick Navigation Bar
// ============================================

let activeQuickNavStudent = null;

export function updateStudentQuickNav() {
    const nav = document.getElementById('studentQuickNav');
    if (!nav) return;

    if (state.selectedStudents.length === 0) {
        nav.style.display = 'none';
        while (nav.firstChild) nav.removeChild(nav.firstChild);
        activeQuickNavStudent = null;
        return;
    }

    nav.style.display = 'flex';
    while (nav.firstChild) nav.removeChild(nav.firstChild);

    state.selectedStudents.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'student-quick-nav-btn' + (activeQuickNavStudent === name ? ' active' : '');
        btn.textContent = name;
        btn.addEventListener('click', () => {
            activeQuickNavStudent = name;
            highlightQuickNavBtn(nav, name);
            scrollToStudent(name);
        });
        nav.appendChild(btn);
    });
}

function highlightQuickNavBtn(nav, activeName) {
    nav.querySelectorAll('.student-quick-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === activeName);
    });
}

function scrollToStudent(name) {
    const section = document.getElementById(`student-section-${name}`);
    if (!section) return;

    const navBar = document.getElementById('studentQuickNav');
    const navHeight = navBar ? navBar.offsetHeight + 8 : 0;

    const y = section.getBoundingClientRect().top + window.pageYOffset - navHeight;
    window.scrollTo({ top: y, behavior: 'smooth' });
}
window.scrollToStudent = scrollToStudent;

// ============================================
// Data Caching & Real-time Listeners
// ============================================
let studentPinnedMemosCache = {};

export function setupRealtimePinnedMemosListener() {
    if (!firebaseInitialized || !db) return;

    // Listen to ALL student pinned memos
    // (In a production app with many users, you'd filter by coach's students or listen individually)
    db.collection('pinnedMemos').onSnapshot(snapshot => {
        snapshot.forEach(doc => {
            studentPinnedMemosCache[doc.id] = doc.data().memos || [];
        });

        // Update UI if viewing specific students
        if (state.selectedStudents.length > 0) {
            renderPinnedMemosForCoach();
        }
    }, error => {
        console.error('Real-time pinned memo listener error:', error);
    });
}

// Feature 3, 4, 5: Render Pinned Memos for Coach View (Independent of Date Filter)
// Displays both Coach's Pinned Memos AND Student's Self-Pinned Memos
// Feature 3, 4, 5, 1, 6, 8: Unified Memo & Message Renderer
export async function renderPinnedMemosForCoach() {
    const section = document.getElementById('coachPinnedMemosSection');
    if (!section) return;

    if (state.selectedStudents.length === 0) {
        section.innerHTML = '';
        return;
    }

    // cache update is handled by listeners
    // Explicit fetch for Coach Memos (Simulating realtime for now, or use cache if we add listener)
    let coachMemosMap = {};
    if (firebaseInitialized && db) {
        try {
            // Optimization: If many students, this might be slow, but for now OK.
            // Ideally we should cache this too.
            const snapshot = await db.collection('coachPinnedMemos').get();
            snapshot.forEach(doc => {
                coachMemosMap[doc.id] = doc.data().memos || [];
            });
        } catch (e) {
            console.error('Error fetching coach memos:', e);
        }
    }

    let html = '';

    state.selectedStudents.forEach(studentName => {
        const studentColor = getStudentColor(studentName, state.allStudents) || '#ffffff';
        const studentMemos = studentPinnedMemosCache[studentName] || [];
        const coachMemos = coachMemosMap[studentName] || [];

        // Filter by Exercise
        let filteredStudentMemos = studentMemos;
        let filteredCoachMemos = coachMemos;

        if (state.exerciseFilter) {
            filteredStudentMemos = studentMemos.filter(m => m.exercise === state.exerciseFilter);
            filteredCoachMemos = coachMemos.filter(m => m.exercise === state.exerciseFilter);
        }

        if (state.painFilter) {
            filteredStudentMemos = filteredStudentMemos.filter(m => m.pain === true);
            // Coach messages generally don't have pain? But if they do...
            // Or maybe Coach messages should hide if pain filter used?
            // "Show only records with pain". Assuming Coach Memos are not "pain" records unless specified.
            // But user says "Coach view... pain display necessary on student exercise memo" which I did.
            // "Coach mode... if checked pain view, show relevant memos".
            // For now, I won't filter Coach Memos by pain unless we add pain prop to Coach Memos (unlikely).
            // But if ONLY pain is wanted, showing non-pain coach messages might be clutter.
            // I'll keep default generic messages, but maybe hide exercise-specific coach memos that aren't about pain?
            // Safer to just filter Student Memos (where pain originates).
        }

        // Show section if there is content OR if we are in "Memo View" (to allow adding messages)
        // But if filtering by exercise and no matches, maybe show nothing?
        // User wants "Send Personal Message" capability.

        html += `<div id="student-section-${studentName}" class="rounded-xl p-4 mb-4 shadow-md border border-gray-200" style="background-color: ${studentColor}20;">
            <div class="flex items-center justify-between border-b border-gray-200 pb-2 mb-3">
                <h3 class="font-bold text-gray-800 text-lg flex items-center gap-2">
                    <span class="px-2 py-1 rounded bg-white border border-gray-200 text-sm shadow-sm">${studentName}</span>
                    <span class="text-sm font-normal text-gray-500">님의 메모 & 메시지</span>
                </h3>
                <button onclick="promptPersonalMessage('${studentName}')" class="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded hover:bg-indigo-700 font-semibold shadow-sm flex items-center gap-1">
                    📩 메시지 보내기
                </button>
            </div>`;

        // 1. Coach Messages (Personal Messages / Coach Memos)
        if (filteredCoachMemos.length > 0) {
            html += `<div class="mb-4">
                <h4 class="text-xs font-bold text-indigo-800 mb-2 uppercase tracking-wider opacity-70">Coach Messages</h4>
                <div class="space-y-2">`;

            filteredCoachMemos.forEach((memo, idx) => {
                html += `
                    <div class="bg-indigo-50 rounded-lg p-3 border border-indigo-100 shadow-sm relative">
                        <div class="flex justify-between items-start mb-1">
                            <span class="font-bold text-indigo-900 text-sm">${memo.exercise}</span>
                            <div class="flex gap-2">
                                <button onclick="editCoachMemo('${studentName}', '${memo.id || ''}', \`${(memo.memo || '').replace(/`/g, '\\`')}\`)" class="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded border border-blue-300 font-semibold">수정</button>
                                <button onclick="deleteCoachMemo('${studentName}', '${memo.id || ''}')" class="px-2 py-1 text-xs bg-red-100 text-red-700 rounded border border-red-300 font-semibold">삭제</button>
                            </div>
                        </div>
                        <div class="text-gray-800 text-sm whitespace-pre-wrap">${memo.memo}</div>
                        <div class="text-xs text-indigo-300 mt-1 text-right">${formatDate(memo.updatedAt || memo.createdAt)}</div>
                    </div>`;
            });
            html += `</div></div>`;
        }

        // 2. Student Memos (하이라이트 메모 상단 정렬)
        if (filteredStudentMemos.length > 0) {
            // 원본 인덱스를 보존하면서 하이라이트 메모를 상단으로 정렬
            const indexedMemos = filteredStudentMemos.map((memo, i) => ({ memo, originalIdx: studentMemos.indexOf(memo) }));
            indexedMemos.sort((a, b) => {
                const aH = a.memo.highlighted ? 1 : 0;
                const bH = b.memo.highlighted ? 1 : 0;
                return bH - aH; // highlighted가 true인 것이 위로
            });

            html += `<div>
                <h4 class="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider opacity-70">Student Memos</h4>
                <div class="space-y-3">`;

            indexedMemos.forEach(({ memo, originalIdx }) => {
                const comment = memo.coachComment || '';
                const isHighlighted = memo.highlighted === true;
                const borderColor = isHighlighted ? 'border-yellow-400' : 'border-gray-400';
                const bgColor = isHighlighted ? 'bg-yellow-50' : 'bg-white';
                const starBtn = isHighlighted
                    ? `<button onclick="toggleMemoHighlight('${studentName}', ${originalIdx})" class="text-yellow-400 hover:text-yellow-500 text-lg leading-none" title="중요 해제">★</button>`
                    : `<button onclick="toggleMemoHighlight('${studentName}', ${originalIdx})" class="text-gray-300 hover:text-yellow-400 text-lg leading-none" title="중요 표시">☆</button>`;
                html += `
                    <div class="${bgColor} rounded-lg p-3 border-l-4 ${borderColor} shadow-sm ${isHighlighted ? 'ring-1 ring-yellow-200' : ''}">
                        <div class="flex justify-between items-start">
                            <div class="flex items-center gap-2 mb-1">
                                ${starBtn}
                                <div class="font-bold text-gray-800 text-base">${memo.exercise}</div>
                                ${memo.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">⚠️ 통증</span>' : ''}
                                ${isHighlighted ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-semibold">중요</span>' : ''}
                            </div>
                        </div>
                        ${memo.memo ? `<div class="text-gray-700 whitespace-pre-wrap mb-3 text-sm">${memo.memo}</div>` : '<div class="text-gray-400 italic mb-3 text-xs">메모 없음</div>'}

                        <!-- Coach Comment (Legacy / Reply) -->
                        <div class="pt-2 border-t border-gray-100 bg-gray-50 -mx-3 -mb-3 px-3 py-2 rounded-b">
                            <label class="text-xs font-bold text-gray-500 block mb-1">💬 코멘트</label>
                            <div class="flex gap-2">
                                <textarea id="coach-comment-${studentName}-${originalIdx}"
                                    class="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-blue-500"
                                    rows="1"
                                    placeholder="코멘트...">${comment}</textarea>
                                <button onclick="saveCoachCommentToStudentMemo('${studentName}', ${originalIdx})"
                                    class="bg-gray-600 text-white text-xs px-3 py-1 rounded hover:bg-gray-700 font-semibold shadow-sm h-fit self-end pb-1.5 pt-1.5">
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>`;
            });
            html += `</div></div>`;
        }

        if (filteredCoachMemos.length === 0 && filteredStudentMemos.length === 0) {
            html += `<div class="text-center py-4 text-gray-400 text-sm">표시할 메모가 없습니다.</div>`;
        }

        html += `</div>`;
    });

    section.innerHTML = html;
    updateStudentQuickNav();
}

// Helper: Prompt for Personal Message



export async function saveCoachMessage(studentName, title, content) {
    if (!firebaseInitialized || !db) return;
    try {
        const docRef = db.collection('coachPinnedMemos').doc(studentName);
        const doc = await docRef.get();
        let memos = doc.exists ? (doc.data().memos || []) : [];

        // Check for existing "Personal Message" to append or separate?
        // Let's treat it as a new distinct entry if we want multiple messages?
        // Current structure is array of {exercise, memo}.
        // If we want multiple messages, we might need unique IDs or just use "Personal Message 1", "2"?
        // Or simply Append to one big "Personal Message"?
        // User wants "Student can delete message". 
        // Array of objects is fine. Exercise name can be the "Title".

        // Let's just add it as a new entry with Date.
        const newMsg = {
            exercise: title || '알림',
            memo: content,
            pinnedBy: state.currentUser,
            createdAt: new Date().toISOString(),
            id: Date.now().toString(),
            type: 'message' // Marker
        };

        memos.unshift(newMsg); // Add to top

        await docRef.set({
            userName: studentName,
            memos: memos,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert('✅ 메시지가 전송되었습니다.');
        renderPinnedMemosForCoach();
    } catch (e) {
        console.error(e);
        alert('전송 실패');
    }
}

export async function editCoachMemo(studentName, memoId, currentMemo) {
    const newMemo = prompt('메모 수정:', currentMemo);
    if (newMemo === null) return;
    updateCoachMemo(studentName, memoId, newMemo);
}
window.editCoachMemo = editCoachMemo;

export async function deleteCoachMemo(studentName, memoId) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    updateCoachMemo(studentName, memoId, null, true);
}
window.deleteCoachMemo = deleteCoachMemo;

async function updateCoachMemo(studentName, memoId, newContent, isDelete = false) {
    const docRef = db.collection('coachPinnedMemos').doc(studentName);
    const doc = await docRef.get();
    if (!doc.exists) return;

    let memos = doc.data().memos || [];
    // id 기반 매칭, 레거시 데이터는 exercise 폴백
    let idx = memoId ? memos.findIndex(m => m.id === memoId) : -1;
    if (idx === -1) {
        idx = memos.findIndex(m => m.exercise === memoId);
    }

    if (idx > -1) {
        if (isDelete) {
            memos.splice(idx, 1);
        } else {
            memos[idx].memo = newContent;
            memos[idx].updatedAt = new Date().toISOString();
        }
        await docRef.update({ memos });
        renderPinnedMemosForCoach();
    }
}

export async function saveCoachCommentToStudentMemo(studentName, memoIndex) {
    const textarea = document.getElementById(`coach-comment-${studentName}-${memoIndex}`);
    const comment = textarea.value.trim();

    if (!firebaseInitialized || !db) return;

    try {
        const docRef = db.collection('pinnedMemos').doc(studentName);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();
            const memos = data.memos || [];

            if (memos[memoIndex]) {
                memos[memoIndex].coachComment = comment;

                await docRef.update({
                    memos: memos,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                alert('✅ 코멘트가 저장되었습니다!');
                if (state.recordsFilter) debouncedLoadAllRecords();
            } else {
                alert('메모를 찾을 수 없습니다.');
            }
        } else {
            alert('수강생의 메모 데이터를 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('Error saving comment:', error);
        alert('저장 실패: ' + error.message);
    }
}
window.saveCoachCommentToStudentMemo = saveCoachCommentToStudentMemo;

export async function toggleMemoHighlight(studentName, memoIndex) {
    if (!firebaseInitialized || !db) return;

    try {
        const docRef = db.collection('pinnedMemos').doc(studentName);
        const doc = await docRef.get();

        if (doc.exists) {
            const memos = doc.data().memos || [];
            if (memos[memoIndex]) {
                memos[memoIndex].highlighted = !memos[memoIndex].highlighted;

                await docRef.update({
                    memos: memos,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 캐시도 업데이트
                studentPinnedMemosCache[studentName] = memos;
                renderPinnedMemosForCoach();
            }
        }
    } catch (error) {
        console.error('Error toggling highlight:', error);
        alert('하이라이트 변경 실패: ' + error.message);
    }
}
window.toggleMemoHighlight = toggleMemoHighlight;

export function toggleSelectAll() {
    if (state.selectedStudents.length === state.allStudents.length) {
        state.selectedStudents = [];
    } else {
        state.selectedStudents = [...state.allStudents];
    }

    // Save to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    if (state.pinnedMemoFilter) renderPinnedMemosForCoach();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function clearStudentSelection() {
    state.selectedStudents = [];

    // Save to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    if (state.pinnedMemoFilter) renderPinnedMemosForCoach();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function toggleDeleteMode() {
    state.deleteMode = !state.deleteMode;
    loadStudentList();
}
window.toggleDeleteMode = toggleDeleteMode;

export async function deleteStudentAccount(name) {
    if (!confirm(`"${name}" 수강생 계정을 삭제하시겠습니까?`)) return;
    if (!confirm(`정말로 "${name}"의 계정과 모든 관련 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const batch = db.batch();

        // users 컬렉션 삭제
        batch.delete(db.collection('users').doc(name));
        // coachPinnedMemos 삭제
        batch.delete(db.collection('coachPinnedMemos').doc(name));
        // pinnedMemos 삭제
        batch.delete(db.collection('pinnedMemos').doc(name));

        await batch.commit();

        // records 컬렉션 삭제 (서브컬렉션은 batch로 안되므로 개별 삭제)
        const recordsSnap = await db.collection('records').where('userName', '==', name).get();
        const deletePromises = recordsSnap.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);

        // 선택 목록에서 제거
        state.selectedStudents = state.selectedStudents.filter(s => s !== name);
        state.allStudents = state.allStudents.filter(s => s !== name);
        localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

        alert(`"${name}" 계정이 삭제되었습니다.`);
        await loadStudentList();
    } catch (e) {
        console.error('수강생 삭제 실패:', e);
        alert('삭제 실패: ' + e.message);
    }
}
window.deleteStudentAccount = deleteStudentAccount;

export function toggleStudentList() {
    const container = document.getElementById('studentListContainer');
    const icon = document.getElementById('studentListIcon');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        container.classList.add('hidden');
        icon.textContent = '▼';
    }
}

// 필터 패널 아코디언
export function toggleFilterPanel() {
    const container = document.getElementById('filterPanelContainer');
    const icon = document.getElementById('filterPanelIcon');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        container.classList.add('hidden');
        icon.textContent = '▼';
    }
}
window.toggleFilterPanel = toggleFilterPanel;

export function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    if (!summary) return;

    const parts = [];
    if (state.selectedDate) parts.push(state.selectedDate);
    if (state.exerciseFilter) parts.push(state.exerciseFilter);
    if (state.painFilter) parts.push('통증');
    if (state.pinnedMemoFilter) parts.push('메모');
    if (state.recordsFilter) parts.push('기록');

    summary.textContent = parts.length > 0 ? parts.join(' · ') : '기본 설정';
}

// 필터 관련
export function changeCoachDate(newDate) {
    state.selectedDate = newDate;
    updateFilterSummary();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function showAllDates() {
    state.selectedDate = null;
    document.getElementById('coachDateFilter').value = '';
    updateFilterSummary();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function togglePainFilter() {
    const checkbox = document.getElementById('painFilterCheck');
    state.painFilter = checkbox ? checkbox.checked : false;
    localStorage.setItem('coachPainFilter', state.painFilter);
    updateFilterSummary();
    if (state.pinnedMemoFilter) renderPinnedMemosForCoach();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function toggleMemoFilter() {
    // Deprecated: Merged into Workout Memo Filter
    // console.log('Memo filter deprecated');
}

export function togglePinnedMemoFilter() {
    const checkbox = document.getElementById('pinnedMemoFilterCheck');
    state.pinnedMemoFilter = checkbox ? checkbox.checked : false;
    localStorage.setItem('coachPinnedMemoFilter', state.pinnedMemoFilter);
    updateFilterSummary();

    const pinnedSection = document.getElementById('coachPinnedMemosSection');
    if (state.pinnedMemoFilter) {
        if (pinnedSection) pinnedSection.style.display = 'block';
        renderPinnedMemosForCoach();
    } else {
        if (pinnedSection) pinnedSection.style.display = 'none';
    }
}

export function toggleRecordsFilter() {
    const checkbox = document.getElementById('recordsFilterCheck');
    state.recordsFilter = checkbox ? checkbox.checked : false;
    updateFilterSummary();

    const allRecordsList = document.getElementById('allRecordsList');
    if (state.recordsFilter) {
        // 운동 기록 보기 체크 → 기록 로드 및 표시
        if (allRecordsList) allRecordsList.style.display = 'grid';
        loadAllRecords();
    } else {
        // 체크 해제 → 기록 숨기기, 리스너 해제
        if (allRecordsList) {
            allRecordsList.style.display = 'none';
            allRecordsList.innerHTML = '';
        }
        if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
        }
    }
}

export function promptPersonalMessage(studentName) {
    // Use the new Modal
    if (typeof openPersonalMessageModal === 'function') {
        openPersonalMessageModal(studentName);
    } else {
        // Fallback or Error
        alert("메시지 모달을 열 수 없습니다.");
    }
}

// function already added in previous step's replacement
// I will verify the previous step execution first.
// The previous step modifies coach.js.
// I will just add the visual cue to clear date picker in coach.js
export function changeCoachExerciseFilter(exerciseName) {
    state.exerciseFilter = exerciseName;
    updateFilterSummary();

    // 운동 필터가 켜져도 날짜 필터를 유지하도록 수정 (state.selectedDate = null 제거)
    if (state.pinnedMemoFilter) renderPinnedMemosForCoach();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

// 전체 기록 불러오기 (운동 기록 보기 체크 시에만 호출됨)
export async function loadAllRecords() {
    const allRecordsList = document.getElementById('allRecordsList');

    if (!allRecordsList) return;

    if (state.unsubscribe) state.unsubscribe();

    let query = db.collection('records');

    // Feature 2: 운동별 보기 필터 (날짜 필터와 함께 동작하도록 수정)
    if (state.exerciseFilter) {
        query = query.where('exercise', '==', state.exerciseFilter);
    }

    // 날짜 필터 적용 (운동 필터가 있어도 날짜 필터가 있으면 적용)
    if (state.selectedDate) {
        query = query.where('date', '==', state.selectedDate);
    }
    // 날짜 필터가 없고 운동 필터도 없으면 전체 보기 (서버 정렬)
    else if (!state.exerciseFilter) {
        query = query.orderBy('timestamp', 'asc');
    }

    if (state.painFilter) {
        query = query.where('pain', '==', true);
    }

    // 고정 메모 필터 사용 시 Firestore에서 수강생의 고정 메모 불러오기 (Phase 1 Logic Restored)
    let allPinnedMemos = {};
    if (state.pinnedMemoFilter && firebaseInitialized && db) {
        try {
            const pinnedSnapshot = await db.collection('pinnedMemos').get();
            pinnedSnapshot.forEach(doc => {
                const data = doc.data();
                allPinnedMemos[data.userName] = data.memos || [];
            });
        } catch (error) {
            console.error('❌ 고정 메모 불러오기 실패:', error);
        }
    }

    state.unsubscribe = query.limit(100).onSnapshot((snapshot) => {
        if (snapshot.empty) {
            allRecordsList.innerHTML = '<p class="text-gray-500 text-center py-8 col-span-full">기록이 없습니다.</p>';
            // Feature 3 Fix: 기록이 없어도 고정 메모는 보여야 함
            if (state.isCoach) {
                renderPinnedMemosForCoach();
            }
            return;
        }

        let filteredDocs = [];
        snapshot.forEach((doc) => {
            const data = doc.data();

            // Memo Filter Logic Removed (Merged into Pinned)
            // if (state.memoFilter && (!data.memo || data.memo.trim() === '')) {
            //     return;
            // }

            if (state.selectedStudents.length > 0 && !state.selectedStudents.includes(data.userName)) {
                return;
            }

            if (state.pinnedMemoFilter) {
                const studentPinnedMemos = allPinnedMemos[data.userName];
                if (!studentPinnedMemos || studentPinnedMemos.length === 0) {
                    return;
                }

                const exerciseName = data.exercise.trim().toLowerCase();
                const isPinned = studentPinnedMemos.some(p => p.exercise.trim().toLowerCase() === exerciseName);

                if (!isPinned) {
                    return;
                }
            }

            filteredDocs.push({ id: doc.id, data: data });
        });

        if (filteredDocs.length === 0) {
            allRecordsList.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <p class="text-gray-500 mb-2">필터 조건에 맞는 기록이 없습니다.</p>
                </div>
            `;
            // Feature 3 Fix: 필터 결과가 없어도 고정 메모는 보여야 함
            if (state.isCoach) {
                renderPinnedMemosForCoach();
            }
            return;
        }

        const groupedByStudent = {};
        filteredDocs.forEach((doc) => {
            const userName = doc.data.userName;
            if (!groupedByStudent[userName]) {
                groupedByStudent[userName] = [];
            }
            groupedByStudent[userName].push(doc);
        });

        Object.keys(groupedByStudent).forEach(userName => {
            groupedByStudent[userName].sort((a, b) => {
                const timeA = a.data.timestamp ? a.data.timestamp.toDate().getTime() : 0;
                const timeB = b.data.timestamp ? b.data.timestamp.toDate().getTime() : 0;
                return timeA - timeB;
            });
        });

        const sortedStudents = Object.keys(groupedByStudent).sort();

        let html = '';
        sortedStudents.forEach(userName => {
            groupedByStudent[userName].forEach((doc) => {
                const data = doc.data;
                const dateTime = data.timestamp ? data.timestamp.toDate().toLocaleString('ko-KR') : '방금 전';

                let setsDisplay = '';
                if (data.sets && Array.isArray(data.sets)) {
                    setsDisplay = data.sets.map((set, idx) => {
                        const normalized = normalizeSet(set);
                        const intensityStr = normalized.intensity.unit === '맨몸'
                            ? '맨몸'
                            : `${normalized.intensity.value}${normalized.intensity.unit}`;
                        let repsStr = '';

                        if (normalized.reps.unit === '초 x 회') {
                            repsStr = `${normalized.reps.value}초 × ${normalized.reps.count || '?'}회`;
                        } else {
                            repsStr = `${normalized.reps.value}${normalized.reps.unit}`;
                        }

                        return `<div class="text-sm text-gray-600">${idx + 1}세트: ${intensityStr} × ${repsStr}</div>`;
                    }).join('');
                } else {
                    setsDisplay = `<p class="text-gray-600">${data.weight}kg × ${data.reps}회 × ${data.sets}세트</p>`;
                }

                const bgColor = getStudentColor(data.userName, state.allStudents);

                html += `
                <div class="bg-white rounded-lg shadow-md p-5 card-enter" style="background-color: ${bgColor};">
                    <div class="flex items-center justify-between mb-3">
                        <span class="px-3 py-1 rounded-full text-sm font-semibold" style="background-color: ${getStudentBadgeColor(data.userName, state.allStudents)}; color: ${getStudentTextColor(data.userName, state.allStudents)};">
                            ${data.userName}
                        </span>
                        <div class="flex items-center gap-2">
                            ${data.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">⚠️ 통증</span>' : ''}
                            <span class="text-xs text-gray-500">${formatDate(data.date)}</span>
                        </div>
                    </div>
                    
                    <div class="mb-3">
                        <h4 class="font-bold text-lg text-gray-800 mb-1">${data.exercise}</h4>
                        ${setsDisplay}
                        ${data.memo ? `<p class="text-sm text-gray-600 mt-2" style="white-space: pre-wrap;">📝 ${data.memo}</p>` : ''}
                        <p class="text-xs text-gray-400 mt-1">${dateTime}</p>
                    </div>
                </div>
            `;
            });
        });

        allRecordsList.innerHTML = html;

        if (state.isCoach) {
            renderPinnedMemosForCoach();
        }
    }, (error) => {
        console.error('Error loading records:', error);
        allRecordsList.innerHTML = '<p class="text-red-500 text-center py-8 col-span-full">기록 불러오기 실패.</p>';
    });
}



// Personal Message Modal Logic
export function openPersonalMessageModal(studentName) {
    state.currentMessageTarget = studentName;

    // Create modal if not exists
    let modal = document.getElementById('personalMessageModal');
    if (!modal) {
        const modalHTML = `
            <div id="personalMessageModal" class="modal" style="display: none; position: fixed; z-index: 5000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.5);">
                <div class="modal-content bg-white m-auto p-6 border rounded-lg shadow-lg w-full max-w-md relative top-20">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold" id="msgModalTitle">메시지 보내기</h2>
                        <button onclick="closePersonalMessageModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">받는 사람</label>
                        <input type="text" id="msgStudentName" class="w-full px-3 py-2 border rounded-lg bg-gray-100" readonly>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">제목 (선택)</label>
                        <input type="text" id="msgTitle" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 📢 공지사항">
                    </div>
                     <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">내용</label>
                        <textarea id="msgContent" class="w-full px-3 py-2 border rounded-lg h-32" placeholder="메세지 내용을 입력하세요..."></textarea>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button onclick="closePersonalMessageModal()" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 font-semibold">취소</button>
                        <button onclick="confirmSendMessage()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold">전송</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('personalMessageModal');
    }

    document.getElementById('msgStudentName').value = studentName;
    document.getElementById('msgTitle').value = '';
    document.getElementById('msgContent').value = '';
    document.getElementById('msgModalTitle').textContent = `${studentName}님에게 메시지 보내기`;

    modal.style.display = 'block';
    document.getElementById('msgContent').focus();
}

export function closePersonalMessageModal() {
    const modal = document.getElementById('personalMessageModal');
    if (modal) modal.style.display = 'none';
}

export function confirmSendMessage() {
    const studentName = state.currentMessageTarget;
    const title = document.getElementById('msgTitle').value.trim() || '📢 개인 메시지';
    const content = document.getElementById('msgContent').value.trim();

    if (!content) {
        alert('내용을 입력해주세요.');
        return;
    }

    saveCoachMessage(studentName, title, content);
    closePersonalMessageModal();
}

window.openPersonalMessageModal = openPersonalMessageModal;
window.closePersonalMessageModal = closePersonalMessageModal;
window.confirmSendMessage = confirmSendMessage;

