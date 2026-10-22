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

let tokenPromise;
async function headers() {
    tokenPromise ??= new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/datastore'] })
        .getClient().then(c => c.getAccessToken()).then(t => t.token);
    return { Authorization: `Bearer ${await tokenPromise}`, 'Content-Type': 'application/json' };
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
