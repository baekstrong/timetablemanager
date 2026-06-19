import { tierByKey } from '../utils/tiers';

// 이름 앞에 붙는 티어 칩. tier가 없으면(코치/미계산) 아무것도 안 그림.
// 상태칩 패턴: 배경 {색}1A + 보더 {색}4D + 텍스트 {색}.
export default function TierBadge({ tier, style }) {
    const t = typeof tier === 'string' ? tierByKey(tier) : tier;
    if (!t) return null;
    return (
        <span
            title={`${t.label} 티어`}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                padding: '0 5px', height: '16px', borderRadius: 'var(--r-chip, 8px)',
                fontSize: '0.65rem', fontWeight: 700, lineHeight: 1,
                color: t.color, background: `${t.color}1A`, border: `1px solid ${t.color}4D`,
                verticalAlign: 'middle', flexShrink: 0, marginRight: '4px',
                ...style,
            }}
        >
            <span style={{ fontSize: '0.7rem' }}>{t.emoji}</span>{t.label}
        </span>
    );
}
