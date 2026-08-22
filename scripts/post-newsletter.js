/**
 * 뉴스레터(칼럼) 게시 스크립트
 *
 * 사용법:
 *   node --env-file=.env scripts/post-newsletter.js <원고.md> [--dry-run]
 *   node --env-file=.env scripts/post-newsletter.js --list      # 이미 올린 칼럼 제목 확인(중복 방지)
 *
 * 원고.md 형식: 1행 = 게시판에 올릴 제목, 2행부터 = 노션에서 그대로 복사한 마크다운 본문.
 *   - `## 소제목` → `■ 소제목`, `- 항목` → `· 항목` 로 바꾼다 (게시판 본문은 마크다운을 렌더하지 않는다).
 *   - `> 📷 사진 생성 프롬프트: …` 같은 내부용 줄은 지운다.
 *   - `![](…)` 중 첫 장만 대표 이미지로 Cloudinary에 재업로드한다
 *     (노션 이미지 URL은 S3 서명 URL이라 5분 뒤 만료 → 그대로 저장하면 안 된다).
 *
 * ※ 반드시 백관장 승인 후 실행할 것 (CLAUDE.md '업데이트 공지 규칙'과 같은 절차).
 */
// Firestore 접근은 post-update-notice.js와 같은 이유로 REST + 서비스 계정을 쓴다
// (클라이언트 SDK는 규칙 잠금으로 막히고, Admin SDK의 gRPC는 일부 네트워크에서 무한 대기).
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GoogleAuth } from 'google-auth-library';

const TITLE_MAX = 100;   // src/data/boardConstants.js POST_LIMITS 와 맞출 것
const CONTENT_MAX = 5000;

/**
 * 노션 마크다운 원고 → 게시판 본문(순수 텍스트) + 이미지 URL 목록.
 * 게시판은 content를 white-space:pre-wrap 로 그냥 뿌리므로 마크다운 기호가 그대로 노출된다.
 */
