// 수업 음성 메모 자동화의 순수 함수 (파일·네트워크 없음 — 테스트에서 그대로 import)
import { PERIODS } from '../../src/data/mockData.js';

const END_MINUTES = { 1: 11 * 60 + 30, 2: 13 * 60 + 30, 3: 17 * 60, 4: 19 * 60 + 30, 5: 21 * 60 + 20, 6: 23 * 60 + 10 };

// 음성 메모 파일명 "20261022 120128-3B605E49.m4a" → 녹음 시작 시각(로컬)
export function parseRecordingStart(fileName) {
    const m = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})/.exec(fileName);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
}

// 시작 15분 전 ~ 수업 종료 사이에 녹음을 시작했으면 그 교시. 밖이면 null(교시 확인 필요).
export function periodFor(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return null;
    const minutes = date.getHours() * 60 + date.getMinutes();
    const p = PERIODS.find(p => {
        const start = p.startHour * 60 + p.startMinute;
        return minutes >= start - 15 && minutes <= END_MINUTES[p.id];
    });
    return p ? p.id : null;
}

// 수업 중 전화가 오면 녹음이 여러 개로 끊긴다. 같은 날·같은 교시 녹음을 묶어 합친 길이로 판단한다.
// [{f, start, period, seconds}] → [{date, period, parts(시간순), seconds, endsAt}]. endsAt = 수업 종료 + 30분(마지막 조각이 아직 녹음 중일 수 있음).
export function groupByClass(items) {
    const groups = new Map();
    for (const it of [...items].sort((a, b) => a.start - b.start)) {
        const key = `${ymd(it.start)}_${it.period}`;
        if (!groups.has(key)) {
            const end = new Date(it.start);
            end.setHours(0, END_MINUTES[it.period] + 30, 0, 0);
            groups.set(key, { date: ymd(it.start), period: it.period, parts: [], seconds: 0, endsAt: end });
        }
        const g = groups.get(key);
        g.parts.push(it.f);
        g.seconds += it.seconds;
    }
    return [...groups.values()];
}

// 합쳐서 기준을 넘으면 처리, 아직 수업(+30분) 중이면 다음 조각을 기다림, 끝났는데 짧으면 건너뜀
export const decideGroup = (g, now, minSeconds) =>
    g.seconds >= minSeconds ? 'process' : now < g.endsAt ? 'wait' : 'skip';

export const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// whisper SRT → [{start, end, text}] (초)
export function parseSrt(srt) {
    const toSec = (t) => { const [h, m, s] = t.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +s; };
    return srt.split(/\r?\n\r?\n/).map(block => {
        const m = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\s*\n([\s\S]*)/.exec(block.trim());
        return m && { start: toSec(m[1]), end: toSec(m[2]), text: m[3].replace(/\s*\n\s*/g, ' ').trim() };
    }).filter(l => l && l.text);
}

// 줄마다 화자 번호(diarize.py 결과)를 붙이고, 가장 오래 말한 화자 = 코치(폰이 코치 몸에 있음).
export function tagSpeakers(lines, speakers) {
    const tagged = lines.map((l, i) => ({ ...l, speaker: speakers[i] ?? null }));
    const total = new Map();
    for (const l of tagged) if (l.speaker != null) total.set(l.speaker, (total.get(l.speaker) || 0) + (l.end - l.start));
    return { coach: [...total].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null, lines: tagged };
}

// 제안은 만들 당시 메모(base)를 고쳐 쓴 전문이다. 그사이 다른 제안 저장·코치 직접 수정으로 메모가 바뀌었으면
// 제안이 바꾼 줄(추가·삭제)만 최신 메모에 다시 얹는다 — 미처리 수업이 쌓였을 때 앞 저장분을 지우지 않게.
export function rebaseNote(base, proposed, current) {
    if (base == null || base === current) return proposed;
    const lines = (t) => (t || '').split('\n').map(l => l.trimEnd()).filter(Boolean);
    const B = new Set(lines(base)), P = lines(proposed), P_ = new Set(P);
    const removed = new Set([...B].filter(l => !P_.has(l)));
    const kept = lines(current).filter(l => !removed.has(l));
    const added = P.filter(l => !B.has(l) && !kept.includes(l));
    return [...kept, ...added].join('\n');
}

