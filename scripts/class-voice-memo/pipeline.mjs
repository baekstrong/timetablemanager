#!/usr/bin/env node
// 수업 음성 메모 자동화: 새 음성 메모 → 받아쓰기 → 교시별 코치 전용 메모 변경안 → Mac 알림.
// launchd가 음성 메모 폴더 변화·주기·로그인 시 실행한다. Mac이 잠자던 동안 쌓인 녹음은 다음 실행에 한꺼번에 처리.
// 저장은 하지 않는다 — 코치가 Claude 앱에서 /class-voice-memo 로 승인해야 save-note.mjs가 저장한다.
//   node scripts/class-voice-memo/pipeline.mjs          새 녹음 처리
//   node scripts/class-voice-memo/pipeline.mjs --seed   지금 있는 녹음은 전부 처리한 것으로 표시(설치 직후 1회)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dropRepeats, parseRecordingStart, periodFor, ymd } from './lib.mjs';
import { loadClassContext } from './firestore.mjs';

const HOME = os.homedir();
const REC = path.join(HOME, 'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings');
export const STATE = path.join(HOME, 'Library/Application Support/ClassVoiceMemo');
const MODELS = path.join(HOME, '.local/share/whisper-models');
const MIN_SECONDS = 5 * 60;   // 짧은 메모는 수업 녹음이 아니다
const SETTLE_MS = 2 * 60_000; // iCloud가 아직 내려받는 중일 수 있어 2분 묵은 파일만
const dirs = { transcripts: path.join(STATE, 'transcripts'), proposals: path.join(STATE, 'proposals'), tmp: path.join(STATE, 'tmp') };
Object.values(dirs).forEach(d => mkdirSync(d, { recursive: true, mode: 0o700 }));

const log = (msg) => appendFileSync(path.join(STATE, 'pipeline.log'), `${new Date().toISOString()} ${msg}\n`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 << 20, ...opts });
const writePrivate = (file, text) => writeFileSync(file, text, { mode: 0o600 });

const MAX_AGE_MS = 2 * 24 * 3600_000; // 개인 녹음 보호: 이틀 넘은 녹음은 처리 목록이 없어도 건드리지 않는다

const processedFile = path.join(STATE, 'processed.json');
const seeding = process.argv.includes('--seed');
// 처리 목록이 없으면(설치 전·삭제됨) 폴더의 모든 과거 녹음을 받아쓰게 된다 → --seed 없이는 아무것도 안 한다.
if (!seeding && !existsSync(processedFile)) {
    log('processed.json 없음 — `pipeline.mjs --seed` 먼저 실행 필요. 중단');
    process.exit(1);
}
const processed = new Set(existsSync(processedFile) ? JSON.parse(readFileSync(processedFile)) : []);
const saveProcessed = () => writePrivate(processedFile, JSON.stringify([...processed], null, 1));

const recordings = () => readdirSync(REC).filter(f => f.endsWith('.m4a')); // 권한 없으면 여기서 EPERM

// ponytail: 폴더 잠금 하나로 동시 실행 방지(launchd 중복 + 수동 실행). 죽은 잠금은 1시간 뒤 무시.
const lock = path.join(STATE, 'run.lock');
if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 3600_000) process.exit(0);
mkdirSync(lock, { recursive: true });
process.on('exit', () => rmSync(lock, { recursive: true, force: true }));

if (seeding) {
    recordings().forEach(f => processed.add(f));
    saveProcessed();
    console.log(`기존 녹음 ${processed.size}개를 처리 완료로 표시했습니다.`);
    process.exit(0);
}

function transcribe(file, names) {
    const id = path.basename(file, '.m4a');
    const wav = path.join(dirs.tmp, `${id}.wav`);
    const out = path.join(dirs.tmp, id);
    try {
        run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', wav]);
        // VAD + 문맥 끊기(-mc 0)로 조용한 구간의 반복 환각을 막는다 (1차 테스트 52% → 0%)
        run('whisper-cli', ['-m', path.join(MODELS, 'ggml-large-v3-turbo.bin'), '-l', 'ko', '-t', '8',
            '--vad', '-vm', path.join(MODELS, 'ggml-silero-v5.1.2.bin'), '-mc', '0', '-sns',
            '--prompt', `근력학교 수업. ${names.join(', ')}`, '-otxt', '-of', out, '-f', wav]);
        return dropRepeats(readFileSync(`${out}.txt`, 'utf8'));
    } finally {
        rmSync(wav, { force: true });
        rmSync(`${out}.txt`, { force: true });
    }
}

