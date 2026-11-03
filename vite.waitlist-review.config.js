// 신규 대기 로컬 목업 전용 dev 서버 설정 (배포 빌드에 쓰지 않는다).
// 서비스 모듈의 네트워크 함수만 메모리 예시 데이터로 바꾸고 나머지(순수 함수)는 실제 코드를 쓴다.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(root, 'src/preview/waitlist/fixtures.js');
const OVERRIDES = {
    'src/services/recruitmentService.js': ['getRecruitmentOverview', 'getRecruitmentMonths', 'assertRecruitmentOpen', 'saveRecruitmentMonth', 'submitMonthWaitlist', 'submitRecruitmentRegistration', 'addCoachWaitlist'],
    'src/services/smsService.js': ['getSmsSettings', 'sendRegistrationNotifications', 'sendWaitlistAvailableSMS', 'sendWaitlistCancelledSMS', 'sendStudentRegistrationSMS'],
    'src/services/firebaseService.js': ['getDisabledClasses', 'getFAQs', 'getNewStudentRegistrations', 'updateNewStudentRegistration', 'getEntranceClasses', 'getHolidays', 'deleteNewStudentRegistration', 'updateWaitlistRequestedSlots'],
    'src/services/consultationService.js': ['getConsultations'],
};

function waitlistFixtures() {
    return {
        name: 'waitlist-review-fixtures',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            if (source.includes('?real') || !importer || importer.startsWith('\0')) return null;
            const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
            if (!resolved) return null;
            const rel = path.relative(root, resolved.id.split('?')[0]);
            if (rel === 'src/config/firebase.js') return '\0wl-firebase';
            if (OVERRIDES[rel]) return `\0wl-wrap:${rel}`;
            return null;
        },
        load(id) {
            // Firebase를 초기화하지 않는다 — 실제 운영 데이터에 닿을 길을 없앤다.
            if (id === '\0wl-firebase') return 'export const db = null; export const auth = null; export default null;';
            if (!id.startsWith('\0wl-wrap:')) return null;
            const rel = id.slice('\0wl-wrap:'.length);
            return `export * from ${JSON.stringify(path.join(root, rel) + '?real')};\nexport { ${OVERRIDES[rel].join(', ')} } from ${JSON.stringify(fixtures)};`;
        },
    };
}

export default defineConfig({
    plugins: [waitlistFixtures(), react()],
    base: '/timetablemanager/',
});
