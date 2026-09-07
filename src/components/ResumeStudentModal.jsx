import { useMemo, useState } from 'react';
import { calculatePausedStudentResumePlan, parseScheduleString } from '../services/googleSheetsService';
import { DAYS, PERIODS } from '../data/mockData';
import './ResumeStudentModal.css';

const REGULAR_PERIODS = PERIODS.filter(period => period.type !== 'free');
const WEEKLY_FREQUENCIES = DAYS.map((_, index) => index + 1);

const formatDateInput = (date) => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const formatSheetDate = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length !== 6) return '';
    return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
};

const slotsFromSchedule = (schedule) => parseScheduleString(schedule)
    .filter(slot => DAYS.includes(slot.day) && REGULAR_PERIODS.some(period => period.id === slot.period));

const scheduleFromSlots = (slots) => [...slots]
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.period - b.period)
    .map(slot => `${slot.day}${slot.period}`)
    .join('');

const initialWeeklyFrequency = (registrations) => {
    const original = Number.parseInt(registrations?.[0]?.origWeekly, 10);
    if (WEEKLY_FREQUENCIES.includes(original)) return original;
    const slotCount = registrations?.length ? slotsFromSchedule(registrations[0].origSchedule).length : 0;
    return WEEKLY_FREQUENCIES.includes(slotCount) ? slotCount : 2;
};

