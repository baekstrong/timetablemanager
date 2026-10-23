#!/usr/bin/env node
// 수업 메모 제안 확인 페이지 (이 Mac 전용, http://127.0.0.1:5179).
// pipeline.mjs가 제안을 만든 뒤 띄우고 브라우저를 연다. 2시간 동안 요청이 없으면 스스로 종료.
// 저장: 코치 전용 메모(coachNotes/notes 한 키) / 운동별 코치 메모(coachPinnedMemos 항목 추가). 수강생 본인 메모는 건드리지 않는다.
import http from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCoachExerciseMemos, readCoachExerciseMemos, readCoachNotesDoc, readExerciseNames, TEST_ACCOUNTS, writeCoachNote } from './firestore.mjs';
import { rebaseNote } from './lib.mjs';

export const PORT = 5179;
const STATE = path.join(os.homedir(), 'Library/Application Support/ClassVoiceMemo');
const PROPOSALS = path.join(STATE, 'proposals');
const IDLE_MS = 2 * 3600_000;

let idle = setTimeout(() => process.exit(0), IDLE_MS);
const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_MS); };

const proposalPath = (file) => {
    const p = path.join(PROPOSALS, path.basename(String(file || '')));
    if (!/\.(json|md)$/.test(p) || !existsSync(p)) throw new Error('제안 파일을 찾을 수 없습니다');
    return p;
};

async function listProposals() {
    const files = existsSync(PROPOSALS) ? readdirSync(PROPOSALS).filter(f => /\.(json|md)$/.test(f)).sort() : [];
    const notes = (await readCoachNotesDoc()).map;
    const exerciseNames = await readExerciseNames().catch(() => []);
    const out = [];
    for (const file of files) {
        const raw = readFileSync(path.join(PROPOSALS, file), 'utf8');
        if (file.endsWith('.md')) { out.push({ file, legacy: true, raw }); continue; }
        const p = JSON.parse(raw);
        // 제안 이후 메모가 바뀌었을 수 있어 최신 값을 함께 보낸다(비교·충돌 확인용)
        for (const s of p.students || []) {
            s.currentCoachNote = notes[s.name] ?? '';
            // 미처리 제안이 쌓여 그사이 메모가 바뀌었으면(앞 수업 저장 등) 바꾼 줄만 최신 메모에 다시 얹어 보여준다
            if (s.coachNote && p.baseNotes && s.name in p.baseNotes) {
                const rebased = rebaseNote(p.baseNotes[s.name], s.coachNote.proposed, s.currentCoachNote);
                if (rebased !== s.coachNote.proposed) s.coachNote = { ...s.coachNote, proposed: rebased, rebased: true };
            }
            s.currentExerciseMemos = (await readCoachExerciseMemos(s.name).catch(() => ({ memos: [] }))).memos
                .map(m => ({ exercise: m.exercise, memo: m.memo }));
        }
        out.push({ file, ...p });
    }
    return { proposals: out, exerciseNames };
}

async function save({ name, coachNote, exerciseItems }) {
    if (!name || TEST_ACCOUNTS.includes(name)) throw new Error('수강생 이름을 확인하세요');
    const result = {};
    if (coachNote?.text?.trim()) {
        const before = await readCoachNotesDoc();
        const current = before.map[name] ?? '';
        if ((coachNote.expect ?? '').trim() !== current.trim()) throw new Error('페이지를 연 뒤 코치 전용 메모가 바뀌었습니다. 새로고침 후 다시 확인하세요');
        const backups = path.join(STATE, 'backups');
        mkdirSync(backups, { recursive: true, mode: 0o700 });
        writeFileSync(path.join(backups, `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}.txt`), `updateTime=${before.updateTime}\n---\n${current}\n`, { mode: 0o600 });
        const next = coachNote.text.trim();
        await writeCoachNote(name, next, before.updateTime);
        const after = await readCoachNotesDoc();
        const othersSame = Object.keys(before.map).filter(k => k !== name).every(k => after.map[k] === before.map[k]);
        if (after.map[name] !== next || !othersSame) throw new Error('코치 전용 메모 저장 확인 실패');
        result.coachNote = '저장됨';
    }
    const items = (exerciseItems || []).map(i => ({ exercise: String(i.exercise || '').trim(), text: String(i.text || '').trim() }))
        .filter(i => i.exercise && i.text);
    if (items.length) result.exerciseItems = `${await addCoachExerciseMemos(name, items)}개 추가됨`;
    return result;
}

