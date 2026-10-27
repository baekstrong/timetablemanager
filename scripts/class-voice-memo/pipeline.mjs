#!/usr/bin/env node
// 수업 음성 메모 자동화: 새 음성 메모 → 받아쓰기 → 교시별 메모 변경안(코치 전용 메모 + 수강생 체크리스트) → 알림 + 확인 페이지.
// launchd가 음성 메모 폴더 변화·주기·로그인 시 실행한다. Mac이 잠자던 동안 쌓인 녹음은 다음 실행에 한꺼번에 처리.
// 저장은 하지 않는다 — 코치가 확인 페이지(http://127.0.0.1:5179)에서 체크한 것만 server.mjs가 저장한다.
//   node scripts/class-voice-memo/pipeline.mjs          새 녹음 처리
//   node scripts/class-voice-memo/pipeline.mjs --seed   지금 있는 녹음은 전부 처리한 것으로 표시(설치 직후 1회)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideGroup, decideNames, groupByClass, tagNameCalls, tagSpeakers, matchVoiceprints, parseRecordingStart, parseSrt, periodFor, renderLabeled, updateVoiceprints, voteNames, ymd } from './lib.mjs';
import { loadClassContext, readCoachExerciseMemos, readExerciseNames } from './firestore.mjs';

const HOME = os.homedir();
const REC = path.join(HOME, 'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings');
export const STATE = path.join(HOME, 'Library/Application Support/ClassVoiceMemo');
const MODELS = path.join(HOME, '.local/share/whisper-models');
const MIN_SECONDS = 60 * 60;  // 수업 녹음은 1시간 넘게 이어진다. 그보다 짧으면 개인 메모로 보고 건너뜀 (2026-10-22 사용자 결정)
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

const VENV_PY = path.join(HOME, '.local/share/class-voice-memo/venv/bin/python');
const VOICEPRINTS = path.join(STATE, 'voiceprints.json'); // 생체정보 — 이 Mac에만, 600. Firestore·Git에 올리지 않는다.
// 화자 구분은 기본 꺼짐: 10/22 4교시 시험에서 코치/수강생 구분이 70~88%, 수강생끼리는 섞여서 틀린 이름이 분석을 오도할 위험이 더 컸다.
// 켜려면 `touch ~/Library/Application\ Support/ClassVoiceMemo/diarize.on` (끄려면 그 파일 삭제).
const DIARIZE = existsSync(path.join(STATE, 'diarize.on')) && existsSync(VENV_PY);

// 받아쓰기(+켜져 있으면 화자 구분) → 줄마다 [코치]/[이름]/[이름?]/[다른 사람N]. 화자 구분 실패 시 받아쓰기만.
// files가 여럿이면(전화로 끊긴 녹음) 시간순으로 이어 붙여 하나로 받아쓴다.
function transcribe(files, names, date) {
    const id = path.basename(files[0], '.m4a');
    const wav = path.join(dirs.tmp, `${id}.wav`);
    const out = path.join(dirs.tmp, id);
    try {
        const concat = files.length > 1 ? ['-filter_complex', `${files.map((_, i) => `[${i}:a]`).join('')}concat=n=${files.length}:v=0:a=1`] : [];
        run('ffmpeg', ['-v', 'error', '-y', ...files.flatMap(f => ['-i', f]), ...concat, '-ar', '16000', '-ac', '1', wav]);
        // VAD + 문맥 끊기(-mc 0)로 조용한 구간의 반복 환각을 막는다 (1차 테스트 52% → 0%)
        run('whisper-cli', ['-m', path.join(MODELS, 'ggml-large-v3-turbo.bin'), '-l', 'ko', '-t', '8',
            '--vad', '-vm', path.join(MODELS, 'ggml-silero-v5.1.2.bin'), '-mc', '0', '-sns',
            '--prompt', `근력학교 수업. ${names.join(', ')}`, '-osrt', '-of', out, '-f', wav]);
        const lines = parseSrt(readFileSync(`${out}.srt`, 'utf8'))
            .filter((l, i, a) => i === 0 || l.text !== a[i - 1].text); // 반복 환각 잔여 제거
        const plain = lines.map(l => l.text).join('\n');
        if (!DIARIZE) return { text: plain, speakers: null };
        try {
            const t0 = Date.now();
            writePrivate(`${out}.lines.json`, JSON.stringify(lines.map(l => ({ start: l.start, end: l.end }))));
            const dz = JSON.parse(run(VENV_PY, [path.join(import.meta.dirname, 'diarize.py'), wav, `${out}.lines.json`, '0.8'], { timeout: 30 * 60_000 }).toString());
            const { coach, lines: tagged } = tagSpeakers(lines, dz.speakers);
            const voted = decideNames(voteNames(tagged, coach, names));
            const voiceprints = existsSync(VOICEPRINTS) ? JSON.parse(readFileSync(VOICEPRINTS)) : {};
            const byVoice = matchVoiceprints(dz.embeddings, voiceprints, voted, names);
            const all = new Map([...voted, ...byVoice]);
            writePrivate(VOICEPRINTS, JSON.stringify(updateVoiceprints(voiceprints, dz.embeddings, voted, date)));
            log(`화자 구분 ${Math.round((Date.now() - t0) / 1000)}초: 이름 매칭 ${[...all.values()].map(v => v.name + (v.sure ? '' : '?')).join(', ') || '없음'}`);
            return { text: renderLabeled(tagged, coach, all), speakers: [...all].map(([spk, v]) => ({ speaker: spk, ...v })) };
        } catch (e) {
            log(`화자 구분 실패(받아쓰기만 사용): ${String(e.stderr || e.message).slice(0, 200)}`);
            return { text: plain, speakers: null };
        }
    } finally {
        rmSync(wav, { force: true });
        rmSync(`${out}.srt`, { force: true });
        rmSync(`${out}.lines.json`, { force: true });
    }
}