const ResumeStudentModal = ({
    studentName,
    registrations,
    loading,
    loadError,
    holidays,
    processing,
    onRetry,
    onClose,
    onSubmit,
}) => {
    const [restartDate, setRestartDate] = useState(() => formatDateInput(new Date()));
    const [weeklyFrequency, setWeeklyFrequency] = useState(() => initialWeeklyFrequency(registrations));
    const [selectedSlots, setSelectedSlots] = useState(() => (
        registrations?.length ? slotsFromSchedule(registrations[0].origSchedule) : []
    ));

    const schedule = useMemo(() => scheduleFromSlots(selectedSlots), [selectedSlots]);
    const isScheduleComplete = selectedSlots.length === weeklyFrequency;
    const totalSessions = useMemo(
        () => (registrations || []).reduce((sum, registration) => sum + registration.n, 0),
        [registrations],
    );

    const preview = useMemo(() => {
        if (!registrations?.length || !restartDate || !schedule || !isScheduleComplete) {
            return { plan: [], error: '' };
        }
        try {
            return {
                plan: calculatePausedStudentResumePlan(
                    registrations,
                    new Date(`${restartDate}T00:00:00`),
                    schedule,
                    holidays,
                    weeklyFrequency,
                ),
                error: '',
            };
        } catch (error) {
            return { plan: [], error: error.message };
        }
    }, [registrations, restartDate, schedule, holidays, weeklyFrequency, isScheduleComplete]);

    const actualStartDate = formatSheetDate(preview.plan[0]?.start);
    const endDate = formatSheetDate(preview.plan.at(-1)?.end);

    const handleSlotClick = (day, period) => {
        setSelectedSlots(current => {
            const selectedOnDay = current.find(slot => slot.day === day);
            if (selectedOnDay?.period === period) return current.filter(slot => slot.day !== day);
            if (selectedOnDay) {
                return [...current.filter(slot => slot.day !== day), { day, period }];
            }
            if (current.length >= weeklyFrequency) return current;
            return [...current, { day, period }];
        });
    };

    const handleFrequencyClick = (frequency) => {
        setWeeklyFrequency(frequency);
        setSelectedSlots(current => [...current]
            .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.period - b.period)
            .slice(0, frequency));
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (!restartDate || !schedule || !isScheduleComplete || !endDate || processing) return;
        onSubmit({
            restartDate: new Date(`${restartDate}T00:00:00`),
            schedule,
            weeklyFrequency,
        });
    };

    return (
        <div className="resume-modal-overlay" onClick={(event) => {
            if (event.target === event.currentTarget && !processing) onClose();
        }}>
            <form className="resume-modal" role="dialog" aria-modal="true" aria-labelledby="resume-modal-title" onSubmit={handleSubmit}>
                <div className="resume-modal-heading">
                    <div>
                        <h2 id="resume-modal-title">수강 재개</h2>
                        <p>{studentName}</p>
                    </div>
                    <button type="button" className="resume-modal-close" aria-label="닫기" onClick={onClose} disabled={processing}>×</button>
                </div>

                {loading ? (
                    <div className="resume-modal-state">정지된 수강 정보를 불러오는 중…</div>
                ) : loadError ? (
                    <div className="resume-modal-error" role="alert">
                        <p>{loadError}</p>
                        <button type="button" onClick={onRetry}>다시 불러오기</button>
                    </div>
                ) : (
                    <>
                        <div className="resume-form-field">
                            <label htmlFor="resume-date">재시작일</label>
                            <input
                                id="resume-date"
                                type="date"
                                value={restartDate}
                                onChange={(event) => setRestartDate(event.target.value)}
                                required
                            />
                            <span>선택한 날짜가 수업일이 아니면 다음 수업일부터 시작합니다.</span>
                        </div>

                        <fieldset className="resume-frequency-fieldset">
                            <legend>주횟수</legend>
                            <div className="resume-frequency-options">
                                {WEEKLY_FREQUENCIES.map(frequency => (
                                    <button
                                        type="button"
                                        key={frequency}
                                        className={weeklyFrequency === frequency ? 'selected' : ''}
                                        aria-pressed={weeklyFrequency === frequency}
                                        onClick={() => handleFrequencyClick(frequency)}
                                    >
                                        주{frequency}회
                                    </button>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className="resume-schedule-fieldset">
                            <legend>시간표</legend>
                            <p>서로 다른 요일을 {weeklyFrequency}개 선택해주세요. ({selectedSlots.length}/{weeklyFrequency})</p>
                            <div className="resume-schedule-grid">
                                <div className="resume-schedule-header" aria-hidden="true">
                                    <span />
                                    {DAYS.map(day => <strong key={day}>{day}</strong>)}
                                </div>
                                {REGULAR_PERIODS.map(period => (
                                    <div className="resume-schedule-row" key={period.id}>
                                        <div className="resume-period-label">
                                            <strong>{period.name}</strong>
                                            <span>{period.time.replace(/\s/g, '')}</span>
                                        </div>
                                        {DAYS.map(day => {
                                            const selected = selectedSlots.some(slot => slot.day === day && slot.period === period.id);
                                            const hasSelectionOnDay = selectedSlots.some(slot => slot.day === day);
                                            const disabled = selectedSlots.length >= weeklyFrequency && !hasSelectionOnDay;
                                            return (
                                                <button
                                                    type="button"
                                                    key={`${day}-${period.id}`}
                                                    className={selected ? 'selected' : ''}
                                                    aria-pressed={selected}
                                                    aria-label={`${day}요일 ${period.name} ${period.time}`}
                                                    disabled={disabled}
                                                    onClick={() => handleSlotClick(day, period.id)}
                                                >
                                                    {selected ? '✓' : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                            <div className="resume-schedule-summary">
                                <span>선택 시간표 ({selectedSlots.length}/{weeklyFrequency})</span>
                                <strong>{schedule || '선택해주세요'}</strong>
                            </div>
                        </fieldset>

                        <div className="resume-date-result">
                            <div className="resume-form-field">
                                <label htmlFor="resume-actual-start">실제 시작일</label>
                                <input id="resume-actual-start" value={actualStartDate} readOnly placeholder="시간표 선택 후 계산" />
                            </div>
                            <div className="resume-form-field">
                                <label htmlFor="resume-end-date">종료일 <span>(자동 계산)</span></label>
                                <input id="resume-end-date" value={endDate} readOnly placeholder="시간표 선택 후 계산" />
                            </div>
                        </div>

                        <div className="resume-calculation-note">
                            남은 수업 <strong>{totalSessions}회</strong> · 주 <strong>{weeklyFrequency}회</strong>
                            {registrations.length > 1 && <> · 정지된 등록 {registrations.length}건 연속 적용</>}
                            {!isScheduleComplete && <p role="alert">시간표를 {weeklyFrequency}개 선택해주세요.</p>}
                            {preview.error && <p role="alert">{preview.error}</p>}
                        </div>
                    </>
                )}

                <div className="resume-modal-actions">
                    <button type="button" className="resume-cancel-button" onClick={onClose} disabled={processing}>취소</button>
                    <button
                        type="submit"
                        className="resume-submit-button"
                        disabled={loading || Boolean(loadError) || !schedule || !isScheduleComplete || !endDate || processing}
                    >
                        {processing ? '재개 처리 중…' : '이 일정으로 재개'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default ResumeStudentModal;
