#!/usr/bin/env node
/**
 * 보강 대기 '원래 수업 1시간 전' 선택 알림 (2026-10-30 사용자 요청).
 *
 * 보강 대기가 걸린 원래 수업이 1시간 안에 시작하면 그 수강생에게 앱 푸시를 보낸다.
 * 앱 '내 수업'에서 [원래 수업 빠지고 대기 유지]를 고르면 원래 수업은 결석 처리되고 대기가 유지된다.
 * 아무것도 안 고르면 원래 수업 시작 때 대기가 자동 취소된다(앱 로직).
 *
 * 실행: GitHub Actions 예약(.github/workflows/makeup-wait-choice.yml, 평일 10분마다).
 * Netlify 함수가 아닌 이유: Netlify는 수동 드롭 배포라 예약 함수 추가가 번거롭다.
 * 의존성 없이 돈다(npm ci 생략) — 서비스 계정 JWT를 node:crypto로 직접 서명한다.
 *
 *   node scripts/makeup-wait-choice-push.mjs --dry-run    # 보낼 대상만 출력, 아무것도 안 씀
 *   node scripts/makeup-wait-choice-push.mjs --validate   # FCM validate_only (실제 발송 없음), 기록 안 함
 *
 * 문자 폴백은 없다 — 못 받아도 기본값(원래 수업 출석)이 안전하고, 문자비를 쓸 만한 알림이 아니다.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PERIODS } from '../src/data/mockData.js';

const WINDOW_MIN = 70; // 예약 실행이 10분마다 + 지연이 있어 1시간보다 조금 넓게 본다
const dryRun = process.argv.includes('--dry-run');
const validateOnly = process.argv.includes('--validate');

// 테스트가 순수 함수만 import할 수 있게 키는 실행 시점에 읽는다.
let key;
let BASE;

const b64url = (v) => Buffer.from(v).toString('base64url');
async function accessToken(scope) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    });
    if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}: ${await res.text()}`);
    return (await res.json()).access_token;
}

const plain = (v) => {
    if (!v) return v;
    const [k] = Object.keys(v);
    if (k === 'mapValue') return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([a, b]) => [a, plain(b)]));
    if (k === 'arrayValue') return (v.arrayValue.values || []).map(plain);
    if (k === 'integerValue') return Number(v.integerValue);
    if (k === 'nullValue') return null;
    return v[k];
};

/** 'YYYY-MM-DD' + 교시 → 한국시간 수업 시작 Date (Actions는 UTC에서 돈다) */
export function classStartKST(date, period) {
    const p = PERIODS.find(x => x.id === Number(period));
    if (!date || !p) return null;
    const hh = String(p.startHour).padStart(2, '0');
    const mm = String(p.startMinute).padStart(2, '0');
    return new Date(`${date}T${hh}:${mm}:00+09:00`);
}

/** 알림 대상: 원래 수업이 WINDOW 안에 시작 + 보강 수업보다 먼저 + 아직 안 고름 + 아직 안 보냄 */
export function needsChoicePrompt(entry, now = new Date()) {
    if (!['waiting', 'notified'].includes(entry.status)) return false;
    if (entry.keepAfterOriginal || entry.choicePromptAt) return false;
    const original = classStartKST(entry.originalClass?.date, entry.originalClass?.period);
    const target = classStartKST(entry.date, entry.period);
    if (!original || !target || original >= target) return false;
    const minutes = (original - now) / 60000;
    return minutes > 0 && minutes <= WINDOW_MIN;
}

const DAY = ['일', '월', '화', '수', '목', '금', '토'];
// 날짜 문자열의 달력 요일 — 정오 UTC로 읽으면 실행 환경 시간대와 무관하다
const label = (date, period) =>
    `${Number(date.slice(5, 7))}/${Number(date.slice(8))}(${DAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}) ${period}교시`;

async function main() {
    key = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'firebase-admin-key.json'), 'utf8'));
    BASE = `https://firestore.googleapis.com/v1/projects/${key.project_id}/databases/(default)/documents`;
    const fsToken = await accessToken('https://www.googleapis.com/auth/datastore');
    const fsHeaders = { Authorization: `Bearer ${fsToken}`, 'Content-Type': 'application/json' };
    const res = await fetch(`${BASE}:runQuery`, {
        method: 'POST', headers: fsHeaders,
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'makeupWaitlists' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN', value: { arrayValue: { values: [{ stringValue: 'waiting' }, { stringValue: 'notified' }] } } } } } }),
    });
    if (!res.ok) throw new Error(`대기 조회 실패 ${res.status}: ${await res.text()}`);
    const now = new Date();
    const targets = (await res.json()).filter(r => r.document)
        .map(r => ({ id: r.document.name.split('/').pop(), ...plain({ mapValue: { fields: r.document.fields } }) }))
        .filter(e => needsChoicePrompt(e, now));
    console.log(`대상 ${targets.length}건`);
    if (!targets.length || dryRun) { targets.forEach(e => console.log('-', e.studentName, label(e.originalClass.date, e.originalClass.period), '→', label(e.date, e.period))); return; }

    const fcmToken = await accessToken('https://www.googleapis.com/auth/firebase.messaging');
    for (const e of targets) {
        const user = await (await fetch(`${BASE}/users/${encodeURIComponent(e.studentName)}`, { headers: fsHeaders })).json();
        const token = user?.fields?.fcmToken?.stringValue;
        let sent = false;
        if (token) {
            const send = await fetch(`https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${fcmToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    validate_only: validateOnly,
                    message: {
                        token,
                        data: {
                            title: `1시간 후 ${label(e.originalClass.date, e.originalClass.period)} 수업이에요`,
                            body: `${label(e.date, e.period)} 보강 대기 중이에요. 원래 수업을 빠지고 대기를 유지하려면 앱에서 선택해주세요. 선택하지 않으면 수업 시작 때 대기가 취소돼요.`,
                            tag: `makeup-choice-${e.id}`,
                            url: './?page=schedule',
                        },
                        webpush: { headers: { Urgency: 'high', TTL: '3600' } },
                    },
                }),
            });
            sent = send.ok;
            if (!send.ok) console.warn(`발송 실패 ${e.studentName} ${send.status}: ${(await send.text()).slice(0, 200)}`);
        }
        console.log(`${e.studentName} ${label(e.originalClass.date, e.originalClass.period)} → ${token ? (sent ? (validateOnly ? '검증 통과' : '발송') : '실패') : '알림 미설정'}`);
        if (validateOnly) continue;
        // 보냈든 못 보냈든 한 번만 시도한다(10분마다 같은 대기에 반복 발송 방지).
        await fetch(`${BASE}/makeupWaitlists/${e.id}?updateMask.fieldPaths=choicePromptAt&updateMask.fieldPaths=choicePromptSent`, {
            method: 'PATCH', headers: fsHeaders,
            body: JSON.stringify({ fields: { choicePromptAt: { timestampValue: new Date().toISOString() }, choicePromptSent: { booleanValue: sent } } }),
        });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(err => { console.error(err); process.exit(1); });
}
