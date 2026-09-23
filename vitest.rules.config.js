import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['firestore.security.rest.test.mjs'],
        fileParallelism: false,
        hookTimeout: 30000,
        testTimeout: 15000,
    },
});
