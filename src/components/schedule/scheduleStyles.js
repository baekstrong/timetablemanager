// 시간표 컴포넌트들이 공유하는 스타일 상수.

export const TAG_STYLES = {
    // 보강이동: 원래 자리에서 다른 시간으로 이동 (노란 계열, 출석은 함)
    makeupMoved: { backgroundColor: '#fef3c7', color: '#92400e', textDecoration: 'line-through' },
    // 보강결석: 보강 자리에 오기로 했다가 결석 (붉은 계열, 완전히 빠짐)
    makeupAbsent: { backgroundColor: '#fecaca', color: '#991b1b', textDecoration: 'line-through' },
    agreedAbsent: { backgroundColor: '#fce7f3', color: '#be185d', textDecoration: 'line-through' },
    absent: { backgroundColor: '#fecaca', color: '#991b1b', textDecoration: 'line-through' },
    holding: { backgroundColor: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' },
    newStudent: { backgroundColor: '#dbeafe', color: '#1e40af' },
    delayed: { backgroundColor: '#dcfce7', color: '#166534', textDecoration: 'line-through' },
};

export const SECTION_STYLES = {
    lastDay: {
        background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
        border: '1px solid #4ade80',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
    delayedRereg: {
        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        border: '1px solid #f59e0b',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
    waitlist: {
        background: 'linear-gradient(135deg, #fef9c3, #fde047)',
        border: '1px solid #eab308',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
};

export const DELETE_BTN_STYLE = {
    fontSize: '0.75rem',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid #dc2626',
    background: '#fee2e2',
    color: '#dc2626',
    cursor: 'pointer',
    fontWeight: '600',
};
