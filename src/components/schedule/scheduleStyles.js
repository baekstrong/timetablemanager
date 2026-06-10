// 시간표 컴포넌트들이 공유하는 스타일 상수.

export const TAG_STYLES = {
    // 보강이동: 원래 자리에서 다른 시간으로 이동 (caution, 출석은 함)
    makeupMoved: { backgroundColor: '#EDBC401A', color: '#9a7a12', textDecoration: 'line-through' },
    // 보강결석: 보강 자리에 오기로 했다가 결석 (error, 완전히 빠짐)
    makeupAbsent: { backgroundColor: '#E94E581A', color: '#E94E58', textDecoration: 'line-through' },
    // 합의결석: pink로 결석들과 구분
    agreedAbsent: { backgroundColor: '#CB48AD1A', color: '#A32E92', textDecoration: 'line-through' },
    absent: { backgroundColor: '#E94E581A', color: '#E94E58', textDecoration: 'line-through' },
    holding: { backgroundColor: '#E94E581A', color: '#E94E58', textDecoration: 'line-through' },
    newStudent: { backgroundColor: '#329BE71A', color: '#327AB8' },
    delayed: { backgroundColor: '#31A5521A', color: '#31A552', textDecoration: 'line-through' },
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
