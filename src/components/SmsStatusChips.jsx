import { SMS_TYPES, smsChip, isReminderExpected, expectedReminderAt } from '../utils/smsStatus';

// 칩 종류별 색 (플랫 코발트 디자인 — 가독성 강화 톤)
const CHIP_STYLE = {
    sent:      { background: '#C9E8D2', color: '#166534' },
    scheduled: { background: '#C9E3F8', color: '#1f6699' },
    failed:    { background: '#F8D2D5', color: '#991b1b' },
    none:      { background: '#E8E9EC', color: '#6b6e73' },
};

const ICON = { sent: '✅', scheduled: '⏳', failed: '❌', none: '⚪' };

/**
 * 신규 수강생 한 명의 SMS 3종 상태 칩 + (실패/미발송 시) 재발송 버튼.
 * @param {object} reg - newStudentRegistrations 문서
 * @param {(reg, typeKey) => void} onResend - 재발송 핸들러
 * @param {(reg, typeKey) => string|null} resendDisabledReason - null이면 활성, 문자열이면 비활성+사유
 */
export default function SmsStatusChips({ reg, onResend, resendDisabledReason }) {
    // 코치 직접 등록(재등록 포함)은 자동 문자 대상이 아님 → 표시 생략
    if (reg.registeredByCoach) return null;
    const log = reg.smsLog || {};
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {SMS_TYPES.map(({ key, label }) => {
                // 리마인더가 애초에 기대되지 않으면 표시 생략
                if (key === 'reminder' && !isReminderExpected(reg)) return null;
                // 승인/리마인더는 승인 전이면 '대기'로 흐리게
                const notYet = (key === 'approval' || key === 'reminder') && reg.status !== 'approved';
                let chip = smsChip(log[key]);
                // 과거 데이터(scheduledAt 미기록) 폴백: 입학반 3일 전 9시 규칙으로 예약 시각 추정
                if (key === 'reminder' && chip.kind === 'scheduled' && !log[key]?.scheduledAt) {
                    const fallbackAt = expectedReminderAt(reg);
                    if (fallbackAt) chip = { ...chip, label: `${fallbackAt} 문자 예약됨` };
                }
                const showResend = !notYet && (chip.kind === 'failed' || chip.kind === 'none');
                const disabledReason = showResend && resendDisabledReason ? resendDisabledReason(reg, key) : null;
                return (
                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: notYet ? 0.4 : 1 }}>
                        <span style={{
                            fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px',
                            borderRadius: 'var(--r-chip)',
                            ...CHIP_STYLE[notYet ? 'none' : chip.kind],
                        }}>
                            {ICON[notYet ? 'none' : chip.kind]} {label}: {notYet ? '대기' : chip.label}
                        </span>
                        {showResend && (
                            <button
                                onClick={() => !disabledReason && onResend(reg, key)}
                                disabled={Boolean(disabledReason)}
                                title={disabledReason || '재발송'}
                                style={{
                                    fontSize: '0.7rem', padding: '2px 8px', cursor: disabledReason ? 'not-allowed' : 'pointer',
                                    borderRadius: 'var(--r-chip)', border: '1px solid var(--accent-30)',
                                    background: disabledReason ? 'var(--canvas-tint)' : 'var(--accent-10)',
                                    color: disabledReason ? 'var(--text-muted)' : 'var(--accent-hover)',
                                }}
                            >
                                {disabledReason ? '기간 지남' : '재발송'}
                            </button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}
