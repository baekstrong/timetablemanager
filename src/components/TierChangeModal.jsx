import { tierByKey } from '../utils/tiers';

// 새 달 첫 접속 시 티어 변동 안내. 승급이면 축하, 강등이면 분발.
export default function TierChangeModal({ change, onClose }) {
    if (!change || !change.changed) return null;
    const next = tierByKey(change.tier);
    const prev = tierByKey(change.prevTier);
    if (!next) return null;
    const isNew = change.isNew;
    const up = change.direction > 0;

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
                <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>{next.emoji}</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                    {isNew ? '내 티어가 정해졌어요!' : up ? '티어 승급! 🎉' : '티어가 내려갔어요'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
                    {prev && !isNew && (
                        <>
                            <span style={{ color: 'var(--text-muted)' }}>{prev.emoji} {prev.label}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                        </>
                    )}
                    <span style={{ color: next.color, fontWeight: 700 }}>{next.emoji} {next.label}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {isNew
                        ? '지난달 활동을 기준으로 등급이 매겨졌어요. 수업에 출석해도 훈련일지를 작성하지 않으면 그날은 점수에 반영되지 않아요. 운동한 날엔 꼭 기록을 남겨야 등급이 올라갑니다! 💪'
                        : up
                            ? '지난달 정말 꾸준했어요! 몸이 그 리듬을 기억하고 있어요. 이대로 쭉 이어가요 💪'
                            : '이번 달은 잠시 쉬어갔네요. 며칠만 다시 나오면 몸이 금방 기억해낼 거예요 💪'}
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
