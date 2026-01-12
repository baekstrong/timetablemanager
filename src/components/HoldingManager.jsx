import { useState, useMemo } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { PERIODS } from '../data/mockData';
import { getStudentField } from '../services/googleSheetsService';
import './HoldingManager.css';

// 로컬 날짜를 YYYY-MM-DD 형식으로 변환 (timezone 문제 방지)
const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const HoldingManager = ({ user, studentData, onBack }) => {
    const { requestHolding } = useGoogleSheets();
    const [selectedDates, setSelectedDates] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 수강생의 정규 수업 요일 파싱
    const schedule = useMemo(() => {
        if (!studentData) return [];
        const scheduleStr = studentData['요일 및 시간'];
        if (!scheduleStr) return [];

        const result = [];
        const dayMap = { '월': '월', '화': '화', '수': '수', '목': '목', '금': '금' };
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
                    result.push({ day, period });
                }
            } else {
                i++;
            }
        }
        return result;
    }, [studentData]);

    // 수강 기간 파싱
    const membershipPeriod = useMemo(() => {
        if (!studentData) return { start: null, end: null };

        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            const cleaned = dateStr.replace(/\D/g, '');
            if (cleaned.length === 6) {
                const year = parseInt('20' + cleaned.substring(0, 2));
                const month = parseInt(cleaned.substring(2, 4)) - 1;
                const day = parseInt(cleaned.substring(4, 6));
                return new Date(year, month, day);
            } else if (cleaned.length === 8) {
                const year = parseInt(cleaned.substring(0, 4));
                const month = parseInt(cleaned.substring(4, 6)) - 1;
                const day = parseInt(cleaned.substring(6, 8));
                return new Date(year, month, day);
            }
            // YYYY-MM-DD 형식도 지원
            if (dateStr.includes('-')) {
                return new Date(dateStr);
            }
            return null;
        };

        const startDateStr = studentData['시작날짜'];
        const endDateStr = studentData['종료일'] || studentData['endDate'];

        return {
            start: parseDate(startDateStr),
            end: parseDate(endDateStr)
        };
    }, [studentData]);

    // 홀딩 내역 조회
    const holdingHistory = useMemo(() => {
        if (!studentData) return [];

        const holdingUsed = getStudentField(studentData, '홀딩 사용여부');
        const holdingStart = getStudentField(studentData, '홀딩 시작일');
        const holdingEnd = getStudentField(studentData, '홀딩 종료일');

        if (holdingUsed === 'O' && holdingStart) {
            const parseDate = (dateStr) => {
                if (!dateStr) return null;
                const cleaned = dateStr.replace(/\D/g, '');
                if (cleaned.length === 6) {
                    const year = parseInt('20' + cleaned.substring(0, 2));
                    const month = parseInt(cleaned.substring(2, 4)) - 1;
                    const day = parseInt(cleaned.substring(4, 6));
                    return new Date(year, month, day);
                }
                return null;
            };

            // 로컬 날짜를 YYYY-MM-DD 형식으로 변환 (timezone 문제 방지)
            const formatLocalDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const startDate = parseDate(holdingStart);
            const endDate = parseDate(holdingEnd) || startDate;

            if (startDate) {
                const dates = [];
                const current = new Date(startDate);
                while (current <= endDate) {
                    dates.push(formatLocalDate(current));
                    current.setDate(current.getDate() + 1);
                }

                return [{
                    startDate: formatLocalDate(startDate),
                    endDate: formatLocalDate(endDate),
                    dates,
                    status: '승인됨'
                }];
            }
        }

        return [];
    }, [studentData]);

    // 이번 달 달력 생성 (수강 기간 내로 제한)
    const calendar = useMemo(() => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        const dates = [];
        const startDayOfWeek = firstDay.getDay();

        // 이전 달 날짜로 채우기
        for (let i = 0; i < startDayOfWeek; i++) {
            dates.push(null);
        }

        // 이번 달 날짜 (수강 기간 내만)
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(year, month, day);

            // 수강 기간 체크
            if (membershipPeriod.start && membershipPeriod.end) {
                if (date >= membershipPeriod.start && date <= membershipPeriod.end) {
                    dates.push(date);
                } else {
                    dates.push(null);
                }
            } else {
                dates.push(date);
            }
        }

        return { year, month, dates };
    }, [membershipPeriod]);

    // 특정 날짜가 수업일인지 확인
    const isClassDay = (date) => {
        if (!date) return false;
        const dayOfWeek = date.getDay();
        const dayMap = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
        const dayName = dayMap[dayOfWeek];
        return schedule.some(s => s.day === dayName);
    };

    // 특정 날짜의 수업 시간 가져오기
    const getClassPeriod = (date) => {
        if (!date) return null;
        const dayOfWeek = date.getDay();
        const dayMap = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
        const dayName = dayMap[dayOfWeek];
        const classInfo = schedule.find(s => s.day === dayName);
        return classInfo ? classInfo.period : null;
    };

    // 홀딩 신청 가능 여부 확인 (수업 시작 1시간 전까지)
    const canRequestHolding = (date) => {
        if (!date) return false;

        const periodId = getClassPeriod(date);
        if (!periodId) return false;

        const period = PERIODS.find(p => p.id === periodId);
        if (!period) return false;

        const classDateTime = new Date(date);
        classDateTime.setHours(period.startHour, period.startMinute, 0, 0);

        const oneHourBefore = new Date(classDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);

        const now = new Date();
        return now < oneHourBefore;
    };

    // 이미 홀딩 신청한 날짜인지 확인
    const isHoldingDate = (date) => {
        if (!date) return false;
        const dateStr = formatLocalDate(date);
        return holdingHistory.some(h => h.dates.includes(dateStr));
    };

    // 날짜 선택 핸들러
    const handleDateClick = (date) => {
        if (!date || !isClassDay(date) || !canRequestHolding(date) || isHoldingDate(date)) {
            return;
        }

        const dateStr = formatLocalDate(date);

        // 이미 선택된 날짜면 제거
        if (selectedDates.includes(dateStr)) {
            setSelectedDates(selectedDates.filter(d => d !== dateStr));
            return;
        }

        // 새로운 날짜 추가
        const newDates = [...selectedDates, dateStr].sort();

        // 연속성 검증 (최대 7일)
        if (newDates.length > 1) {
            const dates = newDates.map(d => new Date(d));
            const firstDate = dates[0];
            const lastDate = dates[dates.length - 1];
            const daysDiff = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24));

            if (daysDiff > 7) {
                alert('홀딩은 최대 연속 7일까지만 가능합니다.');
                return;
            }
        }

        setSelectedDates(newDates);
    };

    // 홀딩 신청 핸들러
    const handleSubmit = async () => {
        if (selectedDates.length === 0 || !user) return;

        setIsSubmitting(true);
        try {
            // 시작일과 종료일 결정
            const sortedDates = [...selectedDates].sort();

            // 날짜 문자열을 로컬 시간대로 파싱 (timezone 문제 방지)
            const parseLocalDate = (dateStr) => {
                const [year, month, day] = dateStr.split('-').map(Number);
                return new Date(year, month - 1, day);
            };

            const startDate = parseLocalDate(sortedDates[0]);
            const endDate = parseLocalDate(sortedDates[sortedDates.length - 1]);

            console.log(`📅 선택한 날짜: ${sortedDates[0]} ~ ${sortedDates[sortedDates.length - 1]}`);
            console.log(`📆 Date 객체: ${startDate.toLocaleDateString()} ~ ${endDate.toLocaleDateString()}`);

            // 홀딩 신청 (시작일과 종료일 전달)
            await requestHolding(user.username, startDate, endDate);
            alert('홀딩 신청이 완료되었습니다.');
            setSelectedDates([]);
            // 대시보드로 돌아가기
            onBack();
        } catch (error) {
            alert(`홀딩 신청에 실패했습니다: ${error.message}`);
            console.error('홀딩 신청 오류:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="holding-container">
            <div className="holding-header">
                <button onClick={onBack} className="back-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="holding-title">홀딩 신청</h1>
            </div>

            <div className="holding-content">
                {/* 홀딩 안내 */}
                <div className="info-card">
                    <div className="info-icon">ℹ️</div>
                    <div className="info-content">
                        <h3>홀딩 기능 안내</h3>
                        <ul>
                            <li>홀딩 신청 시 해당 일수만큼 수강권 기간이 자동으로 연장됩니다.</li>
                            <li>홀딩한 자리는 다른 수강생이 임시로 사용할 수 있습니다.</li>
                            <li>홀딩은 최소 1시간 전에 신청 가능합니다.</li>
                            <li>홀딩은 최대 연속 7일까지 가능합니다.</li>
                        </ul>
                    </div>
                </div>

                {/* 달력 */}
                <div className="calendar-card">
                    <h2 className="form-title">홀딩 날짜 선택</h2>
                    <p className="calendar-subtitle">수업일을 클릭하여 홀딩할 날짜를 선택하세요 (여러 날짜 선택 가능)</p>
                    <div className="calendar">
                        <div className="calendar-header">
                            <h3>{calendar.year}년 {calendar.month + 1}월</h3>
                        </div>

                        <div className="calendar-weekdays">
                            {['일', '월', '화', '수', '목', '금', '토'].map(day => (
                                <div key={day} className="weekday">{day}</div>
                            ))}
                        </div>

                        <div className="calendar-grid">
                            {calendar.dates.map((date, index) => {
                                if (!date) {
                                    return <div key={index} className="calendar-day empty"></div>;
                                }

                                const isClass = isClassDay(date);
                                const isHolding = isHoldingDate(date);
                                const canRequest = isClass && canRequestHolding(date) && !isHolding;
                                const isSelected = selectedDates.includes(formatLocalDate(date));
                                const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                                return (
                                    <div
                                        key={index}
                                        className={`calendar-day 
                                            ${isClass ? 'class-day' : ''} 
                                            ${isHolding ? 'holding-day' : ''} 
                                            ${isSelected ? 'selected' : ''}
                                            ${!canRequest ? 'disabled' : ''}
                                            ${isPast ? 'past' : ''}`}
                                        onClick={() => handleDateClick(date)}
                                    >
                                        <span className="day-number">{date.getDate()}</span>
                                        {isClass && <span className="class-indicator">●</span>}
                                        {isHolding && <span className="holding-badge">홀딩</span>}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="calendar-legend">
                            <div className="legend-item">
                                <span className="legend-dot class">●</span> 수업일
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot holding">●</span> 홀딩 신청
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot selected">●</span> 선택됨
                            </div>
                        </div>
                    </div>

                    {selectedDates.length > 0 && (
                        <div className="selected-info">
                            <p>선택한 날짜: <strong>{selectedDates.length}일</strong></p>
                            <div className="selected-dates-list">
                                {selectedDates.map(dateStr => (
                                    <span key={dateStr} className="selected-date-chip">
                                        {new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                    </span>
                                ))}
                            </div>
                            <button
                                onClick={handleSubmit}
                                className="submit-button"
                                disabled={isSubmitting}
                            >
                                <span>{isSubmitting ? '신청 중...' : '홀딩 신청하기'}</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>

                {/* 홀딩 내역 */}
                <div className="history-card">
                    <h2 className="form-title">홀딩 신청 내역</h2>
                    <div className="history-list">
                        {holdingHistory.length === 0 ? (
                            <p className="empty-message">홀딩 신청 내역이 없습니다.</p>
                        ) : (
                            holdingHistory.map((item, index) => (
                                <div key={index} className="history-item">
                                    <div className="history-info">
                                        <div className="history-date">
                                            {item.startDate === item.endDate
                                                ? item.startDate
                                                : `${item.startDate} ~ ${item.endDate}`}
                                        </div>
                                        <div className="history-days">
                                            {item.dates.length}일
                                        </div>
                                    </div>
                                    <div className={`history-status approved`}>
                                        {item.status}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HoldingManager;
