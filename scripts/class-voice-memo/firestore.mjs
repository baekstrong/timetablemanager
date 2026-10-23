// 수업 음성 메모: Firestore REST (서비스 계정). post-update-notice.js와 같은 이유로 SDK 대신 REST.
// 쓰기는 coachNotes/notes의 한 수강생 키만 — 수강생 본인 메모(pinnedMemos)·운동 메모는 절대 건드리지 않는다.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

// 테스트 계정 — 명단·제안에서 항상 제외 (2026-10-22 사용자 확인)
export const TEST_ACCOUNTS = ['김기안'];

const keyFile = path.join(import.meta.dirname, '..', '..', 'firebase-admin-key.json');
const projectId = JSON.parse(readFileSync(keyFile)).project_id;
const DB = `projects/${projectId}/databases/(default)`;
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;

// 클라이언트만 캐시하고 토큰은 매번 받는다 — 라이브러리가 만료 전에 알아서 갱신한다.
// (토큰을 캐시하면 1시간 넘게 떠 있는 확인 페이지 서버가 ACCESS_TOKEN_EXPIRED 401로 멈춘다)
let clientPromise;
async function headers() {
    clientPromise ??= new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/datastore'] }).getClient();
    const { token } = await (await clientPromise).getAccessToken();
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getDoc(p) {
    const res = await fetch(`${BASE}/${p}`, { headers: await headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${p} ${res.status}: ${await res.text()}`);
    return res.json();
}

// REST 타입 태그 값 → 일반 값
export const plain = (v) => v == null ? v
    : 'stringValue' in v ? v.stringValue
    : 'integerValue' in v ? Number(v.integerValue)
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(plain)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]))
    : v;

// 그 날 그 교시 명단(보강 포함, 테스트 계정 제외)과 코치 전용 메모. 명단은 출석 증거가 아니라 후보 목록이다.
export async function loadClassContext(date, period) {
    const [rosterDoc, schedulesDoc, notesDoc] = await Promise.all([
        getDoc(`studentMeta/roster-${date}`), getDoc('studentMeta/schedules'), getDoc('coachNotes/notes'),
    ]);
    let names = period ? (plain(rosterDoc?.fields?.map) || {})[String(period)] || [] : [];
    let source = 'roster';
    if (!names.length && period) {
        // 그 주 시간표를 코치가 안 열었으면 roster가 없다 → 정규 시간표로 대체(보강 미포함)
        const day = '일월화수목금토'[new Date(`${date}T00:00:00`).getDay()];
        names = Object.entries(plain(schedulesDoc?.fields?.map) || {})
            .filter(([, s]) => String(s).includes(`${day}${period}`)).map(([n]) => n);
        source = 'schedules';
    }
    names = names.filter(n => !TEST_ACCOUNTS.includes(n));
    const notes = plain(notesDoc?.fields?.map) || {};
    return { date, period, source, names, coachNotes: Object.fromEntries(names.map(n => [n, notes[n] || ''])) };
}

// 운동별 코치 메모(coachPinnedMemos/{이름}.memos) — 훈련일지에서 그 종목을 고르면 수강생에게 보인다.
export async function readCoachExerciseMemos(name) {
    const doc = await getDoc(`coachPinnedMemos/${encodeURIComponent(name)}`);
    const raw = doc?.fields?.memos?.arrayValue?.values || []; // 기존 항목은 타입 태그 그대로 보존해 다시 쓴다
    return { exists: !!doc, updateTime: doc?.updateTime, raw, memos: raw.map(plain) };
}

export async function readExerciseNames() {
    const res = await fetch(`${BASE}/exercises?pageSize=500`, { headers: await headers() });
    if (!res.ok) throw new Error(`GET exercises ${res.status}`);
    return ((await res.json()).documents || []).map(d => plain(d.fields?.name)).filter(Boolean);
}

// 운동별 코치 메모에 항목 추가. 훈련일지의 기존 형식({exercise, memo, pinnedBy, createdAt, id})을 그대로 쓴다.
// 읽은 뒤 수강생이 지우는 등 문서가 바뀌었으면 조건부 쓰기로 실패한다.
export async function addCoachExerciseMemos(name, items) {
    const cur = await readCoachExerciseMemos(name);
    const now = new Date().toISOString();
    const added = items.map((it, i) => ({
        exercise: it.exercise, memo: it.text, pinnedBy: '백관장', createdAt: now,
        id: `${Date.now()}${i}`, source: 'voice-memo',
    }));
    const toValue = (m) => ({ mapValue: { fields: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { stringValue: v }])) } });
    const memos = [...cur.raw, ...added.map(toValue)];
    const res = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
        method: 'POST', headers: await headers(),
        body: JSON.stringify({ writes: [{
            update: { name: `${DB}/documents/coachPinnedMemos/${name}`, fields: {
                userName: { stringValue: name },
                memos: { arrayValue: { values: memos } },
            } },
            updateMask: { fieldPaths: ['userName', 'memos'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: cur.exists ? { updateTime: cur.updateTime } : { exists: false },
        }] }),
    });
    if (!res.ok) throw new Error(`운동 메모 저장 실패 ${res.status}: ${await res.text()}`);
    const after = await readCoachExerciseMemos(name);
    const ok = added.every(a => after.memos.some(m => m.id === a.id && m.memo === a.memo && m.exercise === a.exercise))
        && cur.memos.every(m => after.memos.some(x => x.id === m.id));
    if (!ok) throw new Error('운동 메모 저장 확인 실패');
    return added.length;
}

export async function readCoachNotesDoc() {
    const doc = await getDoc('coachNotes/notes');
    return { updateTime: doc.updateTime, map: plain(doc.fields.map) || {} };
}

// 한 수강생의 코치 전용 메모만 교체. 읽은 뒤 다른 기기가 바꿨으면 updateTime 조건으로 실패한다.
export async function writeCoachNote(name, text, updateTime) {
    const res = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
        method: 'POST', headers: await headers(),
        body: JSON.stringify({ writes: [{
            update: { name: `${DB}/documents/coachNotes/notes`, fields: { map: { mapValue: { fields: { [name]: { stringValue: text } } } } } },
            updateMask: { fieldPaths: ['map.`' + name.replaceAll('`', '\\`') + '`'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { updateTime },
        }] }),
    });
    if (!res.ok) throw new Error(`저장 실패 ${res.status}: ${await res.text()}`);
}
