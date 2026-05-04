import { useState, useEffect } from 'react';
import { submitPersonalBest } from '../services/firebaseService';
import './PRSubmitModal.css';

const PR_TYPE_OPTIONS = [
    { value: 'oneRM', label: '최대 중량 (1RM)', desc: '벤치/스쿼트/데드리프트 등' },
    { value: 'weightThenReps', label: '중량별 반복', desc: '케틀벨 스윙 12분 등' },
    { value: 'timeHold', label: '시간 보유', desc: '플랭크 등' },
    { value: 'bodyweightReps', label: '맨몸 반복', desc: '푸시업/풀업 등' }
];

const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const CUSTOM_EXERCISE_VALUE = '__custom__';

const PRSubmitModal = ({ user, students, defaultStudent, exerciseSuggestions = [], onClose, onSubmitted }) => {
    const isCoach = user?.role === 'coach';
    const [studentName, setStudentName] = useState(defaultStudent || (isCoach ? '' : user.username));
    const [exerciseSelect, setExerciseSelect] = useState('');
    const [exercise, setExercise] = useState('');
    const [prType, setPrType] = useState('oneRM');
    const [intensityValue, setIntensityValue] = useState('');
    const [intensityUnit, setIntensityUnit] = useState('kg');
    const [repsValue, setRepsValue] = useState('');
    const [date, setDate] = useState(todayStr());
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (prType === 'timeHold') setIntensityUnit('초');
        else if (prType === 'bodyweightReps') setIntensityUnit('맨몸');
        else setIntensityUnit('kg');
    }, [prType]);

    const handleSubmit = async () => {
        if (!studentName) { alert('학생을 선택해주세요.'); return; }
        if (!exercise.trim()) { alert('운동명을 입력해주세요.'); return; }

        let intensity, reps;
        switch (prType) {
            case 'oneRM':
                if (!intensityValue) { alert('중량을 입력해주세요.'); return; }
                intensity = { value: intensityValue, unit: intensityUnit };
                reps = { value: '1', unit: '회' };
                break;
            case 'weightThenReps':
                if (!intensityValue || !repsValue) { alert('중량과 반복 횟수를 모두 입력해주세요.'); return; }
                intensity = { value: intensityValue, unit: intensityUnit };
                reps = { value: repsValue, unit: '회' };
                break;
            case 'timeHold':
                if (!repsValue) { alert('시간(초)을 입력해주세요.'); return; }
                intensity = { value: '', unit: '' };
                reps = { value: repsValue, unit: '초' };
                break;
            case 'bodyweightReps':
                if (!repsValue) { alert('반복 횟수를 입력해주세요.'); return; }
                intensity = { value: '맨몸', unit: '맨몸' };
                reps = { value: repsValue, unit: '회' };
                break;
            default:
                return;
        }

        try {
            setSubmitting(true);
            const result = await submitPersonalBest({
                userName: studentName,
                exercise: exercise.trim(),
                prType,
                intensity,
                reps,
                date,
                note: note.trim()
            });
            if (result.updated) {
                alert('🏆 신기록 등록 완료!');
            } else {
                alert('기록이 저장되었습니다 (이전 PR이 더 높음 — 이력에만 추가).');
            }
            onSubmitted?.(result);
        } catch (err) {
            console.error(err);
            alert(`등록 실패: ${err.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="pr-modal-overlay" onClick={onClose}>
            <div className="pr-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="pr-modal-header">
                    <h2 className="pr-modal-title">공식 측정 기록 등록</h2>
                    <button className="pr-modal-close" onClick={onClose}>×</button>
                </div>

                {isCoach && (
                    <div className="pr-form-row">
                        <label>학생</label>
                        <select value={studentName} onChange={(e) => setStudentName(e.target.value)}>
                            <option value="">선택하세요</option>
                            {students.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="pr-form-row">
                    <label>운동명</label>
                    <select
                        value={exerciseSelect}
                        onChange={(e) => {
                            const v = e.target.value;
                            setExerciseSelect(v);
                            if (v === CUSTOM_EXERCISE_VALUE) {
                                setExercise('');
                            } else {
                                setExercise(v);
                            }
                        }}
                    >
                        <option value="">선택하세요</option>
                        {exerciseSuggestions.map((ex) => (
                            <option key={ex} value={ex}>{ex}</option>
                        ))}
                        <option value={CUSTOM_EXERCISE_VALUE}>+ 직접 입력</option>
                    </select>
                    {exerciseSelect === CUSTOM_EXERCISE_VALUE && (
                        <input
                            type="text"
                            value={exercise}
                            onChange={(e) => setExercise(e.target.value)}
                            placeholder="운동명 직접 입력"
                            style={{ marginTop: '0.5rem' }}
                        />
                    )}
                </div>

                <div className="pr-form-row">
                    <label>운동 유형</label>
                    <div className="pr-type-grid">
                        {PR_TYPE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                className={`pr-type-btn ${prType === opt.value ? 'active' : ''}`}
                                onClick={() => setPrType(opt.value)}
                            >
                                <div className="pr-type-label">{opt.label}</div>
                                <div className="pr-type-desc">{opt.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {(prType === 'oneRM' || prType === 'weightThenReps') && (
                    <div className="pr-form-row">
                        <label>중량</label>
                        <div className="pr-input-group">
                            <input
                                type="number"
                                value={intensityValue}
                                onChange={(e) => setIntensityValue(e.target.value)}
                                placeholder="100"
                            />
                            <select value={intensityUnit} onChange={(e) => setIntensityUnit(e.target.value)}>
                                <option value="kg">kg</option>
                                <option value="높이">높이</option>
                            </select>
                        </div>
                    </div>
                )}

                {prType === 'weightThenReps' && (
                    <div className="pr-form-row">
                        <label>반복 횟수</label>
                        <div className="pr-input-group">
                            <input
                                type="number"
                                value={repsValue}
                                onChange={(e) => setRepsValue(e.target.value)}
                                placeholder="200"
                            />
                            <span className="pr-unit-label">회</span>
                        </div>
                    </div>
                )}

                {prType === 'timeHold' && (
                    <div className="pr-form-row">
                        <label>시간</label>
                        <div className="pr-input-group">
                            <input
                                type="number"
                                value={repsValue}
                                onChange={(e) => setRepsValue(e.target.value)}
                                placeholder="90"
                            />
                            <span className="pr-unit-label">초</span>
                        </div>
                    </div>
                )}

                {prType === 'bodyweightReps' && (
                    <div className="pr-form-row">
                        <label>반복 횟수</label>
                        <div className="pr-input-group">
                            <input
                                type="number"
                                value={repsValue}
                                onChange={(e) => setRepsValue(e.target.value)}
                                placeholder="50"
                            />
                            <span className="pr-unit-label">회</span>
                        </div>
                    </div>
                )}

                <div className="pr-form-row">
                    <label>측정일</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>

                <div className="pr-form-row">
                    <label>메모 (선택)</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="컨디션, 측정 환경 등"
                        rows={2}
                    />
                </div>

                <div className="pr-modal-actions">
                    <button className="pr-btn-cancel" onClick={onClose} disabled={submitting}>취소</button>
                    <button className="pr-btn-submit" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? '저장 중…' : '등록'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PRSubmitModal;