// 페이지에서 고친 내용을 제안 파일에 반영(저장 전 단계 — 앱 메모는 안 건드린다). 새로고침해도 고친 게 남는다.
//   {op:'coachNote', student, text}       코치 전용 메모 제안을 코치가 고친 문구로 교체(없으면 새로 만듦)
//   {op:'moveItem', from, index, to}      체크리스트 항목을 다른 수강생으로 옮김(섞인 경우)
async function patch({ file, op, student, text, from, index, to }) {
    const p = proposalPath(file);
    if (!p.endsWith('.json')) throw new Error('예전 형식 제안은 고칠 수 없어요');
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const roster = (data.names || []).filter(n => !TEST_ACCOUNTS.includes(n));
    const get = (name) => {
        if (!roster.includes(name)) throw new Error(`${name}은(는) 이 수업 명단에 없어요`);
        let s = data.students.find(x => x.name === name);
        if (!s) { s = { name, guessed: false, evidence: [], coachNote: null, checklist: [] }; data.students.push(s); }
        return s;
    };
    if (op === 'coachNote') {
        const s = get(student);
        const t = String(text ?? '').trim();
        if (!t) throw new Error('빈 메모는 저장할 수 없어요');
        s.coachNote = { ...(s.coachNote || { removed: [] }), proposed: t, edited: true };
        data.baseNotes = { ...(data.baseNotes || {}), [student]: (await readCoachNotesDoc()).map[student] ?? '' };
    } else if (op === 'moveItem') {
        const src = get(from);
        const item = src.checklist?.[index];
        if (!item) throw new Error('옮길 항목을 찾을 수 없어요');
        if (from === to) return { ok: true };
        src.checklist.splice(index, 1);
        get(to).checklist.push({ ...item, moved: true });
    } else throw new Error('알 수 없는 수정');
    // 내용이 하나도 없는 수강생 카드는 지운다
    data.students = data.students.filter(s => s.coachNote || (s.checklist || []).length);
    writeFileSync(p, JSON.stringify(data, null, 1), { mode: 0o600 });
    return { ok: true };
}

function finish(file) {
    const p = proposalPath(file);
    const done = path.join(PROPOSALS, 'done');
    mkdirSync(done, { recursive: true, mode: 0o700 });
    renameSync(p, path.join(done, path.basename(p)));
    // 받아쓰기에는 수강생 건강 정보가 있어 처리 끝나면 지운다
    const t = path.join(STATE, 'transcripts', path.basename(p).replace(/\.(json|md)$/, '.txt'));
    rmSync(t, { force: true }); rmSync(`${t}.json`, { force: true });
    return { finished: true };
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

const server = http.createServer(async (req, res) => {
    touch();
    // DNS 리바인딩 방지: 외부 도메인이 127.0.0.1로 풀려도 Host가 다르면 거부(같은 출처 판정을 우회하지 못하게)
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return send(res, 421, { error: 'bad host' });
    try {
        if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
            return send(res, 200, readFileSync(path.join(import.meta.dirname, 'review.html'), 'utf8'), 'text/html; charset=utf-8');
        }
        if (!req.url.startsWith('/api/')) return send(res, 404, { error: 'not found' });
        // 다른 웹사이트가 이 Mac의 페이지로 몰래 요청하지 못하게: 사용자 지정 헤더 + 같은 출처만
        const origin = req.headers.origin;
        if (req.headers['x-cvm'] !== '1' || (origin && origin !== `http://127.0.0.1:${PORT}`)) return send(res, 403, { error: 'forbidden' });
        if (req.method === 'GET' && req.url === '/api/proposals') return send(res, 200, await listProposals());
        if (req.method === 'POST') {
            let body = '';
            for await (const chunk of req) { body += chunk; if (body.length > 1e6) throw new Error('too large'); }
            const data = JSON.parse(body || '{}');
            if (req.url === '/api/save') return send(res, 200, await save(data));
            if (req.url === '/api/patch') return send(res, 200, await patch(data));
            if (req.url === '/api/finish') return send(res, 200, finish(data.file));
        }
        send(res, 404, { error: 'not found' });
    } catch (e) {
        send(res, 400, { error: e.message });
    }
});

server.on('error', (e) => { if (e.code === 'EADDRINUSE') process.exit(0); throw e; }); // 이미 떠 있으면 그대로 사용
server.listen(PORT, '127.0.0.1');
