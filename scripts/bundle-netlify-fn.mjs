// Netlify 함수를 드롭 배포용 단일 .cjs로 번들한다.
//
// 왜 필요한가:
//  1) 드롭 배포는 스테이징 폴더의 package.json으로 install하는데 거기엔 firebase-admin이 없다 →
//     의존성을 인라인해야 한다.
//  2) 스테이징 package.json이 "type": "module"이라 .js는 ESM으로 해석된다 → 확장자가 .cjs여야 한다.
//  3) AWS Lambda 환경변수 한도가 4KB인데 개인키 2개(GOOGLE_PRIVATE_KEY 1.7KB +
//     FIREBASE_ADMIN_PRIVATE_KEY 1.7KB)만으로 초과한다 → firebase-admin 자격증명은
//     환경변수 대신 번들에 구워 넣는다(--define). auth.cjs가 이미 같은 방식이다.
//
// ⚠️ 결과물에 서비스 계정 키가 들어 있다. 스테이징 폴더는 git 저장소가 아니어야 하고
//    (2026-08-27 확인) 이 파일을 커밋하거나 공유하면 안 된다.
//    Lambda 호환 모드를 벗어나면 4KB 제한이 없어지므로 그때 --define을 빼고 환경변수로 되돌릴 것.
//
// 사용: node scripts/bundle-netlify-fn.mjs push
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const name = process.argv[2];
if (!name) { console.error('사용: node scripts/bundle-netlify-fn.mjs <함수이름>'); process.exit(1); }

const STAGING = path.join(homedir(), 'Desktop/앱 제작/netlify-deploy/netlify/functions');
const key = JSON.parse(readFileSync('firebase-admin-key.json', 'utf8'));

// firebase-admin을 쓰는 함수만 자격증명을 굽는다.
const NEEDS_ADMIN = ['push', 'auth'];
const define = NEEDS_ADMIN.includes(name) ? {
  'process.env.FIREBASE_ADMIN_PROJECT_ID': JSON.stringify(key.project_id),
  'process.env.FIREBASE_ADMIN_CLIENT_EMAIL': JSON.stringify(key.client_email),
  'process.env.FIREBASE_ADMIN_PRIVATE_KEY': JSON.stringify(key.private_key),
} : {};

const outfile = path.join(STAGING, `${name}.cjs`);
await build({
  entryPoints: [`netlify/functions/${name}.js`],
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  define, outfile,
});
console.log(`✅ ${outfile}`);
console.log(`   자격증명 인라인: ${Object.keys(define).length ? '예' : '아니오'}`);
