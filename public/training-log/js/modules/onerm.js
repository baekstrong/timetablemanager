// 1RM(1회 최대 중량) 계산기 — Epley 공식 + 종목별 내 1RM 저장.
// 순수 함수(estimate1RM/trainingTable/sortMyOneRMs)는 Firebase/DOM 무관 → 브라우저·Vitest 양쪽 import 가능.
import { state, db } from '../state.js';

const PERCENTS = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];

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

// 저장된 map({종목: {oneRM,weight,reps,date}}) → 최근 저장 순 배열. (순수)
export function sortMyOneRMs(map) {
    return Object.entries(map || {})
        .map(([exercise, v]) => ({ exercise, ...v }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// ============================================
// DOM / Firebase
// ============================================

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().split('T')[0];
const formatMD = (d) => { const [, m, day] = String(d || '').split('-'); return (m && day) ? `${+m}/${+day}` : ''; };

let _myOneRMs = []; // 화면에 렌더된 순서(삭제 시 인덱스로 참조)
let _expandedIndex = -1; // %표 펼친 항목

export function openOneRMModal() {
    const m = document.getElementById('onermModal');
    if (m) m.classList.remove('hidden');
    populateExerciseDatalist();
    loadMyOneRMs();
}

export function closeOneRMModal() {
    const m = document.getElementById('onermModal');
    if (m) m.classList.add('hidden');
}

// 종목 자동완성: 앱이 캐시해 둔 공용 종목 목록을 네이티브 datalist로
function populateExerciseDatalist() {
    const dl = document.getElementById('onermExerciseList');
    if (!dl) return;
    let names = [];
    try { names = JSON.parse(localStorage.getItem('exercisesListCache') || '[]'); } catch { /* 무시 */ }
    dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
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

// 계산한 값을 종목별로 내 계정에 저장 (종목당 최신 1개, 덮어쓰기)
export async function saveOneRM() {
    const status = document.getElementById('onermSaveStatus');
    const setStatus = (msg) => { if (status) status.textContent = msg; };

    if (!state.currentUser || !db) { setStatus('로그인이 필요해요'); return; }

    const exercise = (document.getElementById('onermExercise')?.value || '').trim();
    const weight = document.getElementById('onermWeight')?.value;
    const reps = document.getElementById('onermReps')?.value;
    const oneRM = estimate1RM(weight, reps);

    if (oneRM === null) { setStatus('무게·횟수를 먼저 입력하세요'); return; }
    if (!exercise) { setStatus('종목을 입력하세요'); return; }

    try {
        const ref = db.collection('oneRMRecords').doc(state.currentUser);
        const snap = await ref.get();
        const map = (snap.exists && snap.data().map) ? { ...snap.data().map } : {};
        map[exercise] = { oneRM, weight: parseFloat(weight), reps: parseFloat(reps), date: today() };
        // merge:false(전체 덮어쓰기) — merge:true는 map 필드를 딥 병합해서 키 삭제가 안 됨.
        // 항상 map 전체를 read-modify-write 하므로 전체 set이 맞다.
        // ponytail: 단일 사용자 순차 클릭 전제, 동시성 락 불필요.
        await ref.set({ map, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        setStatus(`저장됐어요 · ${exercise} ${oneRM}kg`);
        renderMyOneRMList(map);
    } catch (e) {
        console.error('1RM 저장 실패', e);
        setStatus('저장에 실패했어요');
    }
}

export async function loadMyOneRMs() {
    if (!state.currentUser || !db) return;
    try {
        const snap = await db.collection('oneRMRecords').doc(state.currentUser).get();
        renderMyOneRMList((snap.exists && snap.data().map) ? snap.data().map : {});
    } catch (e) {
        console.error('1RM 목록 로드 실패', e);
    }
}

// 항목 클릭 → 저장된 1RM 기준 %별 프로그램 중량표 펼치기/접기
export function toggleOneRM(index) {
    _expandedIndex = (_expandedIndex === index) ? -1 : index;
    renderMyOneRMList(null); // 현재 _myOneRMs 재사용
}

export async function deleteOneRM(index) {
    if (!state.currentUser || !db) return;
    const target = _myOneRMs[index];
    if (!target) return;
    try {
        const ref = db.collection('oneRMRecords').doc(state.currentUser);
        const snap = await ref.get();
        if (!snap.exists) return;
        const map = { ...(snap.data().map || {}) };
        delete map[target.exercise];
        // merge:false(전체 덮어쓰기) — merge:true는 map 필드를 딥 병합해서 키 삭제가 안 됨.
        // 항상 map 전체를 read-modify-write 하므로 전체 set이 맞다.
        // ponytail: 단일 사용자 순차 클릭 전제, 동시성 락 불필요.
        await ref.set({ map, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() });
        renderMyOneRMList(map);
    } catch (e) {
        console.error('1RM 삭제 실패', e);
    }
}

// map 전달 시 데이터 갱신(저장/삭제) → 순서 바뀔 수 있어 펼침 초기화.
// null 전달 시 펼침 토글만 (현재 _myOneRMs 재사용).
function renderMyOneRMList(map) {
    const el = document.getElementById('onermMyList');
    if (!el) return;
    if (map !== null) { _myOneRMs = sortMyOneRMs(map); _expandedIndex = -1; }

    if (!_myOneRMs.length) {
        el.innerHTML = `<p class="text-xs text-gray-400 text-center py-2">아직 저장한 1RM이 없어요</p>`;
        return;
    }

    el.innerHTML = _myOneRMs.map((it, i) => {
        const table = i === _expandedIndex ? `
            <div class="grid grid-cols-2 gap-2 text-sm px-3 pb-3">
                ${trainingTable(it.oneRM).map(({ pct, weight }) => `
                    <div class="flex justify-between px-3 py-1.5 bg-gray-50 rounded">
                        <span class="text-gray-500">${pct}%</span>
                        <span class="font-semibold text-gray-800">${weight} kg</span>
                    </div>`).join('')}
            </div>` : '';
        return `
        <div class="border-b border-[#EFEFF0] last:border-0">
            <div class="flex items-center justify-between px-3 py-2 cursor-pointer" onclick="toggleOneRM(${i})">
                <div class="min-w-0 truncate">
                    <span class="font-semibold text-gray-800">${esc(it.exercise)}</span>
                    <span class="text-[#329BE7] font-bold ml-2">${it.oneRM}kg</span>
                    <span class="text-gray-300 ml-1">${i === _expandedIndex ? '▲' : '▼'}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs text-gray-400">${it.weight}×${it.reps} · ${formatMD(it.date)}</span>
                    <button onclick="event.stopPropagation();deleteOneRM(${i})" class="text-gray-300 hover:text-[#E94E58] text-base leading-none" title="삭제">✕</button>
                </div>
            </div>
            ${table}
        </div>`;
    }).join('');
}
