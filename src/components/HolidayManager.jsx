import { useState, useMemo, useEffect } from 'react';
import { createHoliday, getHolidays, deleteHoliday } from '../services/firebaseService';
import './HoldingManager.css';

// 로컬 날짜를 YYYY-MM-DD 형식으로 변환
const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// 한국 공휴일 데이터 (2026년 기준)
const KOREAN_HOLIDAYS_2026 = {
    '2026-01-01': '신정',
    '2026-02-16': '설날',
    '2026-02-17': '설날',
    '2026-02-18': '설날',
    '2026-03-01': '3·1절',
    '2026-05-05': '어린이날',
    '2026-05-25': '부처님 오신 날',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절',
    '2026-09-24': '추석',
    '2026-09-25': '추석',
    '2026-09-26': '추석',
    '2026-10-03': '개천절',
    '2026-10-09': '한글날',
    '2026-12-25': '크리스마스'
};

const HolidayManager = ({ user, onBack }) => {
    const [selectedDates, setSelectedDates] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [reason, setReason] = useState('');

    // 달력 월 선택 (기본값: 현재 월)
    const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());

    // Firebase에서 휴일 데이터 로드
    useEffect(() => {
        const loadHolidays = async () => {
            try {
                const data = await getHolidays();
                setHolidays(data);
            } catch (error) {
                console.error('휴일 로드 실패:', error);
            }
        };
        loadHolidays();
    }, []);

    // 달력 생성 (월~금만 표시)
    const calendar = useMemo(() => {
        const year = calendarYear;
        const month = calendarMonth;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        const dates = [];

        // 첫 평일 (월~금) 찾기
        let firstWeekday = firstDay;
        while (firstWeekday.getDay() === 0 || firstWeekday.getDay() === 6) {
            firstWeekday = new Date(firstWeekday);
            firstWeekday.setDate(firstWeekday.getDate() + 1);
        }

        // 첫 평일이 무슨 요일인지 확인
        const firstWeekdayOfWeek = firstWeekday.getDay();

        // 빈 칸 추가
        const emptySlots = firstWeekdayOfWeek - 1;
        for (let i = 0; i < emptySlots; i++) {
            dates.push(null);
        }

        // 이번 달 날짜 (월~금만)
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(year, month, day);
            const dayOfWeek = date.getDay();

            if (dayOfWeek === 0 || dayOfWeek === 6) {
                continue;
            }

            dates.push(date);
        }

        return { year, month, dates };
    }, [calendarYear, calendarMonth]);

    // 특정 날짜가 공휴일인지 확인
    const isKoreanHoliday = (date) => {
        const dateStr = formatLocalDate(date);
        return KOREAN_HOLIDAYS_2026[dateStr];
    };

    // 특정 날짜가 설정된 휴일인지 확인
    const isCustomHoliday = (date) => {
        const dateStr = formatLocalDate(date);
        return holidays.find(h => h.date === dateStr);
    };

    // 이전 달로 이동
    const goToPreviousMonth = () => {
        if (calendarMonth === 0) {
            setCalendarYear(calendarYear - 1);
            setCalendarMonth(11);
        } else {
            setCalendarMonth(calendarMonth - 1);
        }
        setSelectedDates([]);
    };

    // 다음 달로 이동
    const goToNextMonth = () => {
        if (calendarMonth === 11) {
            setCalendarYear(calendarYear + 1);
            setCalendarMonth(0);
        } else {
            setCalendarMonth(calendarMonth + 1);
        }
        setSelectedDates([]);
    };

    // 날짜 선택 핸들러
    const handleDateClick = (date) => {
        if (!date) return;

        const dateStr = formatLocalDate(date);

        // 이미 설정된 휴일이면 무시
        if (isCustomHoliday(date)) return;

        // 이미 선택된 날짜면 제거
        if (selectedDates.includes(dateStr)) {
            setSelectedDates(selectedDates.filter(d => d !== dateStr));
            return;
        }

        // 새로운 날짜 추가
        setSelectedDates([...selectedDates, dateStr].sort());
    };

    // 휴일 추가 핸들러
    const handleSubmit = async () => {
        if (selectedDates.length === 0) {
            alert('휴일로 설정할 날짜를 선택해주세요.');
            return;
        }

        setIsSubmitting(true);
        try {
            for (const date of selectedDates) {
                await createHoliday(date, reason || '휴무');
            }

            alert(`${selectedDates.length}일이 휴일로 설정되었습니다.`);

            // 데이터 새로고침
            const data = await getHolidays();
            setHolidays(data);
            setSelectedDates([]);
            setReason('');
        } catch (error) {
            alert(`휴일 설정에 실패했습니다: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // 휴일 삭제 핸들러
    const handleDeleteHoliday = async (holidayId) => {
        if (!confirm('이 휴일을 삭제하시겠습니까?')) return;

        try {
            await deleteHoliday(holidayId);
            const data = await getHolidays();
            setHolidays(data);
            alert('휴일이 삭제되었습니다.');
        } catch (error) {
            alert(`휴일 삭제에 실패했습니다: ${error.message}`);
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
                <h1 className="holding-title">휴일 설정</h1>
            </div>

            <div className="holding-content">
                {/* 안내 카드 */}
                <div className="info-card">
                    <div className="info-icon">ℹ️</div>
                    <div className="info-content">
                        <h3>휴일 설정 안내</h3>
                        <ul>
                            <li>휴가, 개인 사정 등으로 수업이 없는 날을 설정합니다.</li>
                            <li>설정된 휴일은 수강생의 종료일 계산에 자동 반영됩니다.</li>
                            <li>공휴일은 기본적으로 적용되어 있습니다.</li>
                        </ul>
                    </div>
                </div>

                {/* 현재 설정된 휴일 목록 */}
                {holidays.length > 0 && (
                    <div className="info-card" style={{ marginBottom: '24px', background: '#f0f4ff', borderColor: '#667eea' }}>
                        <div className="info-icon">📋</div>
                        <div className="info-content">
                            <h3 style={{ color: '#4338ca' }}>설정된 휴일 목록</h3>
                            <div style={{ marginTop: '12px' }}>
                                {holidays.map(holiday => (
                                    <div key={holiday.id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '8px 12px',
                                        background: '#fff',
                                        borderRadius: '6px',
                                        marginBottom: '8px',
                                        border: '1px solid #e5e7eb'
                                    }}>
                                        <div>
                                            <strong>{holiday.date}</strong>
                                            {holiday.reason && (
                                                <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '14px' }}>
                                                    ({holiday.reason})
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleDeleteHoliday(holiday.id)}
                                            style={{
                                                padding: '4px 8px',
                                                background: '#dc2626',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '12px'
                                            }}
                                        >
                                            삭제
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* 달력 */}
                <div className="calendar-card">
                    <h2 className="form-title">휴일 날짜 선택</h2>
                    <p className="calendar-subtitle">휴일로 설정할 날짜를 클릭하세요 (여러 날짜 선택 가능)</p>
                    <div className="calendar">
                        <div className="calendar-header">
                            <button onClick={goToPreviousMonth} className="month-nav-button">
                                ◀
                            </button>
                            <h3>{calendar.year}년 {calendar.month + 1}월</h3>
                            <button onClick={goToNextMonth} className="month-nav-button">
                                ▶
                            </button>
                        </div>

                        <div className="calendar-weekdays">
                            {['월', '화', '수', '목', '금'].map(day => (
                                <div key={day} className="weekday">{day}</div>
                            ))}
                        </div>

                        <div className="calendar-grid">
                            {calendar.dates.map((date, index) => {
                                if (!date) {
                                    return <div key={index} className="calendar-day empty"></div>;
                                }

                                const isSelected = selectedDates.includes(formatLocalDate(date));
                                const koreanHoliday = isKoreanHoliday(date);
                                const customHoliday = isCustomHoliday(date);
                                const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                                return (
                                    <div
                                        key={index}
                                        className={`calendar-day
                                            ${isSelected ? 'selected' : ''}
                                            ${koreanHoliday ? 'holiday-day' : ''}
                                            ${customHoliday ? 'holding-day' : ''}
                                            ${isPast ? 'past' : ''}`}
                                        onClick={() => handleDateClick(date)}
                                        style={customHoliday ? { background: '#fef3c7', borderColor: '#f59e0b' } : {}}
                                    >
                                        <span className="day-number">{date.getDate()}</span>
                                        {koreanHoliday && <span className="holiday-badge">{koreanHoliday}</span>}
                                        {customHoliday && <span className="holding-badge" style={{ background: '#f59e0b' }}>휴무</span>}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="calendar-legend">
                            <div className="legend-item">
                                <span className="legend-dot holiday">●</span> 공휴일
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot" style={{ background: '#f59e0b' }}>●</span> 설정된 휴일
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot selected">●</span> 선택됨
                            </div>
                        </div>
                    </div>
                </div>

                {/* 휴일 사유 입력 */}
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
                        <div style={{ marginTop: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                                휴일 사유 (선택사항)
                            </label>
                            <input
                                type="text"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="예: 휴가, 개인 사정"
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '8px',
                                    fontSize: '16px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        <button
                            onClick={handleSubmit}
                            className="submit-button"
                            disabled={isSubmitting}
                            style={{ marginTop: '16px' }}
                        >
                            <span>{isSubmitting ? '설정 중...' : '휴일로 설정하기'}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HolidayManager;
