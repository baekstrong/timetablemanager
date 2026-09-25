import { ReviewTimestamp } from './trainingLogReviewFirebase.js';

export const REVIEW_USER = '리뷰학생';
const localISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const set = (weight, reps, unit = 'kg', repeat = '회', count = '') => ({ intensity: { value: String(weight), unit }, reps: { value: String(reps), unit: repeat, ...(count ? { count: String(count) } : {}) } });

export function createTrainingReviewFixtures(now = new Date()) {
    const today = localISO(now);
    const dateBefore = days => { const date = new Date(now); date.setDate(date.getDate() - days); return localISO(date); };
    const exerciseNames = ['스쿼트', '프론트 스쿼트', '고블릿 스쿼트', '스플릿 스쿼트', '불가리안 스플릿 스쿼트', '데드리프트', '루마니안 데드리프트', '스모 데드리프트', '싱글 레그 데드리프트', '벤치프레스', '덤벨 벤치프레스', '인클라인 벤치프레스', '오버헤드 프레스', '덤벨 숄더 프레스', '바벨 로우', '원암 덤벨 로우', '케이블 로우', '랫 풀다운', '레그 프레스', '레그 컬', '힙 쓰러스트', '케틀벨 스윙', '푸시업', '플랭크', '박스 점프', '호흡 연습'];
    const documents = {
        [`users/${REVIEW_USER}`]: { isCoach: false, xpVolume: 510000, xpCoef: 1, xp: 510000, grade: 'u4', gradeSeen: 'u4' },
        [`pinnedMemos/${REVIEW_USER}`]: { userName: REVIEW_USER, memos: [{ exercise: '스쿼트', memo: '발바닥 전체로 바닥을 밀기', pain: false }] },
        [`coachPinnedMemos/${REVIEW_USER}`]: { memos: [{ exercise: '스쿼트', memo: '무릎과 발끝 방향을 맞춰주세요.' }] },
        [`archivedMemos/${REVIEW_USER}`]: { userName: REVIEW_USER, memos: [] },
        [`oneRMRecords/${REVIEW_USER}`]: { map: {} },
    };
    exerciseNames.forEach((name, index) => { documents[`exercises/exercise-${index + 1}`] = { name }; });
    const examples = [
        [1, '스쿼트', [set(40, 8), set(40, 8), set(40, 7)], '마지막 세트까지 동작이 안정적이었어요.'],
        [3, '스쿼트', [set(40, 8), set(40, 7), set(40, 6)]],
        [6, '스쿼트', [set(37.5, 8), set(37.5, 8), set(37.5, 8)]],
        [1, '데드리프트', [set(50, 6), set(50, 6), set(50, 5)]],
        [6, '데드리프트', [set(45, 8), set(45, 8)]],
        [10, '데드리프트', [set(45, 6), set(45, 6), set(45, 6), set(45, 5)]],
        [1, '푸시업', [set('', 12, '맨몸'), set('', 10, '맨몸'), set('', 8, '맨몸')]],
        [3, '푸시업', [set('', 10, '맨몸'), set('', 8, '맨몸')]],
        [6, '푸시업', [set('', 8, '맨몸'), set('', 8, '맨몸')]],
        [2, '플랭크', [set('', 30, '맨몸', '초'), set('', 25, '맨몸', '초')]],
        [7, '플랭크', [set('', 20, '맨몸', '초 x 회', 3)]],
        [3, '박스 점프', [set('낮은 박스', 8, '높이'), set('중간 박스', 6, '높이')]],
        [7, '호흡 연습', [set('편한 강도', 30, '자율', '초 x 회', 3)]],
        [15, '벤치프레스', [set(30, 8), set(30, 8)]],
        [22, '스쿼트', [set(35, 8), set(35, 8)]],
        [32, '푸시업', [set('', 8, '맨몸')]],
        [39, '데드리프트', [set(40, 8)]],
    ];
    examples.forEach(([days, exercise, sets, feedback = ''], index) => {
        const date = dateBefore(days);
        documents[`records/history-${index + 1}`] = {
            userName: REVIEW_USER, exercise, date, sets, feedback, memo: '', pain: false, order: index,
            timestamp: ReviewTimestamp.fromDate(new Date(`${date}T19:50:00`)), custom: false,
        };
    });
    return { today, documents, exerciseNames };
}
