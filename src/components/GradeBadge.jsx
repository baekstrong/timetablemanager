import { gradeByKey } from '../utils/grades';

// 이름 앞 학년 칩. grade 없으면(코치/미계산) 아무것도 안 그림.
// 디자인: 단일 코발트 액센트. 상태칩 패턴(배경 1A / 보더 4D / 텍스트 accent).
const ACCENT = '#329BE7';
export default function GradeBadge({ grade, style }) {
    const g = gradeByKey(grade);
    if (!g) return null;
    return (
        <span
            title={`${g.label}`}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                padding: '0 5px', height: '16px', borderRadius: 'var(--r-chip, 8px)',
                fontSize: '0.65rem', fontWeight: 700, lineHeight: 1,
                color: ACCENT, background: `${ACCENT}1A`, border: `1px solid ${ACCENT}4D`,
                verticalAlign: 'middle', flexShrink: 0, marginRight: '4px',
                ...style,
            }}
        >
            🎓 {g.short}
        </span>
    );
}