function propose(transcriptFile) {
    const meta = JSON.parse(readFileSync(`${transcriptFile}.json`));
    const input = JSON.stringify({ ...meta.context, transcript: readFileSync(transcriptFile, 'utf8') });
    const md = run('claude', ['-p', '--tools', '', '--no-session-persistence',
        '--system-prompt-file', path.join(import.meta.dirname, 'RULES.md'),
        '위 규칙대로 이 수업의 코치 전용 메모 변경안을 작성해줘.'], { input, timeout: 15 * 60_000 }).toString();
    const label = meta.context.period ? `${meta.context.period}교시` : '교시 확인 필요';
    const file = path.join(dirs.proposals, `${path.basename(transcriptFile, '.txt')}.md`);
    writePrivate(file, `# ${meta.context.date} ${label} 수업 메모 제안\n\n녹음: ${meta.recording}\n명단(${meta.context.source}): ${meta.context.names.join(', ') || '없음'}\n\n${md}`);
    return { label, date: meta.context.date, none: /변경 제안 없음/.test(md) };
}

const notify = (msg) => { try { run('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "수업 메모"`]); } catch { /* 알림 실패는 무시 */ } };

// 1) 새 녹음 받아쓰기
// 방금 들어온 녹음은 아직 내려받는 중일 수 있다. 다 내려온 뒤엔 폴더 변화 트리거가 다시 안 오므로 이번 실행에서 기다린다.
const ageOf = (f) => Date.now() - statSync(path.join(REC, f)).mtimeMs;
const youngest = Math.min(Infinity, ...recordings().filter(f => !processed.has(f)).map(ageOf));
if (youngest < SETTLE_MS) await new Promise(r => setTimeout(r, SETTLE_MS - youngest + 1000));
for (const f of recordings().filter(f => !processed.has(f)).sort()) {
    const file = path.join(REC, f);
    if (Date.now() - statSync(file).mtimeMs < SETTLE_MS) continue;
    const start = parseRecordingStart(f) ?? new Date(statSync(file).mtimeMs);
    const period = periodFor(start);
    // 수업 시간(평일 시작 15분 전~종료) 밖에서 시작했거나 오래된 녹음은 개인 녹음일 수 있어 받아쓰지 않는다
    const skip = Date.now() - start.getTime() > MAX_AGE_MS ? '이틀 지난 녹음'
        : period == null ? '수업 시간 외 녹음' : null;
    const seconds = skip ? 0 : Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
    if (skip || !(seconds >= MIN_SECONDS)) {
        log(`건너뜀 ${f}: ${skip ?? `${Math.round(seconds)}초짜리 짧은 녹음`}`);
        processed.add(f); saveProcessed(); continue;
    }
    const context = await loadClassContext(ymd(start), period);
    const t0 = Date.now();
    const text = transcribe(file, context.names);
    const base = path.join(dirs.transcripts, `${context.date}_${context.period ?? 'x'}교시_${path.basename(f, '.m4a').replace(/\s+/g, '_')}`);
    writePrivate(`${base}.txt`, text);
    writePrivate(`${base}.txt.json`, JSON.stringify({ recording: f, minutes: Math.round(seconds / 60), context }, null, 1));
    processed.add(f); saveProcessed();
    log(`받아쓰기 ${f} ${Math.round(seconds / 60)}분 → ${Math.round((Date.now() - t0) / 1000)}초`);
}

// 2) 제안이 아직 없는 받아쓰기 → 제안 (claude 실패분은 다음 실행에 재시도)
const ready = [];
for (const t of readdirSync(dirs.transcripts).filter(f => f.endsWith('.txt')).sort()) {
    if (existsSync(path.join(dirs.proposals, t.replace(/\.txt$/, '.md')))) continue;
    try { ready.push(propose(path.join(dirs.transcripts, t))); log(`제안 ${t}`); }
    catch (e) { log(`제안 실패 ${t}: ${String(e.stderr || e.message).slice(0, 300)}`); }
}

// 3) 알림
if (ready.length) {
    const lines = ready.map(r => `${r.date.slice(5)} ${r.label}${r.none ? '(변경 없음)' : ''}`);
    notify(`제안 ${ready.length}건: ${lines.join(', ')} — Claude에서 /class-voice-memo`);
}
