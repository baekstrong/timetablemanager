// 시간표 컴포넌트들이 공유하는 스타일 상수.

export const TAG_STYLES = {
    // 보강: 다른 시간에서 이 자리로 옴 (코발트 채움)
    makeup: { backgroundColor: '#329BE7', color: '#ffffff', border: '1px solid #327AB8' },
    // 보강이동: 원래 자리에서 다른 시간으로 이동 (caution, 출석은 함)
    makeupMoved: { backgroundColor: '#FAEAC2', color: '#92400e', border: '1px solid #D4A93C', textDecoration: 'line-through' },
    // 보강결석: 보강 자리에 오기로 했다가 결석 (error, 완전히 빠짐)
    makeupAbsent: { backgroundColor: '#F8D2D5', color: '#991b1b', border: '1px solid #E89BA1', textDecoration: 'line-through' },
    // 합의결석: pink로 결석들과 구분
    agreedAbsent: { backgroundColor: '#F3D4EC', color: '#A32E92', border: '1px solid #DDA6CF', textDecoration: 'line-through' },
    absent: { backgroundColor: '#F8D2D5', color: '#991b1b', border: '1px solid #D67882', textDecoration: 'line-through' },
    holding: { backgroundColor: '#F8D2D5', color: '#991b1b', border: '1px solid #D67882', textDecoration: 'line-through' },
    newStudent: { backgroundColor: '#0E9B8E', color: '#ffffff', border: '1px solid #0B7E73' },
    delayed: { backgroundColor: '#C9E8D2', color: '#166534', border: '1px solid #97CFA6', textDecoration: 'line-through' },
    // 보강승인중: 대기자에게 자리 안내 문자가 나간 상태 (수락 대기)
    makeupPending: { backgroundColor: '#329BE71A', color: '#327AB8', border: '1px solid #329BE74D' },
    // 보강대기: 만석 슬롯 대기열에 등록된 상태
    waitingSeat: { backgroundColor: '#EDBC401A', color: '#9a7a12', border: '1px solid #EDBC404D' },
};

export const SECTION_STYLES = {
    lastDay: {
        background: '#31A5521A',
        border: '1px solid #31A5524D',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        color: '#31A552',
    },
    delayedRereg: {
        background: '#EDBC401A',
        border: '1px solid #EDBC404D',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        color: '#9a7a12',
    },
    waitlist: {
        background: '#EDBC401A',
        border: '1px solid #EDBC404D',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        color: '#9a7a12',
    },
};

export const DELETE_BTN_STYLE = {
    fontSize: '0.75rem',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid #E94E584D',
    background: '#E94E581A',
    color: '#E94E58',
    cursor: 'pointer',
    fontWeight: '600',
};
