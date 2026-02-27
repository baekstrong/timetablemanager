import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField } from '../services/googleSheetsService';
import {
    createMakeupRequest,
    getActiveMakeupRequest,
    cancelMakeupRequest,
    getLockedSlots
} from '../services/firebaseService';
import { PERIODS } from '../data/mockData';
import './MakeupRequestManager.css';

const MakeupRequestManager = ({ user, studentData, onBack }) => {
    const [step, setStep] = useState(1); // 1: 원본 선택, 2: 보강 날짜 선택, 3: 보강 시간 선택
    const [selectedOriginal, setSelectedOriginal] = useState(null);
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedMakeup, setSelectedMakeup] = useState(null);
    const [activeMakeup, setActiveMakeup] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [lockedSlots, setLockedSlots] = useState([]);

    // 학생의 정규 시간표 파싱
    const regularSchedule = useMemo(() => {
        if (!studentData) return [];

        const scheduleStr = getStudentField(studentData, '요일 및 시간');
        if (!scheduleStr) return [];

        const result = [];
        const dayMap = { '월': '월', '화': '화', '수': '수', '목': '목', '금': '금', '토': '토', '일': '일' };
        const chars = scheduleStr.replace(/\s/g, '');

        let i = 0;
        while (i < chars.length) {
            const char = chars[i];
            if (dayMap[char]) {
                const day = char;
                i++;
                let periodStr = '';
                while (i < chars.length && /\d/.test(chars[i])) {
                    periodStr += chars[i];
                    i++;
                }
                if (periodStr) {
                    const period = parseInt(periodStr);
                    const periodInfo = PERIODS.find(p => p.id === period);
                    if (periodInfo) {
                        result.push({ day, period, periodName: periodInfo.name });
                    }
                }
            } else {
                i++;
            }
        }
        return result;
    }, [studentData]);

    // 활성 보강 신청 조회
    useEffect(() => {
        const fetchActiveMakeup = async () => {
            if (!user) return;
            try {
                setLoading(true);
                const makeup = await getActiveMakeupRequest(user.username);
                setActiveMakeup(makeup);
            } catch (error) {
                console.error('보강 신청 조회 실패:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchActiveMakeup();
    }, [user]);

    // 잠긴 슬롯 조회
    useEffect(() => {
        getLockedSlots().then(setLockedSlots).catch(() => {});
    }, []);

    // 달력 생성 (다음 2주)
    const calendarDates = useMemo(() => {
        const dates = [];
        const today = new Date();
        for (let i = 1; i <= 14; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            dates.push(date);
        }
        return dates;
    }, []);

    const handleOriginalSelect = (schedule) => {
        setSelectedOriginal(schedule);
        setStep(2);
    };

    const handleDateSelect = (date) => {
        const dateStr = date.toISOString().split('T')[0];
        setSelectedDate(dateStr);
        setStep(3);
    };

    const handleMakeupSelect = (day, period) => {
        const periodInfo = PERIODS.find(p => p.id === period);
        setSelectedMakeup({ day, period, periodName: periodInfo.name });
    };

    const handleSubmit = async () => {
        if (!selectedOriginal || !selectedDate || !selectedMakeup) {
            alert('모든 정보를 선택해주세요.');
            return;
        }

        setIsSubmitting(true);
        try {
            // 원본 수업 날짜 계산 (오늘 이후의 첫 번째 해당 요일 찾기)
            const now = new Date();
            const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
            const targetDay = dayMap[selectedOriginal.day];
            const currentDay = now.getDay();

            let daysUntilTarget = targetDay - currentDay;
            const periodInfo = PERIODS.find(p => p.id === selectedOriginal.period);

            if (daysUntilTarget === 0) {
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const classStartMinutes = periodInfo.startHour * 60 + periodInfo.startMinute;

                if (currentMinutes >= classStartMinutes - 10) {
                    alert('수업 시작 10분 전부터는 보강 신청이 불가합니다.');
                    setIsSubmitting(false);
                    return;
                }
            } else if (daysUntilTarget < 0) {
                alert('이번 주 수업이 이미 지났습니다. 다음 주 일요일부터 신청 가능합니다.');
                setIsSubmitting(false);
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const originalDate = new Date(today);
            originalDate.setDate(today.getDate() + daysUntilTarget);
            const originalDateStr = originalDate.toISOString().split('T')[0];

            await createMakeupRequest(
                user.username,
                {
                    date: originalDateStr,
                    day: selectedOriginal.day,
                    period: selectedOriginal.period,
                    periodName: selectedOriginal.periodName
                },
                {
                    date: selectedDate,
                    day: selectedMakeup.day,
                    period: selectedMakeup.period,
                    periodName: selectedMakeup.periodName
                }
            );

            alert(`보강 신청이 완료되었습니다!\n${selectedOriginal.day}요일 ${selectedOriginal.periodName} → ${selectedMakeup.day}요일 ${selectedMakeup.periodName}`);

            // 상태 초기화 및 새로고침
            const makeup = await getActiveMakeupRequest(user.username);
            setActiveMakeup(makeup);
            setStep(1);
            setSelectedOriginal(null);
            setSelectedDate('');
            setSelectedMakeup(null);
        } catch (error) {
            alert(`보강 신청에 실패했습니다: ${error.message}`);
            console.error('보강 신청 오류:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = async () => {
        if (!activeMakeup) return;

        if (!confirm('보강 신청을 취소하시겠습니까?')) return;

        try {
            await cancelMakeupRequest(activeMakeup.id);
            alert('보강 신청이 취소되었습니다.');
            setActiveMakeup(null);
        } catch (error) {
            alert(`보강 신청 취소에 실패했습니다: ${error.message}`);
        }
    };

    const getDayName = (date) => {
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        return days[date.getDay()];
    };

    if (loading) {
        return (
            <div className="makeup-container">
                <div className="makeup-header">
                    <button onClick={onBack} className="back-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        뒤로가기
                    </button>
                    <h1 className="makeup-title">보강 신청</h1>
                </div>
                <div className="loading-message">
                    <div className="loading-spinner"></div>
                    <p>로딩 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="makeup-container">
            <div className="makeup-header">
                <button onClick={onBack} className="back-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="makeup-title">보강 신청</h1>
            </div>

            <div className="makeup-content">
                {/* 현재 보강 신청 상태 */}
                {activeMakeup && (
                    <div className="active-makeup-card">
                        <div className="card-header">
                            <h3>현재 보강 신청</h3>
                            {/* 원본 수업 날짜가 지나지 않았을 때만 취소 버튼 표시 */}
                            {activeMakeup.originalClass.date >= new Date().toISOString().split('T')[0] && (
                                <button onClick={handleCancel} className="cancel-button">취소</button>
                            )}
                        </div>
                        <div className="makeup-info">
                            <div className="makeup-row">
                                <span className="label">원본 수업:</span>
                                <span className="value">
                                    {activeMakeup.originalClass.day}요일 {activeMakeup.originalClass.periodName} ({activeMakeup.originalClass.date})
                                </span>
                            </div>
                            <div className="makeup-arrow">→</div>
                            <div className="makeup-row">
                                <span className="label">보강 수업:</span>
                                <span className="value highlight">
                                    {activeMakeup.makeupClass.day}요일 {activeMakeup.makeupClass.periodName} ({activeMakeup.makeupClass.date})
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 보강 신청이 없을 때만 신청 가능 */}
                {!activeMakeup && (
                    <>
                        {/* 안내 카드 */}
                        <div className="info-card">
                            <div className="info-icon">ℹ️</div>
                            <div className="info-content">
                                <h3>보강 신청 안내</h3>
                                <ul>
                                    <li>정규 수업 1회를 다른 날짜/시간으로 변경할 수 있습니다</li>
                                    <li>보강 신청은 1회만 가능합니다</li>
                                    <li>보강 신청 후 취소도 가능합니다</li>
                                </ul>
                            </div>
                        </div>

                        {/* Step 1: 원본 수업 선택 */}
                        {step >= 1 && (
                            <div className="step-card">
                                <h2 className="step-title">1단계: 옮길 수업 선택</h2>
                                <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '12px' }}>
                                    이번 주 또는 다음 주에 예정된 수업 중 보강을 신청할 수업을 선택하세요.
                                </p>
                                <div className="schedule-list">
                                    {regularSchedule.map((schedule, index) => {
                                        const now = new Date();
                                        const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
                                        const targetDay = dayMap[schedule.day];
                                        const currentDay = now.getDay();
                                        let daysUntilTarget = targetDay - currentDay;

                                        const periodInfo = PERIODS.find(p => p.id === schedule.period);
                                        let isDisabled = false;

                                        if (daysUntilTarget === 0) {
                                            // 오늘이 수업 요일 - 시간 체크
                                            const currentMinutes = now.getHours() * 60 + now.getMinutes();
                                            const classStartMinutes = periodInfo.startHour * 60 + periodInfo.startMinute;

                                            if (currentMinutes >= classStartMinutes - 10) {
                                                // 수업 10분 전 이후 → 이번 주 끝까지 비활성화
                                                isDisabled = true;
                                            }
                                        } else if (daysUntilTarget < 0) {
                                            // 이번 주 수업일이 이미 지남 → 비활성화
                                            isDisabled = true;
                                        }

                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const nextDate = new Date(today);
                                        nextDate.setDate(today.getDate() + daysUntilTarget);
                                        const dateStr = `${nextDate.getMonth() + 1}/${nextDate.getDate()}`;

                                        return (
                                            <div
                                                key={index}
                                                className={`schedule-item ${selectedOriginal?.day === schedule.day && selectedOriginal?.period === schedule.period ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                                onClick={() => !isDisabled && handleOriginalSelect(schedule)}
                                            >
                                                <span className="day-badge">{schedule.day}</span>
                                                <span className="period-name">{schedule.periodName}</span>
                                                <span style={{ fontSize: '0.85em', color: '#666', marginLeft: '8px' }}>({dateStr})</span>
                                                {isDisabled && (
                                                    <span className="disabled-label">신청마감</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Step 2: 보강 날짜 선택 */}
                        {step >= 2 && selectedOriginal && (
                            <div className="step-card">
                                <h2 className="step-title">2단계: 보강 날짜 선택</h2>
                                <div className="calendar-grid">
                                    {calendarDates.map((date, index) => (
                                        <div
                                            key={index}
                                            className={`calendar-date ${selectedDate === date.toISOString().split('T')[0] ? 'selected' : ''}`}
                                            onClick={() => handleDateSelect(date)}
                                        >
                                            <div className="date-day">{getDayName(date)}</div>
                                            <div className="date-number">{date.getDate()}</div>
                                            <div className="date-month">{date.getMonth() + 1}월</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Step 3: 보강 시간 선택 */}
                        {step >= 3 && selectedDate && (
                            <div className="step-card">
                                <h2 className="step-title">3단계: 보강 시간 선택</h2>
                                <p className="step-subtitle">선택한 날짜: {selectedDate} ({getDayName(new Date(selectedDate + 'T00:00:00'))}요일)</p>
                                <div className="period-grid">
                                    {PERIODS.filter(p => p.type !== 'free').map((period) => {
                                        const dayName = getDayName(new Date(selectedDate + 'T00:00:00'));
                                        const isLocked = lockedSlots.includes(`${dayName}-${period.id}`);
                                        return (
                                            <div
                                                key={period.id}
                                                className={`period-item ${selectedMakeup?.period === period.id ? 'selected' : ''} ${isLocked ? 'disabled' : ''}`}
                                                onClick={() => {
                                                    if (isLocked) {
                                                        alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
                                                        return;
                                                    }
                                                    handleMakeupSelect(dayName, period.id);
                                                }}
                                                style={isLocked ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#f3f4f6' } : {}}
                                            >
                                                <div className="period-name">{period.name} {isLocked && '🔒'}</div>
                                                <div className="period-time">{isLocked ? '보강 불가' : period.time}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 신청 버튼 */}
                        {selectedOriginal && selectedDate && selectedMakeup && (
                            <div className="submit-section">
                                <div className="summary-card">
                                    <h3>신청 내용 확인</h3>
                                    <div className="summary-content">
                                        <div className="summary-row">
                                            <span>원본 수업:</span>
                                            <span>{selectedOriginal.day}요일 {selectedOriginal.periodName}</span>
                                        </div>
                                        <div className="summary-arrow">→</div>
                                        <div className="summary-row">
                                            <span>보강 수업:</span>
                                            <span className="highlight">{selectedMakeup.day}요일 {selectedMakeup.periodName} ({selectedDate})</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={handleSubmit}
                                    className="submit-button"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? '신청 중...' : '보강 신청하기'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default MakeupRequestManager;