// 분석은 JSON(코치 전용 메모 + 수강생 체크리스트)으로 받아 확인 페이지(server.mjs + review.html)가 보여준다.
async function propose(transcriptFile) {
    const meta = JSON.parse(readFileSync(`${transcriptFile}.json`));
    const { names } = meta.context;
    const [exercises, ...memoLists] = await Promise.all([
        readExerciseNames().catch(() => []),
        ...names.map(n => readCoachExerciseMemos(n).then(r => r.memos.filter(m => !m.done)).catch(() => [])),
    ]);
    const exerciseMemos = Object.fromEntries(names.map((n, i) => [n, memoLists[i].map(m => ({ exercise: m.exercise, memo: m.memo }))]));
    // 이름을 자주 잘못 듣으므로 코드가 명단과 자모 비교로 호명을 미리 표시한다(애매하면 후보만). 분석은 표시된 호명 대화만 메모로 만든다.
    const input = JSON.stringify({ ...meta.context, exerciseMemos, exercises, transcript: tagNameCalls(readFileSync(transcriptFile, 'utf8'), names) });
    const out = run('claude', ['-p', '--tools', '', '--no-session-persistence',
        '--system-prompt-file', path.join(import.meta.dirname, 'RULES.md'),
        '위 규칙대로 이 수업의 메모 변경안을 JSON으로 작성해줘.'], { input, timeout: 15 * 60_000 }).toString();
    const base = path.join(dirs.proposals, path.basename(transcriptFile, '.txt'));
    const label = meta.context.period ? `${meta.context.period}교시` : '교시 확인 필요';
    let parsed;
    try { parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); }
    catch {
        // JSON이 깨져도 버리지 않고 원문을 예전 형식으로 남겨 페이지에서 볼 수 있게 한다
        writePrivate(`${base}.md`, `# ${meta.context.date} ${label} (분석 결과 형식 오류 — 원문)\n\n${out}`);
        return { label, date: meta.context.date, none: false };
    }
    writePrivate(`${base}.json`, JSON.stringify({
        date: meta.context.date, period: meta.context.period, names, source: meta.context.source,
        recording: meta.recording, minutes: meta.minutes,
        baseNotes: meta.context.coachNotes, // 제안이 고쳐 쓴 원래 메모 — 나중에 메모가 바뀌면 이 기준으로 다시 얹는다(rebaseNote)
        students: (parsed.students || []).filter(s => names.includes(s.name) || s.guessed), uncertain: parsed.uncertain || [],
    }, null, 1));
    return { label, date: meta.context.date, none: !(parsed.students || []).length && !(parsed.uncertain || []).length };
}

const PAGE = 'http://127.0.0.1:5179';
// 확인 페이지 서버를 (안 떠 있으면) 띄운다. 이 앱(전체 디스크 접근 권한) 아래에서 띄워야 Desktop의 프로젝트를 읽을 수 있다.
async function ensureServer() {
    const alive = await fetch(`${PAGE}/`).then(r => r.ok).catch(() => false);
    if (!alive) {
        spawn(process.execPath, [path.join(import.meta.dirname, 'server.mjs')], { detached: true, stdio: 'ignore' }).unref();
        await new Promise(r => setTimeout(r, 800));
    }
}
async function openReviewPage() {
    await ensureServer();
    try { run('open', [PAGE]); } catch { /* 브라우저 열기 실패는 알림으로 대신 */ }
}