// ── 호명 표시: 받아쓰기가 이름을 자주 잘못 듣는다(10/22 5교시: 김기상 → 김기선·김기성·김계성·김기랑…).
// 한글을 초성·중성·종성으로 나눠 비교해 명단과 가까운 이름을 찾고, 줄 끝에 ⟪호명: 이름⟫을 붙인다.
// 후보가 비슷하게 둘 이상이면 고르지 않고 ⟪호명?: A/B⟫ — 분석은 애매한 호명으로 메모를 만들지 않는다.
const jamo = (ch) => { const c = ch.charCodeAt(0) - 0xAC00; return c < 0 || c > 11171 ? null : [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28]; };
const sylDist = (a, b) => { const x = jamo(a), y = jamo(b); return !x || !y ? 3 : x.filter((v, i) => v !== y[i]).length; };
const wordDist = (a, b) => a.length !== b.length ? Infinity : [...a].reduce((s, c, i) => s + sylDist(c, b[i]), 0);

export function nameCall(line, roster) {
    const best = new Map(); // 이름 → 가장 가까운 거리
    const consider = (name, d) => { if (d < (best.get(name) ?? Infinity)) best.set(name, d); };
    for (const w of line.match(/[가-힣]+/g) || []) {
        for (const name of roster.filter(n => n.length === 3)) {
            // 성+이름 세 글자: 성이 같고 자모 차이 2 이하 ("선생"이 든 조각은 호칭이라 제외)
            for (let i = 0; i + 3 <= w.length; i++) {
                const t = w.slice(i, i + 3);
                if (t[0] === name[0] && !t.includes('선생')) { const d = wordDist(t, name); if (d <= 2) consider(name, d); }
            }
        }
    }
    // 세 글자 + 호칭에서 한 글자만 통째로 잘못 들린 경우("김수현 선생님"→김수미): 호칭이 붙으면 이름일 가능성이 높아 자모 차이 3까지.
    // 두 글자 이상 다르면(10/22 '김태성 선생님'≠김기상) 인정하지 않는다. (2026-11-16 사용자 요청 — 그 대화가 ❓로 갔다)
    for (const m of line.matchAll(/([가-힣]{3})\s*(선생|쌤|씨|님)/g)) {
        if (m[1].includes('선생')) continue;
        for (const name of roster.filter(n => n.length === 3)) {
            const diff = [...name].filter((c, k) => c !== m[1][k]).length;
            const d = wordDist(m[1], name);
            if (diff === 1 && d <= 3) consider(name, d);
        }
    }
    // 이름 두 글자 + 호칭("재현 씨", "진주 선생님") — 두 글자는 우연히 비슷한 말이 많아 호칭이 붙을 때만
    for (const m of line.matchAll(/([가-힣]{2})\s*(선생|쌤|씨|님)/g)) {
        for (const name of roster.filter(n => n.length === 3)) { const d = wordDist(m[1], name.slice(1)); if (d <= 2) consider(name, d + 0.5); }
    }
    if (!best.size) return null;
    const ranked = [...best].sort((a, b) => a[1] - b[1]);
    const [first, second] = ranked;
    // 1등이 정확(0)이거나 2등보다 확실히 가까울 때만 그 사람. 아니면 애매.
    const margin = first[1] === 0 || first[1] === 0.5 ? 1 : 1.5;
    if (!second || second[1] - first[1] >= margin) return { name: first[0] };
    return { ambiguous: ranked.filter(([, d]) => d - first[1] < margin).map(([n]) => n) };
}

export function tagNameCalls(text, roster) {
    return text.split('\n').map(line => {
        const c = nameCall(line, roster);
        return !c ? line : c.name ? `${line} ⟪호명: ${c.name}⟫` : `${line} ⟪호명?: ${c.ambiguous.join('/')}⟫`;
    }).join('\n');
}

