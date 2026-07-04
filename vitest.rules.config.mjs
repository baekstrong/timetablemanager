import { defineConfig } from 'vitest/config';

// 에뮬레이터 전용 — firestore.rules.test.mjs만 실행 (일반 npm test와 분리).
// 실행: JAVA_HOME=... npx firebase emulators:exec --only firestore --project demo-strength \
//         "npx vitest run --config vitest.rules.config.mjs"
export default defineConfig({
  test: {
    include: ['firestore.rules.test.mjs'],
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
