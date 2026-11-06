// 명예 졸업 칩 (2026-11-06 사용자 확정 시안 A: 이름 앞 짙은색 꽉 찬 칩).
// 학년·티어 칩(연한 틴트)과 한눈에 구분되도록 --cta-dark 단색 배경 + 흰 글자.
// onCancel이 오면(코치 화면) 버튼으로 그려 눌러서 졸업 표시를 취소할 수 있다.
const DARK = 'var(--cta-dark, #242428)';

function CapIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 9l-10 -4l-10 4l10 4l10 -4v6" />
            <path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4" />
        </svg>
    );
}

export default function GraduateBadge({ graduated, onCancel, style }) {
    if (!graduated) return null;
    const base = {
        display: 'inline-flex', alignItems: 'center', gap: '2px',
        padding: '1px 5px', minHeight: '16px', borderRadius: 'var(--r-chip, 8px)',
        fontSize: '0.65rem', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap',
        color: '#fff', background: DARK, border: `1px solid ${DARK}`,
        verticalAlign: 'middle', flexShrink: 0, marginRight: '4px',
        fontFamily: 'inherit',
        ...style,
    };
    const content = <><CapIcon />졸업</>;
    if (onCancel) {
        return (
            <button
                type="button"
                title="명예 졸업 — 눌러서 졸업 표시 취소"
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
                style={{ ...base, cursor: 'pointer' }}
            >
                {content}
            </button>
        );
    }
    return <span title="명예 졸업" style={base}>{content}</span>;
}
