// auth 함수를 자체완결 번들로 빌드 (firebase-admin 인라인 + Firebase 자격증명 임베드).
// Netlify Lambda 4KB 환경변수 한도 때문에 FIREBASE_ADMIN_* 를 env로 못 둠 → 번들에 구워넣는다.
// 자격증명은 루트의 gitignore된 firebase-admin-key.json 에서 빌드시 주입(esbuild --define).
// 출력물(auth.js)에는 비공개 키가 들어있으므로 git 커밋·공유 금지(서버 배포 전용).
//
// 실행: node scripts/build-auth-bundle.cjs [출력경로]
//   기본 출력: ../netlify-deploy/netlify/functions/auth.js
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, '..', 'firebase-admin-key.json');
if (!fs.existsSync(keyPath)) {
  console.error('❌ firebase-admin-key.json 없음 (루트에 두세요)');
  process.exit(1);
}
const k = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

const outfile = process.argv[2]
  || path.join(__dirname, '..', '..', 'netlify-deploy', 'netlify', 'functions', 'auth.js');

esbuild.build({
  entryPoints: [path.join(__dirname, '..', 'netlify', 'functions', 'auth.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  define: {
    'process.env.FIREBASE_ADMIN_PROJECT_ID': JSON.stringify(k.project_id),
    'process.env.FIREBASE_ADMIN_CLIENT_EMAIL': JSON.stringify(k.client_email),
    'process.env.FIREBASE_ADMIN_PRIVATE_KEY': JSON.stringify(k.private_key),
  },
}).then(() => {
  const bytes = fs.statSync(outfile).size;
  console.log(`✅ built ${outfile} (${(bytes / 1024 / 1024).toFixed(1)}mb, 자격증명 임베드)`);
}).catch((e) => { console.error(e); process.exit(1); });
