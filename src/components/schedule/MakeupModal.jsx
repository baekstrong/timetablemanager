import { PERIODS } from '../../data/mockData';
import { weekDateToISO } from '../../utils/scheduleUtils';

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
                            if (dateStr) {
                                originalDateStr = weekDateToISO(dateStr);
                                isAlreadyRequested = activeMakeupRequests.some(m =>
                                    m.originalClass.date === originalDateStr &&
                                    m.originalClass.day === schedule.day &&
                                    m.originalClass.period === schedule.period
                                );
                            }

                            return (
                                <div
                                    key={index}
                                    className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''} ${isAlreadyRequested ? 'disabled' : ''}`}
                                    style={isAlreadyRequested ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#e0f2fe' } : {}}
                                    onClick={() => {
                                        if (isAlreadyRequested) {
                                            alert('이미 보강 신청한 수업입니다.');
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
                                    <span style={{ fontSize: '0.8em', color: isAlreadyRequested ? '#999' : '#666', marginLeft: '8px' }}>
                                        ({dateStr}){isAlreadyRequested && ' - 신청됨'}
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
