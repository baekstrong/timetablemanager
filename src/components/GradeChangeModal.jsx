import { gradeByKey } from '../utils/grades';

// 누적 경험치로 학년이 올랐을 때 승급 축하. (TierChangeModal 미러, 단일 코발트)
const ACCENT = '#329BE7';
export default function GradeChangeModal({ change, onClose }) {
    if (!change) return null;
    const next = gradeByKey(change.to);
    const prev = gradeByKey(change.from);
    if (!next) return null;
    const isNew = change.isNew; // 첫 안내(인트로) vs 승급 축하

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--canvas, #fff)', borderRadius: 'var(--r-card, 20px)',
                    padding: '28px 24px', maxWidth: '320px', width: '100%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
                    boxShadow: '0 12px 40px rgba(0,0,0,.18)', textAlign: 'center',
                }}
            >
                <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>🎓</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                    {isNew ? '내 학년이 정해졌어요!' : '학년 승급! 🎉'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
                    {prev && !isNew && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{prev.label}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                        </>
                    )}
                    <span style={{ color: ACCENT, fontWeight: 700 }}>🎓 {next.label}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {isNew
                        ? '훈련일지에 쌓인 누적 운동량으로 학년이 정해져요. 꾸준히 운동하고 일지를 쓸수록 학년이 올라갑니다! (초등 1학년 → … → 대학 4학년 졸업) 💪'
                        : '한 학년 올랐어요! 이제 운동이 제법 익숙하죠? 꾸준히 쌓은 만큼 몸도 달라지고 있어요 💪'}
                </p>
                <button
                    onClick={onClose}
                    style={{
                        marginTop: '4px', width: '100%', padding: '12px',
                        border: 'none', borderRadius: 'var(--r-cta, 18px)',
                        background: 'var(--accent, #329BE7)', color: '#fff',
                        fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
                    }}
                >
                    확인
                </button>
            </div>
        </div>
    );
}
