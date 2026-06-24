// src/components/GradeHero.jsx
import { gradeProgress } from '../utils/grades';

const ACCENT = '#329BE7';
// 인사말 아래 학년 칩 + 경험치바. 탭하면 성장 화면으로.
export default function GradeHero({ xp = 0, onClick }) {
    const { grade, next, pct, remaining } = gradeProgress(xp);
    return (
        <button
            onClick={onClick}
            style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'transparent', border: 'none', padding: '6px 0 0', font: 'inherit',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <span style={{
                    fontSize: '0.78rem', fontWeight: 700, color: ACCENT,
                    background: `${ACCENT}1A`, border: `1px solid ${ACCENT}4D`,
                    borderRadius: 'var(--r-chip, 8px)', padding: '2px 8px',
                }}>🎓 {grade.label}</span>
            </div>
            <div style={{ height: '8px', borderRadius: 'var(--r-chip, 8px)', background: 'var(--hairline, #EFEFF0)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: ACCENT, borderRadius: '9999px' }} />
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #A7A7AA)', marginTop: '5px' }}>
                {next
                    ? `다음 학년까지 ${remaining.toLocaleString()}kg · ${Math.round(pct)}%`
                    : '🎓 졸업 — 최고 학년 달성!'}
            </div>
        </button>
    );
}