// 문장에 나온 명단 이름. 받아쓰기가 이름을 잘못 듣는 경우(정찬호→정찬화)를 위해 성이 같고 한 글자만 다른 세 글자도 인정.
// "선희 선생님", "찬화님"처럼 이름 두 글자 + 호칭도 인정. "김선생" 같은 호칭 자체는 이름으로 보지 않는다.
export function findNames(text, roster) {
    const found = new Set();
    const hangul = text.replace(/[^가-힣]/g, ' ');
    for (const name of roster) {
        if (name.length < 2) continue;
        if (text.includes(name)) { found.add(name); continue; }
        const given = name.slice(1);
        if (given.length >= 2 && new RegExp(`${given}\\s*(님|선생|씨|야|아)`).test(text)) { found.add(name); continue; }
        if (name.length !== 3) continue;
        for (const w of hangul.match(/[가-힣]{3,}/g) || []) {
            for (let i = 0; i + 3 <= w.length; i++) {
                const t = w.slice(i, i + 3);
                if (t[0] !== name[0] || t.endsWith('생') || t.includes('선생')) continue;
                if ([...t].filter((c, k) => c !== name[k]).length === 1) { found.add(name); break; }
            }
        }
    }
    return [...found];
}

// 코치가 이름 하나를 부른 줄 → 그 뒤 12초 안에 처음 말한 코치 아닌 목소리에 그 이름 1표.
// 수강생 목소리가 "저는 ○○○" 하고 자기 이름을 말해도 1표. 표가 모이면 그 목소리 = 그 사람.
export function voteNames(lines, coach, roster, windowSec = 12) {
    const votes = new Map(); // speaker → Map(name → count)
    const add = (spk, name) => {
        if (spk == null || spk === coach) return;
        const m = votes.get(spk) || new Map(); m.set(name, (m.get(name) || 0) + 1); votes.set(spk, m);
    };
    lines.forEach((l, i) => {
        const names = findNames(l.text, roster);
        if (names.length !== 1) return;
        if (l.speaker !== coach) { if (/(저는|제가|나는)/.test(l.text)) add(l.speaker, names[0]); return; }
        const reply = lines.slice(i + 1).find(n => n.start - l.end <= windowSec && n.speaker != null && n.speaker !== coach);
        if (reply && reply.start - l.end <= windowSec) add(reply.speaker, names[0]);
    });
    return votes;
}

// 표 → 목소리별 이름. 2표 이상 + 60% 이상이면 확정, 1표뿐이면 추정(?)으로.
export function decideNames(votes) {
    const out = new Map(); // speaker → { name, votes, sure }
    for (const [spk, m] of votes) {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const [name, n] = [...m].sort((a, b) => b[1] - a[1])[0];
        if (n >= 2 && n / total >= 0.6) out.set(spk, { name, votes: n, sure: true });
        else if (n === 1 && total === 1) out.set(spk, { name, votes: n, sure: false });
    }
    return out;
}

export const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);

// 이름 표가 없는 목소리는 저장된 성문과 비교해 가장 비슷한 사람(유사도 ≥ threshold)으로 추정한다.
// 같은 수업에서 이미 이름이 붙은 사람은 다시 쓰지 않는다.
export function matchVoiceprints(embeddings, voiceprints, named, roster, threshold = 0.6) {
    const taken = new Set([...named.values()].map(v => v.name));
    const out = new Map();
    for (const [spk, emb] of Object.entries(embeddings)) {
        if (named.has(Number(spk)) || named.has(spk)) continue;
        let best = null, sim = threshold;
        for (const [name, vp] of Object.entries(voiceprints)) {
            if (taken.has(name) || !roster.includes(name)) continue;
            const c = cosine(emb, vp.embedding);
            if (c >= sim) { sim = c; best = name; }
        }
        if (best) { out.set(Number(spk), { name: best, similarity: Math.round(sim * 100) / 100, byVoice: true }); taken.add(best); }
    }
    return out;
}

// 이름 표로 확정된 목소리만 성문에 반영(누적 평균). 추정·성문 매칭 결과로는 갱신하지 않는다(틀린 게 굳지 않게).
export function updateVoiceprints(voiceprints, embeddings, named, date) {
    const next = { ...voiceprints };
    for (const [spk, v] of named) {
        const emb = embeddings[String(spk)];
        if (!v.sure || !emb) continue;
        const old = next[v.name];
        const count = (old?.count || 0) + 1;
        const mean = old ? old.embedding.map((x, i) => (x * old.count + emb[i]) / count) : emb;
        const norm = Math.hypot(...mean) || 1;
        next[v.name] = { embedding: mean.map(x => Math.round((x / norm) * 1e5) / 1e5), count, updatedAt: date };
    }
    return next;
}

