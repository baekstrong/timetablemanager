import { PERIODS } from '../../data/mockData';
import { weekDateToISO, isClassWithinMinutes } from '../../utils/scheduleUtils';

export default function MakeupModal({
    selectedMakeupSlot,
    selectedOriginalClass,
    setSelectedOriginalClass,
    studentSchedule,
    weekDates,
    activeMakeupRequests,
    isSubmittingMakeup,
    onSubmit,
    onClose,
}) {
    return (
        <div className="makeup-modal-overlay" onClick={onClose}>
            <div className="makeup-modal" onClick={(e) => e.stopPropagation()}>
                <h2>보강 신청</h2>
                <p className="makeup-modal-subtitle">
                    선택한 시간: <strong>{selectedMakeupSlot.day}요일 {selectedMakeupSlot.periodName}</strong>
                </p>

                <div className="makeup-modal-content">
                    <h3>어느 수업을 옮기시겠습니까?</h3>
                    <div className="original-class-list">
                        {studentSchedule.map((schedule, index) => {
                            const periodInfo = PERIODS.find(p => p.id === schedule.period);
                            const dateStr = weekDates[schedule.day];
                            let originalDateStr = '';
                            let isAlreadyRequested = false;
                            let isPastDeadline = false;
                            if (dateStr) {
                                originalDateStr = weekDateToISO(dateStr);
                                isAlreadyRequested = activeMakeupRequests.some(m =>
                                    m.originalClass.date === originalDateStr &&
                                    m.originalClass.day === schedule.day &&
                                    m.originalClass.period === schedule.period
                                );
                                isPastDeadline = isClassWithinMinutes(originalDateStr, schedule.period, 60);
                            }
                            const isDisabled = isAlreadyRequested || isPastDeadline;

                            return (
                                <div
                                    key={index}
                                    className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                    style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: isAlreadyRequested ? '#e0f2fe' : '#f3f4f6' } : {}}
                                    onClick={() => {
                                        if (isAlreadyRequested) {
                                            alert('이미 보강 신청한 수업입니다.');
                                            return;
                                        }
                                        if (isPastDeadline) {
                                            alert('수업 시작 1시간 전 이후로는 보강 신청할 수 없습니다.');
                                            return;
                                        }
                                        setSelectedOriginalClass({
                                            day: schedule.day,
                                            period: schedule.period,
                                            periodName: periodInfo.name,
                                            date: originalDateStr
                                        });
                                    }}
                                >
                                    <span className="period-name">{schedule.day}요일 {periodInfo?.name}</span>
                                    <span style={{ fontSize: '0.8em', color: isDisabled ? '#999' : '#666', marginLeft: '8px' }}>
                                        ({dateStr})
                                        {isAlreadyRequested && ' - 신청됨'}
                                        {!isAlreadyRequested && isPastDeadline && ' - 마감'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="makeup-modal-actions">
                    <button className="btn-cancel" onClick={onClose}>
                        취소
                    </button>
                    <button
                        className="btn-submit"
                        onClick={onSubmit}
                        disabled={!selectedOriginalClass || isSubmittingMakeup}
                    >
                        {isSubmittingMakeup ? '신청 중...' : '보강 신청'}
                    </button>
                </div>
            </div>
        </div>
    );
}
