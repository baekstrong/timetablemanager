import ReviewModal from '../features/today/ReviewModal';
import { tierByKey } from '../utils/tiers';
import { gradeByKey } from '../utils/grades';
import './StudentGrowthModal.css';

function GrowthChange({ title, caption, previous, current, emoji, description }) {
    return <section className="student-growth-change" aria-label={title}>
        <div className="student-growth-change-heading">
            <h3>{title}</h3>
            {caption && <span>{caption}</span>}
        </div>
        <div className="student-growth-change-values">
            {previous && <>
                <div className="student-growth-change-previous">
                    <span>이전</span>
                    <strong>{previous.label}</strong>
                </div>
                <span className="student-growth-change-arrow" aria-hidden="true">→</span>
            </>}
            <div className="student-growth-change-current">
                <span>현재</span>
                <strong><span aria-hidden="true">{emoji}</span> {current.label}</strong>
            </div>
        </div>
        <p>{description}</p>
    </section>;
}

export default function StudentGrowthModal({ tierChange, gradeChange, busy = false, error = '', onConfirm, onLater }) {
    const tier = tierByKey(tierChange?.tier);
    const grade = gradeByKey(gradeChange?.to);
    if (!tier && !grade) return null;

    const previousTier = !tierChange?.isNew && tierChange?.prevTier !== tierChange?.tier
        ? tierByKey(tierChange?.prevTier) : null;
    const previousGrade = !gradeChange?.isNew && gradeChange?.from !== gradeChange?.to
        ? gradeByKey(gradeChange?.from) : null;
    const month = typeof tierChange?.month === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.exec(tierChange.month);
    const monthLabel = month ? `${month[1]}년 ${Number(month[2])}월` : '';

    return <ReviewModal title="내 성장 정보" onClose={onLater} busy={busy}>
        <div className="student-growth-modal" aria-busy={busy}>
            {tier && <GrowthChange title="월간 활동 티어" caption={monthLabel}
                previous={previousTier} current={tier} emoji={tier.emoji}
                description="지난달 훈련일지·자율운동 기록일로 정해져요." />}
            {grade && <GrowthChange title="누적 훈련량 학년"
                previous={previousGrade} current={grade} emoji="🎓"
                description="훈련일지에 쌓인 누적 훈련량으로 정해져요." />}
            {error && <p className="student-growth-modal-error" role="alert">
                {typeof error === 'string' ? error : '확인을 저장하지 못했어요. 다시 시도해 주세요.'}
            </p>}
            <div className="student-growth-modal-actions">
                <button type="button" className="today-button" disabled={busy} onClick={onLater}>나중에</button>
                <button type="button" className="today-button today-button-primary" disabled={busy} onClick={onConfirm}>
                    {busy ? '저장 중…' : '확인'}
                </button>
            </div>
        </div>
    </ReviewModal>;
}