// 줄마다 [코치] / [이름] / [이름?](추정) / [다른 사람N] 표시
export function renderLabeled(lines, coach, names) {
    const others = new Map();
    return lines.map(l => {
        let label;
        if (l.speaker == null) label = '?';
        else if (l.speaker === coach) label = '코치';
        else if (names.has(l.speaker)) { const v = names.get(l.speaker); label = v.sure ? v.name : `${v.name}?`; }
        else { if (!others.has(l.speaker)) others.set(l.speaker, `다른 사람${others.size + 1}`); label = others.get(l.speaker); }
        return `[${label}] ${l.text}`;
    }).join('\n');
}

// whisper가 조용한 구간에서 같은 줄을 반복하는 환각 제거 (VAD로 대부분 막히지만 남는 것 정리)
export function dropRepeats(text) {
    const out = [];
    for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
        if (out[out.length - 1] !== line) out.push(line);
    }
    return out.join('\n');
}

// ── 대화 구간 (2026-11-16 사용자 요청: A한테 한 말과 B한테 한 말이 섞인다)
// 76분 수업에 정확한 호명이 4번뿐이라, 분석이 이름 없는 대화를 직전에 부른 사람에게 붙이며 섞였다.
// 코드가 호명마다 "그 사람과 나눈 대화"로 볼 줄 범위를 정하고, 제안 항목은 근거 줄이 그 범위 안일 때만 그 사람 것으로 둔다.
// - 앞으로 BEFORE_SEC, 뒤로 AFTER_SEC(같은 사람을 다시 부르면 연장)까지
// - 다른 사람 호명·애매한 호명이 나오면 끊는다
// - 목소리 구분이 있으면: 호명 뒤 처음 대답한 목소리 = 상대. 코치도 상대도 아닌 목소리가 제대로 말하면(1.2초 이상) 끊는다
export const WINDOW = { BEFORE_SEC: 30, AFTER_SEC: 120, PARTNER_SEC: 30, MIN_VOICE_SEC: 1.2 };

