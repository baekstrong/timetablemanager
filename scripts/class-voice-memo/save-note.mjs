#!/usr/bin/env node
// 코치가 승인한 메모를 코치 전용 메모(coachNotes/notes)의 한 수강생 키에만 저장한다.
//   node scripts/class-voice-memo/save-note.mjs <이름> <새 메모 파일> [--expect <제안 때 현재 메모 파일>]
//   node scripts/class-voice-memo/save-note.mjs --finish <제안.md>   처리 끝난 제안 보관 + 받아쓰기 삭제
// 저장 전 원본을 백업하고, 저장 후 다시 읽어 값 일치·다른 수강생 메모 보존을 확인한다.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCoachNotesDoc, TEST_ACCOUNTS, writeCoachNote } from './firestore.mjs';

const STATE = path.join(os.homedir(), 'Library/Application Support/ClassVoiceMemo');
const args = process.argv.slice(2);

if (args[0] === '--finish') {
    const proposal = path.resolve(args[1]);
    const done = path.join(path.dirname(proposal), 'done');
    mkdirSync(done, { recursive: true, mode: 0o700 });
    renameSync(proposal, path.join(done, path.basename(proposal)));
    // 받아쓰기에는 수강생 건강 정보가 있어 처리 후 바로 지운다
    const transcript = path.join(STATE, 'transcripts', path.basename(proposal).replace(/\.md$/, '.txt'));
    rmSync(transcript, { force: true });
    rmSync(`${transcript}.json`, { force: true });
    console.log('제안 보관, 받아쓰기 삭제 완료');
    process.exit(0);
}

const [name, file] = args;
const expectIdx = args.indexOf('--expect');
if (!name || !file) {
    console.error('사용법: save-note.mjs <이름> <새 메모 파일> [--expect <현재 메모 파일>]');
    process.exit(1);
}
if (TEST_ACCOUNTS.includes(name)) throw new Error(`${name}은 테스트 계정입니다`);
const next = readFileSync(file, 'utf8').trim();
if (!next) throw new Error('빈 메모는 저장하지 않습니다');

const before = await readCoachNotesDoc();
const current = before.map[name] ?? '';
if (!(name in before.map) && expectIdx < 0) throw new Error(`${name}의 코치 메모가 없습니다 — 이름을 확인하거나 --expect 로 빈 파일을 주세요`);
if (expectIdx >= 0 && readFileSync(args[expectIdx + 1], 'utf8').trim() !== current.trim()) {
    throw new Error('제안을 만든 뒤 메모가 바뀌었습니다 — 최신 메모로 제안을 다시 만드세요');
}

const backups = path.join(STATE, 'backups');
mkdirSync(backups, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backups, `${stamp}_${name}.txt`);
writeFileSync(backup, `updateTime=${before.updateTime}\n---\n${current}\n`, { mode: 0o600 });

await writeCoachNote(name, next, before.updateTime);

const after = await readCoachNotesDoc();
const others = Object.keys(before.map).filter(k => k !== name);
const othersSame = others.every(k => after.map[k] === before.map[k]);
if (after.map[name] !== next || !othersSame) throw new Error(`저장 확인 실패 — 백업: ${backup}`);
console.log(`저장 완료: ${name} / 다른 수강생 ${others.length}명 메모 그대로 / 백업 ${backup}`);
