// Enhanced Mock Data with Start/End Dates and Holding Features
export const PERIODS = [
    { id: 1, name: '1교시', time: '10:00 ~ 11:30', startHour: 10, startMinute: 0 },
    { id: 2, name: '2교시', time: '12:00 ~ 13:30', startHour: 12, startMinute: 0 },
    { id: 3, name: '3교시(자율)', time: '15:00 ~ 17:00', type: 'free', startHour: 15, startMinute: 0 },
    { id: 4, name: '4교시', time: '18:00 ~ 19:30', startHour: 18, startMinute: 0 },
    { id: 5, name: '5교시', time: '19:50 ~ 21:20', startHour: 19, startMinute: 50 },
    { id: 6, name: '6교시', time: '21:40 ~ 23:10', startHour: 21, startMinute: 40 },
];

export const DAYS = ['월', '화', '수', '목', '금'];

// Max capacity per slot setup
export const MAX_CAPACITY = 7;

// Student Membership Information
export const STUDENT_MEMBERSHIPS = [
    {
        studentName: '과정원',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        daysRemaining: 22,
        totalHoldingDays: 0
    },
    {
        studentName: '박신호',
        startDate: '2026-01-05',
        endDate: '2026-02-04',
        daysRemaining: 26,
        totalHoldingDays: 0
    },
    {
        studentName: '김선영',
        startDate: '2025-12-20',
        endDate: '2026-01-19',
        daysRemaining: 10,
        totalHoldingDays: 2
    },
    {
        studentName: '원유경',
        startDate: '2026-01-03',
        endDate: '2026-02-02',
        daysRemaining: 24,
        totalHoldingDays: 0
    },
    {
        studentName: '심성희',
        startDate: '2026-01-10',
        endDate: '2026-02-09',
        daysRemaining: 31,
        totalHoldingDays: 0
    },
    {
        studentName: '현주은',
        startDate: '2025-12-25',
        endDate: '2026-01-24',
        daysRemaining: 15,
        totalHoldingDays: 1
    },
    {
        studentName: '유인형',
        startDate: '2026-01-08',
        endDate: '2026-02-07',
        daysRemaining: 29,
        totalHoldingDays: 0
    }
];

// Mock Database replicating Google Sheets structure
export const MOCK_DATA = {
    // Regular Enrolled Students (Fixed Schedule)
    regularEnrollments: [
        { day: '월', period: 1, names: ['김용재', '한혜정', '김혜민', '정승민', '조미경'] },
        { day: '수', period: 1, names: ['김용재', '한혜정', '조미경'] },
        { day: '금', period: 1, names: ['김용재', '한혜민', '정승민'] },

        { day: '화', period: 2, names: ['과정원', '박신호', '김선영', '원유경'] },
        { day: '목', period: 2, names: ['박신호', '곽정원', '장현석', '김선영', '원유경'] },

        { day: '화', period: 4, names: ['심성희', '현주은', '유인형', '김혜숙'] },
        { day: '수', period: 4, names: ['황지원', '유인형', '최시율'] },
        { day: '목', period: 4, names: ['전예은', '김혜숙', '이장한', '정승호', '유인형', '현주은'] },
        { day: '금', period: 4, names: ['현주은', '유인형', '송태규', '이재호', '정승호'] },

        { day: '화', period: 5, names: ['이종호', '박예은', '김지인', '강성준', '송태규', '이슬아', '김기산', '김어람'] },
        { day: '수', period: 5, names: ['이종호', '김지인', '강성준', '송태규', '박태호', '강성준', '김기산', '송재덤'] },
        { day: '목', period: 5, names: ['이종호', '김현정', '박예은', '강성준', '송태규', '박태호', '강성준', '김수미'] },
        { day: '금', period: 5, names: ['이종호', '김현정', '김지인', '강성준', '김어람', '서동현', '이상덕', '류채림'] },

        { day: '월', period: 6, names: ['서동현', '이상덕', '남연우', '김규연', '손수민', '박다솜'] },
        { day: '수', period: 6, names: ['김규연', '이세류', '박다솜'] },
        { day: '목', period: 6, names: ['김규연', '서동현', '박다솜'] },
        { day: '금', period: 6, names: ['김규연', '서동현', '박다솜'] },
    ],

    // Temporary Holds (Absence) - Creates an empty spot
    holds: [
        { date: '2026-01-13', day: '월', period: 6, name: '손수민', reason: '병원' },
        { date: '2026-01-14', day: '화', period: 2, name: '김선영', reason: '여행' },
        { date: '2026-01-15', day: '수', period: 4, name: '유인형', reason: '개인사정' },
    ],

    // One-time Substitutes (Filling the empty spots)
    substitutes: [
        { date: '2026-01-13', day: '월', period: 6, name: '류채림', originalStudent: '손수민' },
        { date: '2026-01-15', day: '수', period: 4, name: '송태규', originalStudent: '유인형' },
    ]
};

// Pricing constants for new student registration
export const PRICING = [
    { frequency: 4, baseCost: 450000, totalWithEntrance: 530000, label: '주4회' },
    { frequency: 3, baseCost: 390000, totalWithEntrance: 470000, label: '주3회' },
    { frequency: 2, baseCost: 310000, totalWithEntrance: 390000, label: '주2회' },
];
export const ENTRANCE_FEE = 80000;

// Helper function to calculate days remaining
export const calculateDaysRemaining = (endDate) => {
    const today = new Date('2026-01-09'); // Current date for simulation
    const end = new Date(endDate);
    const diffTime = end - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
};

// Helper function to check if membership is expiring soon (within 7 days)
export const isExpiringSoon = (daysRemaining) => {
    return daysRemaining > 0 && daysRemaining <= 7;
};

// Helper function to check if membership is expired
export const isExpired = (daysRemaining) => {
    return daysRemaining <= 0;
};