export function cleanNewsletter(markdown) {
    const images = [];
    const lines = [];

    for (let line of markdown.split('\n')) {
        // 이미지: URL만 걷어가고 줄은 버린다 (본문 중간 삽입은 게시판이 지원하지 않음)
        const img = line.match(/!\[[^\]]*\]\(([^)]+)\)/);
        if (img) {
            images.push(img[1]);
            continue;
        }
        // 내부용 사진 생성 프롬프트 줄 제거
        if (/^\s*>?\s*📷/.test(line) || /사진 생성 프롬프트/.test(line)) continue;

        // 노션 원문엔 소제목 앞 빈 줄이 없어 게시판에선 앞 문단에 붙어 보인다
        if (/^\s*#{1,6}\s+/.test(line) && lines.length && lines.at(-1) !== '') lines.push('');

        line = line
            .replace(/^\s*#{1,6}\s+/, '■ ')        // 제목 → ■
            .replace(/^\s*>\s?/, '')                // 인용 마커 제거
            .replace(/^(\s*)[-*+]\s+/, '$1· ')      // 불릿 → ·
            .replace(/\*\*(.+?)\*\*/g, '$1')        // 굵게 마커 제거
            .replace(/\\([[\]*_`~])/g, '$1');       // 마크다운 이스케이프 해제

        lines.push(line.trimEnd());
    }

    const content = lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')                 // 빈 줄 3개 이상 → 2개
        .trim();

    return { content, images };
}

/** 게시 직전 안전장치 — 내부용 문구가 새어나가거나 앱이 못 여는 글이 만들어지는 것을 막는다. */
export function assertPostable(title, content) {
    if (!title) throw new Error('제목이 비었습니다 (원고 1행).');
    if (!content) throw new Error('본문이 비었습니다 (원고 2행부터).');
    if (title.length > TITLE_MAX) throw new Error(`제목이 ${title.length}자입니다 (최대 ${TITLE_MAX}자).`);
    if (content.length > CONTENT_MAX) throw new Error(`본문이 ${content.length}자입니다 (최대 ${CONTENT_MAX}자).`);
    if (/사진 생성 프롬프트|!\[|\]\(http/.test(content)) {
        throw new Error('본문에 내부용 문구 또는 마크다운 이미지가 남아 있습니다.');
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const listOnly = args.includes('--list');
    const [file] = args.filter(a => !a.startsWith('--'));

    if (!file && !listOnly) {
        console.error('사용법: node --env-file=.env scripts/post-newsletter.js <원고.md> [--dry-run]');
        console.error('       node --env-file=.env scripts/post-newsletter.js --list');
        process.exit(1);
    }

    const require = createRequire(import.meta.url);
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

    const api = async (url, method, body) => {
        const res = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`${method} ${res.status}: ${await res.text()}`);
        return res.json();
    };

    const postedTitles = async () => {
        const rows = await api(`${BASE}:runQuery`, 'POST', {
            structuredQuery: {
                from: [{ collectionId: 'posts' }],
                where: { fieldFilter: { field: { fieldPath: 'category' }, op: 'EQUAL', value: { stringValue: 'column' } } },
            },
        });
        return rows
            .filter(r => r.document && !r.document.fields?.deleted?.booleanValue)
            .map(r => ({
                title: r.document.fields?.title?.stringValue ?? '(제목 없음)',
                at: r.document.fields?.createdAt?.timestampValue?.slice(0, 10) ?? '',
            }))
            .sort((a, b) => a.at.localeCompare(b.at));
    };

    if (listOnly) {
        const posted = await postedTitles();
        console.log(posted.length ? `이미 올린 칼럼 ${posted.length}건:` : '아직 올린 칼럼이 없습니다.');
        for (const p of posted) console.log(`  ${p.at}  ${p.title}`);
        process.exit(0);
    }

    const raw = readFileSync(file, 'utf-8');
    const nl = raw.indexOf('\n');
    const title = raw.slice(0, nl === -1 ? undefined : nl).trim();
    const { content, images } = cleanNewsletter(nl === -1 ? '' : raw.slice(nl + 1));
    assertPostable(title, content);

    if ((await postedTitles()).some(p => p.title === title)) {
        console.error(`이미 같은 제목의 칼럼이 있습니다: "${title}"`);
        process.exit(1);
    }

    // 대표 이미지 1장만 Cloudinary로 옮긴다 (노션 서명 URL은 곧 만료된다)
    let cover = null;
    if (images.length) {
        const cloud = process.env.VITE_CLOUDINARY_CLOUD_NAME;
        const preset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;
        if (!cloud || !preset) throw new Error('Cloudinary 환경변수 없음 — node --env-file=.env 로 실행하세요.');

        const src = await fetch(images[0]);
        if (!src.ok) throw new Error(`노션 이미지를 못 받았습니다 (${src.status}). 서명 URL이 만료됐을 수 있습니다.`);

        const form = new FormData();
        form.append('file', await src.blob(), 'cover.png');
        form.append('upload_preset', preset);
        form.append('folder', 'board');
        const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
        const data = await up.json();
        if (!up.ok) throw new Error(`Cloudinary 업로드 실패: ${data?.error?.message}`);
        cover = { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height };
    }

    if (dryRun) {
        console.log(`[dry-run] 제목: ${title}`);
        console.log(`[dry-run] 본문 ${content.length}자, 노션 이미지 ${images.length}장 중 대표 ${cover ? 1 : 0}장`);
        if (cover) console.log(`[dry-run] 대표 이미지: ${cover.url}`);
        console.log('---');
        console.log(content);
        console.log('---');
        process.exit(0);
    }

    const str = v => ({ stringValue: v });
    const now = new Date();
    const created = await api(`${BASE}/posts`, 'POST', {
        fields: {
            title: str(title),
            content: str(content),
            category: str('column'),
            author: str('백관장'),
            isCoach: { booleanValue: true },
            pinned: { booleanValue: false },   // 상단 고정은 업데이트 공지 몫이다
            images: {
                arrayValue: {
                    values: cover
                        ? [{ mapValue: { fields: {
                            url: str(cover.url),
                            publicId: str(cover.publicId),
                            width: { integerValue: String(cover.width) },
                            height: { integerValue: String(cover.height) },
                        } } }]
                        : [],
                },
            },
            likes: { arrayValue: { values: [] } },
            commentCount: { integerValue: '0' },
            deleted: { booleanValue: false },
            createdAt: { timestampValue: now.toISOString() },
            updatedAt: { timestampValue: now.toISOString() },
        },
    });
    console.log(`✅ 칼럼 게시 완료: "${title}" (${created.name.split('/').pop()})`);
    process.exit(0);
}
