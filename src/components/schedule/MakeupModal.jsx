import { PERIODS } from '../../data/mockData';
import { weekDateToISO, isClassWithinMinutes, wouldDoubleBookDay } from '../../utils/scheduleUtils';

export default function MakeupModal({
    title = '보강 신청',
    submitLabel = '보강 신청',
    submittingLabel = '신청 중...',
    selectedMakeupSlot,
    selectedOriginalClass,
    setSelectedOriginalClass,
    studentSchedule,
    weekDates,
    activeMakeupRequests,
    isSubmittingMakeup,
    getHolidayInfo,
    isMyHoldingDate,
    forceMode = false,
    onSubmit,
    onClose,
}) {
    const hasHolidayOriginalClass = studentSchedule.some(schedule => getHolidayInfo?.(schedule.day) !== null);

    return (
        <div className="makeup-modal-overlay" onClick={onClose}>
            <div className="makeup-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{title}</h2>
                <p className="makeup-modal-subtitle">
                    선택한 시간: <strong>{selectedMakeupSlot.day}요일 {selectedMakeupSlot.periodName}</strong>
                </p>

                <div className="makeup-modal-content">
                    <h3>어느 수업을 옮기시겠습니까?</h3>
                    {forceMode && (
                        <div style={{
                            margin: '0 0 12px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#EDBC401A',
                            border: '1px solid #EDBC404D',
                            color: '#9a7a12',
                            fontSize: '0.84rem',
                            lineHeight: '1.5'
                        }}>
                            <strong>강제 변경 안내</strong>
                            <div style={{ marginTop: '4px' }}>
                                코치가 대신 변경해도 이 보강은 <strong>수강생의 이번 주 보강 횟수(주 수강 횟수만큼)에 카운트</strong>됩니다.<br />
                                취소 내역도 소진으로 간주되니 수강생이 추가로 못 바꿀 수 있습니다.
                            </div>
                        </div>
                    )}
                    {hasHolidayOriginalClass && (
                        <div style={{
                            margin: '0 0 12px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#EDBC401A',
                            border: '1px solid #EDBC404D',
                            color: '#9a7a12',
                            fontSize: '0.84rem',
                            lineHeight: '1.5'
                        }}>
                            <strong>휴일 수업 보강 안내</strong>
                            <div style={{ marginTop: '4px' }}>
                                휴일로 쉬는 정규 수업도 이번 주 보강으로 미리 수강할 수 있습니다.<br />
                                이 경우 해당 휴일 수업을 출석한 것으로 처리하여 수강 종료일이 앞당겨질 수 있습니다.
                            </div>
                        </div>
                    )}
                    <div className="original-class-list">
                        {studentSchedule.map((schedule, index) => {
                            const periodInfo = PERIODS.find(p => p.id === schedule.period);
                            const dateStr = weekDates[schedule.day];
                            const holidayReason = getHolidayInfo?.(schedule.day);
                            let originalDateStr = '';
                            let isAlreadyRequested = false;
                            let isPastDeadline = false;
                            let isHoldingDay = false;
                            if (dateStr) {
                                originalDateStr = weekDateToISO(dateStr);
                                isAlreadyRequested = activeMakeupRequests.some(m =>
                                    m.originalClass.date === originalDateStr &&
                                    m.originalClass.day === schedule.day &&
                                    m.originalClass.period === schedule.period
                                );
                                isPastDeadline = !forceMode && isClassWithinMinutes(originalDateStr, schedule.period, 120);
                                isHoldingDay = !forceMode && (isMyHoldingDate?.(originalDateStr) ?? false);
                            }
                            // 이 수업을 대상 슬롯으로 옮기면 그 날 이중 수강이 되는지(같은 날 이동은 허용)
                            const isDoubleBook = wouldDoubleBookDay(
                                studentSchedule, activeMakeupRequests,
                                { day: schedule.day, period: schedule.period },
                                selectedMakeupSlot.day, selectedMakeupSlot.date
                            );
                            const isDisabled = isAlreadyRequested || isPastDeadline || isHoldingDay || isDoubleBook;

                            return (
                                <div
                                    key={index}
                                    className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                    style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: isAlreadyRequested ? '#329BE71A' : isHoldingDay ? '#EDBC401A' : '#F7F7F8' } : {}}
                                    onClick={() => {
                                        if (isAlreadyRequested) {
                                            alert('이미 보강 신청한 수업입니다.');
                                            return;
                                        }
                                        if (isHoldingDay) {
                                            alert('홀딩 기간 중인 수업은 보강 신청할 수 없습니다.\n홀딩이 끝난 뒤 신청해주세요.');
                                            return;
                                        }
                                        if (isPastDeadline) {
                                            alert('수업 시작 2시간 전 이후로는 보강 신청할 수 없습니다.');
                                            return;
                                        }
                                        if (isDoubleBook) {
                                            alert(`${selectedMakeupSlot.day}요일엔 이미 다른 정규 수업이 있어요.\n같은 날 다른 수업을 옮기거나, 다른 요일을 선택해주세요.`);
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
                                    <span style={{ fontSize: '0.8em', color: isDisabled ? '#999' : 'rgba(0,0,0,0.6)', marginLeft: '8px' }}>
                                        ({dateStr})
                                        {holidayReason !== null && holidayReason !== undefined && ` - 휴일${holidayReason ? `: ${holidayReason}` : ''}`}
                                        {isHoldingDay && ' - 홀딩'}
                                        {!isHoldingDay && isAlreadyRequested && ' - 신청됨'}
                                        {!isHoldingDay && !isAlreadyRequested && isPastDeadline && ' - 마감'}
                                        {!isHoldingDay && !isAlreadyRequested && !isPastDeadline && isDoubleBook && ` - ${selectedMakeupSlot.day}요일에 이미 수업이 있어 옮길 수 없음`}
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
                        {isSubmittingMakeup ? submittingLabel : submitLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
