export const BOARD_CATEGORIES = [
    { key: 'all', label: '전체', icon: '' },
    { key: 'notice', label: '공지', icon: '📢', coachOnly: true },
    { key: 'free', label: '자유', icon: '💬' },
    { key: 'food', label: '맛집', icon: '🍽️' },
    { key: 'question', label: '질문', icon: '❓' },
];

export const CATEGORY_MAP = Object.fromEntries(
    BOARD_CATEGORIES.filter(c => c.key !== 'all').map(c => [c.key, c])
);

export const POST_LIMITS = {
    TITLE_MAX: 100,
    CONTENT_MAX: 5000,
    COMMENT_MAX: 1000,
    PAGE_SIZE: 20,
};