export function conversationWindows(lines, roster, coach = null, opt = WINDOW) {
    const calls = lines.map(l => nameCall(l.text, roster));
    const diarized = coach != null && lines.some(l => l.speaker != null);
    const voice = (l) => diarized && l.speaker != null && l.speaker !== coach && l.end - l.start >= opt.MIN_VOICE_SEC ? l.speaker : null;
    const owner = lines.map(() => null);
    const anchors = []; // {name, from, call, to}
    for (let i = 0; i < lines.length; i++) {
        const c = calls[i];
        if (!c?.name) continue;
        const name = c.name;
        let partner = null, last = lines[i].start, to = i;
        for (let j = i + 1; j < lines.length; j++) {
            const cj = calls[j];
            if (cj && cj.name !== name) break;              // 다른 사람·애매한 호명
            if (cj?.name === name) last = lines[j].start;     // 같은 사람 재호명 → 연장
            if (lines[j].start - last > opt.AFTER_SEC) break;
            const v = voice(lines[j]);
            if (v != null) {
                if (partner == null && lines[j].start - lines[i].end <= opt.PARTNER_SEC) partner = v;
                else if (v !== partner) break;               // 다른 목소리가 끼어듦
            }
            to = j;
        }
        let from = i;
        for (let j = i - 1; j >= 0; j--) {
            if (calls[j] || lines[i].start - lines[j].start > opt.BEFORE_SEC) break;
            const v = voice(lines[j]);
            if (v != null && v !== partner) break;
            from = j;
        }
        anchors.push({ name, call: i, from, to });
    }
    for (const a of anchors) {
        for (let k = a.from; k <= a.to; k++) owner[k] = owner[k] && owner[k] !== a.name ? '' : a.name; // 겹치면 주인 없음('')
    }
    return { owner: owner.map(o => o || null), calls, anchors };
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// 분석에 넘길 받아쓰기: 줄 번호(L12) + 목소리 + 호명 표시, 대화 구간이 바뀌는 곳에 구분선.
export function renderForAnalysis(lines, coach, { owner, calls }) {
    const voices = new Map();
    const who = (l) => {
        if (coach == null || l.speaker == null) return '';
        if (l.speaker === coach) return '[코치] ';
        if (!voices.has(l.speaker)) voices.set(l.speaker, `목소리${voices.size + 1}`);
        return `[${voices.get(l.speaker)}] `;
    };
    const out = [];
    lines.forEach((l, i) => {
        if (i === 0 || owner[i] !== owner[i - 1]) out.push(owner[i] ? `──── ${owner[i]}님과의 대화 ────` : '──── 호명 없는 구간 (누구 얘기인지 모름) ────');
        const c = calls[i];
        const tag = !c ? '' : c.name ? ` ⟪호명: ${c.name}⟫` : ` ⟪호명?: ${c.ambiguous.join('/')}⟫`;
        out.push(`L${i + 1} ${mmss(l.start)} ${who(l)}${l.text}${tag}`);
    });
    return out.join('\n');
}

// 분석 결과를 대화 구간으로 검사한다. 근거 줄(refs, L번호)이 모두 그 사람 대화 안에 있는 항목만 그 사람 것으로 두고,
// 아니면 ❓ 누군지 모르는 메모(uncertain)로 보낸다 — 코치가 이름을 고른다. 코치 전용 메모 최종본도 여기서 만든다
// (분석이 준 바꿀 줄만 적용하므로 관련 없는 기존 줄은 그대로).
export function enforceWindows(parsed, { lines, owner, anchors, names, baseNotes }) {
    const refsOf = (x) => (Array.isArray(x?.refs) ? x.refs : []).map(r => Number(String(r).replace(/^L/i, '')) - 1)
        .filter(k => Number.isInteger(k) && k >= 0 && k < lines.length);
    const inWindow = (name, x) => { const r = refsOf(x); return r.length > 0 && r.every(k => owner[k] === name); };
    const quote = (k) => `L${k + 1} ${lines[k].text}`;
    const uncertain = [...(parsed.uncertain || [])];
    const moveOut = (name, text, x) => {
        const r = refsOf(x);
        const others = [...new Set(r.map(k => owner[k]).filter(o => o && o !== name))];
        uncertain.push({
            line: text, candidates: [name, ...others].filter(n => names.includes(n)),
            why: `${r.length ? r.map(quote).join(' / ') : '근거 줄 없음'} — ${name}님 호명 대화 밖이라 누구 얘기인지 확실하지 않음`,
        });
    };
    const students = [];
    for (const s of parsed.students || []) {
        if (!names.includes(s.name)) continue;
        const used = new Set();
        const checklist = [];
        for (const c of s.checklist || []) {
            if (inWindow(s.name, c)) { checklist.push(c); refsOf(c).forEach(k => used.add(k)); }
            else moveOut(s.name, c.exercise ? `${c.exercise} — ${c.text}` : c.text, c);
        }
        const base = baseNotes?.[s.name] ?? '';
        const next = base ? base.split('\n') : [], removed = [];
        let changed = false;
        for (const ch of s.coachNote?.changes || []) {
            const line = String(ch.line ?? '').trim();
            if (!inWindow(s.name, ch)) { if (line) moveOut(s.name, line, ch); continue; }
            refsOf(ch).forEach(k => used.add(k));
            const at = ch.replaces ? next.findIndex(l => l.trim() === String(ch.replaces).trim()) : -1;
            if (at >= 0) { removed.push(next[at].trim()); if (line) next[at] = line; else next.splice(at, 1); changed = true; }
            else if (line && !next.some(l => l.trim() === line)) { next.push(line); changed = true; }
        }
        const coachNote = changed ? { proposed: next.join('\n').trimEnd(), removed } : null;
        if (!coachNote && !checklist.length) continue;
        const calls = anchors.filter(a => a.name === s.name && [...used].some(k => k >= a.from && k <= a.to)).map(a => a.call);
        const evidence = [...new Set([...calls, ...[...used].sort((a, b) => a - b)])].slice(0, 6).map(quote);
        students.push({ name: s.name, guessed: false, evidence, coachNote, checklist });
    }
    return { students, uncertain: uncertain.slice(0, 10) };
}
