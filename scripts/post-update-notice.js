/**
 * 관리자봇 업데이트 공지 게시 스크립트
 *
 * 사용법: node scripts/post-update-notice.js "제목" "본문" [--unpin-old | --add] [--dry-run]
 *         (루트에 firebase-admin-key.json 필요 — 서비스 계정으로 실행하므로 .env 불필요)
 *
 * 동작:
 * 1. 기존 author='관리자봇' 공지 처리 (택1)
 *    - (기본)        소프트 삭제 → 게시판에서 사라짐, 최신 1건만 유지
 *    - --unpin-old   고정만 해제(pinned:false) → 글·notice 카테고리 유지, 상단 고정에서만 내림 (권장·백관장 선호)
 *    - --add         아무것도 안 함, 1건 추가만
 * 2. 새 공지를 notice 카테고리로 등록 (앱의 createPost와 동일 스키마)
 *
 * ※ 반드시 백관장 승인 후 실행할 것 (CLAUDE.md '업데이트 공지 규칙' 참고)
 */
// 2026-07 규칙 잠금(signedIn 필수) 이후 클라이언트 SDK로는 posts 쓰기가 막힌다 → 서비스 계정.
// Admin SDK 대신 Firestore REST를 직접 쓴다: SDK의 스트리밍 RPC(runQuery 등)가 gRPC라
// 일부 네트워크에서 무한 대기한다. REST는 같은 환경에서 정상 동작.
// ponytail: fetch 3개(runQuery/PATCH/POST)면 끝나는 일에 전송 계층 디버깅을 붙이지 않는다.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GoogleAuth } from 'google-auth-library';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const addOnly = args.includes('--add');        // 기존 공지 그대로, 1건만 추가
const unpinOld = args.includes('--unpin-old'); // 기존 공지 고정만 해제(삭제 X), 그 후 1건 추가
const dryRun = args.includes('--dry-run');     // 아무것도 쓰지 않고 무엇을 할지만 출력
const [title, content] = args.filter(a => !a.startsWith('--'));
if (!title || !content) {
    console.error('사용법: node scripts/post-update-notice.js "제목" "본문" [--unpin-old | --add] [--dry-run]');
    process.exit(1);
}

const keyPath = path.join(import.meta.dirname, '..', 'firebase-admin-key.json');
if (!existsSync(keyPath)) {
    console.error(`서비스 계정 키가 없습니다: ${keyPath}`);
    process.exit(1);
}
const projectId = require(keyPath).project_id;

const auth = new GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/datastore'] });
const client = await auth.getClient();
const { token } = await client.getAccessToken();
const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function api(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${res.status}: ${await res.text()}`);
    return res.json();
}

// REST는 타입 태그가 붙은 값을 요구한다 (문서 읽을 때도 같은 형태로 돌아옴)
const str = (v) => ({ stringValue: v });
const bool = (v) => ({ booleanValue: v });
const ts = (d) => ({ timestampValue: d.toISOString() });
const now = new Date();

// 1. 기존 관리자봇 공지 처리 (--add 면 건너뜀)
// (isUpdateNotice 필드로 거르지 않음 — 앱에서 직접 작성한 예전 관리자봇 공지에는
//  이 필드가 없어 안 내려가는 문제가 있었음. 관리자봇 글은 항상 최신 1건만 유지한다.)
if (addOnly) {
    console.log('--add: 기존 공지를 그대로 두고 1건만 추가합니다.');
} else {
    const rows = await api(`${BASE}:runQuery`, 'POST', {
        structuredQuery: {
            from: [{ collectionId: 'posts' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'author' },
                    op: 'EQUAL',
                    value: str('관리자봇'),
                },
            },
        },
    });

    for (const row of rows) {
        if (!row.document) continue;
        const f = row.document.fields || {};
        const id = row.document.name.split('/').pop();
        if (f.deleted?.booleanValue) continue;

        if (unpinOld) {
            // 삭제하지 않고 상단 고정만 해제 → 글·notice 카테고리는 유지되어 게시판에 계속 보임
            if (f.category?.stringValue === 'notice' && f.pinned?.booleanValue === true) {
                if (!dryRun) {
                    await api(
                        `https://firestore.googleapis.com/v1/${row.document.name}` +
                        `?updateMask.fieldPaths=pinned&updateMask.fieldPaths=updatedAt`,
                        'PATCH',
                        { fields: { pinned: bool(false), updatedAt: ts(now) } },
                    );
                }
                console.log(`${dryRun ? '[dry-run] ' : ''}기존 공지 고정 해제(글 유지): "${f.title?.stringValue}" (${id})`);
            }
        } else {
            if (!dryRun) {
                await api(
                    `https://firestore.googleapis.com/v1/${row.document.name}` +
                    `?updateMask.fieldPaths=deleted&updateMask.fieldPaths=updatedAt`,
                    'PATCH',
                    { fields: { deleted: bool(true), updatedAt: ts(now) } },
                );
            }
            console.log(`${dryRun ? '[dry-run] ' : ''}기존 공지 내림(삭제): "${f.title?.stringValue}" (${id})`);
        }
    }
}

// 2. 새 공지 등록 (PostForm 작성 글과 동일 스키마)
// isCoach: 작성자 이름 하늘색 표시, pinned: 공지 노란 배경 + 상단 고정
const fields = {
    title: str(title),
    content: str(content),
    category: str('notice'),
    author: str('관리자봇'),
    isCoach: bool(true),
    pinned: bool(true),
    isUpdateNotice: bool(true),
    images: { arrayValue: { values: [] } },
    likes: { arrayValue: { values: [] } },
    commentCount: { integerValue: '0' },
    deleted: bool(false),
    createdAt: ts(now),
    updatedAt: ts(now),
};

if (dryRun) {
    console.log(`[dry-run] 새 업데이트 공지 등록 예정: "${title}"`);
    process.exit(0);
}

const created = await api(`${BASE}/posts`, 'POST', { fields });
console.log(`✅ 새 업데이트 공지 등록 완료: "${title}" (${created.name.split('/').pop()})`);
process.exit(0);