const notify = (msg) => { try { run('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "수업 메모"`]); } catch { /* 알림 실패는 무시 */ } };

// 1) 새 녹음 받아쓰기
// 방금 들어온 녹음은 아직 내려받는 중일 수 있다. 다 내려온 뒤엔 폴더 변화 트리거가 다시 안 오므로 이번 실행에서 기다린다.
// 실행 도중 파일이 계속 써지면(긴 녹음 내려받기) 대기 후에도 다시 '방금 바뀜'이 되므로, 잠잠해질 때까지 최대 10분 반복해서 기다린다.
const ageOf = (f) => Date.now() - statSync(path.join(REC, f)).mtimeMs;
for (let waited = 0; waited < 10 * 60_000;) {
    const youngest = Math.min(Infinity, ...recordings().filter(f => !processed.has(f)).map(ageOf));
    if (youngest >= SETTLE_MS) break;
    const ms = SETTLE_MS - youngest + 1000;
    await new Promise(r => setTimeout(r, ms));
    waited += ms;
}
const inClass = [];
for (const f of recordings().filter(f => !processed.has(f)).sort()) {
    const file = path.join(REC, f);
    if (Date.now() - statSync(file).mtimeMs < SETTLE_MS) { log(`대기 ${f}: 아직 내려받는 중 — 다음 실행에 처리`); continue; }
    const start = parseRecordingStart(f) ?? new Date(statSync(file).mtimeMs);
    const period = periodFor(start);
    // 수업 시간(평일 시작 15분 전~종료) 밖에서 시작했거나 오래된 녹음은 개인 녹음일 수 있어 받아쓰지 않는다
    const skip = Date.now() - start.getTime() > MAX_AGE_MS ? '이틀 지난 녹음'
        : period == null ? '수업 시간 외 녹음' : null;
    if (skip) { log(`건너뜀 ${f}: ${skip}`); processed.add(f); saveProcessed(); continue; }
    const seconds = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
    inClass.push({ f, start, period, seconds });
}
// 같은 교시 녹음은 합친 길이로 판단(전화로 끊긴 수업). 짧으면 수업 종료 30분 뒤까지 다음 조각을 기다린다.
for (const g of groupByClass(inClass)) {
    const decision = decideGroup(g, new Date(), MIN_SECONDS);
    if (decision === 'wait') continue;
    if (decision === 'skip') {
        log(`건너뜀 ${g.parts.join(' + ')}: 합쳐서 ${Math.round(g.seconds)}초짜리 짧은 녹음`);
        g.parts.forEach(f => processed.add(f)); saveProcessed(); continue;
    }
    const context = await loadClassContext(g.date, g.period);
    const t0 = Date.now();
    const { text, speakers } = transcribe(g.parts.map(f => path.join(REC, f)), context.names, g.date);
    const stem = path.basename(g.parts[0], '.m4a').replace(/\s+/g, '_') + (g.parts.length > 1 ? '-합침' : '');
    const base = path.join(dirs.transcripts, `${context.date}_${context.period ?? 'x'}교시_${stem}`);
    writePrivate(`${base}.txt`, text);
    writePrivate(`${base}.txt.json`, JSON.stringify({ recording: g.parts.join(' + '), minutes: Math.round(g.seconds / 60), context, speakers }, null, 1));
    g.parts.forEach(f => processed.add(f)); saveProcessed();
    log(`받아쓰기 ${g.parts.join(' + ')} ${Math.round(g.seconds / 60)}분 → ${Math.round((Date.now() - t0) / 1000)}초`);
}

// 2) 제안이 아직 없는 받아쓰기 → 제안 (claude 실패분은 다음 실행에 재시도)
const ready = [];
for (const t of readdirSync(dirs.transcripts).filter(f => f.endsWith('.txt')).sort()) {
    const stem = path.join(dirs.proposals, t.replace(/\.txt$/, ''));
    if (existsSync(`${stem}.json`) || existsSync(`${stem}.md`)) continue;
    try { ready.push(await propose(path.join(dirs.transcripts, t))); log(`제안 ${t}`); }
    catch (e) { log(`제안 실패 ${t}: ${String(e.stderr || e.message).slice(0, 300)}`); }
}

// 3) 알림 + 확인 페이지 열기
if (ready.length) {
    const lines = ready.map(r => `${r.date.slice(5)} ${r.label}${r.none ? '(변경 없음)' : ''}`);
    notify(`제안 ${ready.length}건: ${lines.join(', ')} — 브라우저에서 체크해 저장`);
    await openReviewPage();
} else if (readdirSync(dirs.proposals).some(f => /\.(json|md)$/.test(f))) {
    // 확인 안 한 제안이 남아 있으면 서버가 2시간 무요청으로 꺼졌어도 15분마다 다시 띄워 둔다(브라우저는 열지 않음)
    await ensureServer();
}
