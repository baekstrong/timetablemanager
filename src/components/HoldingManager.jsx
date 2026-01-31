import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { PERIODS } from '../data/mockData';
import { getStudentField } from '../services/googleSheetsService';
import {
    createHoldingRequest,
    createAbsenceRequest,
    getActiveHolding,
    getAbsencesByStudent,
    cancelHolding,
    cancelAbsence
} from '../services/firebaseService';
import './HoldingManager.css';

// 로컬 날짜를 YYYY-MM-DD 형식으로 변환 (timezone 문제 방지)
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

// 특정 날짜가 공휴일인지 확인
const isHoliday = (date) => {
    const dateStr = formatLocalDate(date);
    return KOREAN_HOLIDAYS_2026[dateStr];
};

const HoldingManager = ({ user, studentData, onBack }) => {
    const { requestHolding } = useGoogleSheets();
    const [requestType, setRequestType] = useState('holding'); // 'holding' | 'absence'
    const [selectedDates, setSelectedDates] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeHolding, setActiveHolding] = useState(null);
    const [absences, setAbsences] = useState([]);

    // 달력 월 선택 (기본값: 현재 월)
    const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());

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
        // 종료날짜 필드명 확인 (여러 가지 이름 지원)
        const endDateStr = studentData['종료날짜'] || studentData['종료일'] || studentData['endDate'];

        console.log('📅 수강 기간 파싱:', { startDateStr, endDateStr });

        return {
            start: parseDate(startDateStr),
            end: parseDate(endDateStr)
        };
    }, [studentData]);

    // 주 횟수 (홀딩 가능 횟수 제한용)
    const weeklyFrequency = useMemo(() => {
        if (!studentData) return 2;
        const freq = parseInt(studentData['주횟수']) || 2;
        return freq;
    }, [studentData]);

    // 홀딩 사용 여부 확인 (1회 제한)
    const hasUsedHolding = useMemo(() => {
        if (!studentData) return false;
        const holdingUsed = getStudentField(studentData, '홀딩 사용여부');
        return holdingUsed === 'O' || holdingUsed === 'o';
    }, [studentData]);

    // 홀딩 내역 조회 (수업일만 표시)
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
            const formatLocalDateInner = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            // 수업 요일 목록
            const classDays = schedule.map(s => {
                const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };
                return dayMap[s.day];
            });

            const startDate = parseDate(holdingStart);
            const endDate = parseDate(holdingEnd) || startDate;

            if (startDate) {
                const dates = [];
                const current = new Date(startDate);
                while (current <= endDate) {
                    // 수업일인 경우에만 dates에 추가
                    if (classDays.includes(current.getDay())) {
                        dates.push(formatLocalDateInner(current));
                    }
                    current.setDate(current.getDate() + 1);
                }

                return [{
                    startDate: formatLocalDateInner(startDate),
                    endDate: formatLocalDateInner(endDate),
                    dates,
                    status: '승인됨'
                }];
            }
        }

        return [];
    }, [studentData, schedule]);

    // Load active holding and absences from Firebase
    useEffect(() => {
        const loadData = async () => {
            if (!user) return;

            try {
                const holding = await getActiveHolding(user.username);
                setActiveHolding(holding);

                const absenceList = await getAbsencesByStudent(user.username);
                setAbsences(absenceList);
            } catch (error) {
                console.error('Failed to load holding/absence data:', error);
            }
        };
        loadData();
    }, [user]);

    // 달력 생성 (월~금만 표시, 모든 날짜 표시)
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

        // 첫 평일이 무슨 요일인지 확인 (1=월, 2=화, 3=수, 4=목, 5=금)
        const firstWeekdayOfWeek = firstWeekday.getDay();

        // 빈 칸 추가 (월요일 = 0칸, 화요일 = 1칸, ...)
        const emptySlots = firstWeekdayOfWeek - 1; // 1(월)=0, 2(화)=1, ...
        for (let i = 0; i < emptySlots; i++) {
            dates.push(null);
        }

        // 이번 달 날짜 (월~금만 표시, 토/일은 건너뛰기)
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const date = new Date(year, month, day);
            const dayOfWeek = date.getDay();

            // 토요일(6) 또는 일요일(0)이면 건너뛰기
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                continue;
            }

            // 모든 평일 날짜 표시 (수강 기간 외의 날짜도 보여줌)
            dates.push(date);
        }

        return { year, month, dates };
    }, [calendarYear, calendarMonth]);

    // 특정 날짜가 수강 기간 내인지 확인
    const isWithinMembershipPeriod = (date) => {
        if (!date || !membershipPeriod.start || !membershipPeriod.end) return true;

        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);

        const startOnly = new Date(membershipPeriod.start);
        startOnly.setHours(0, 0, 0, 0);

        const endOnly = new Date(membershipPeriod.end);
        endOnly.setHours(0, 0, 0, 0);

        return dateOnly >= startOnly && dateOnly <= endOnly;
    };

    // 이전 달로 이동
    const goToPreviousMonth = () => {
        if (calendarMonth === 0) {
            setCalendarYear(calendarYear - 1);
            setCalendarMonth(11);
        } else {
            setCalendarMonth(calendarMonth - 1);
        }
        setSelectedDates([]); // 선택된 날짜 초기화
    };

    // 다음 달로 이동
    const goToNextMonth = () => {
        if (calendarMonth === 11) {
            setCalendarYear(calendarYear + 1);
            setCalendarMonth(0);
        } else {
            setCalendarMonth(calendarMonth + 1);
        }
        setSelectedDates([]); // 선택된 날짜 초기화
    };

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
        // 홀딩 사용 여부 확인 (1회 제한)
        if (hasUsedHolding && requestType === 'holding') {
            alert('홀딩은 등록 기간 중 1회만 사용 가능합니다.\n이미 홀딩을 사용하셨습니다.');
            return;
        }

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

        // 주 횟수만큼만 홀딩 가능 (주2회→2회, 주3회→3회)
        // 선택된 날짜 중 실제 수업일만 카운트
        const selectedClassDays = newDates.filter(d => {
            const dateObj = new Date(d + 'T00:00:00');
            return isClassDay(dateObj);
        });

        if (selectedClassDays.length > weeklyFrequency) {
            alert(`홀딩은 주 ${weeklyFrequency}회 수업 기준 최대 ${weeklyFrequency}회까지만 가능합니다.`);
            return;
        }

        setSelectedDates(newDates);
    };

    // 홀딩 신청 핸들러
    const handleSubmit = async () => {
        if (selectedDates.length === 0 || !user) return;

        // 홀딩 사용 여부 재확인
        if (hasUsedHolding && requestType === 'holding') {
            alert('홀딩은 등록 기간 중 1회만 사용 가능합니다.\n이미 홀딩을 사용하셨습니다.');
            return;
        }

        setIsSubmitting(true);
        try {
            const sortedDates = [...selectedDates].sort();

            if (requestType === 'holding') {
                // 홀딩 신청 - Firebase에 저장
                const startDate = sortedDates[0];
                const endDate = sortedDates[sortedDates.length - 1];

                await createHoldingRequest(user.username, startDate, endDate);

                // Google Sheets에도 저장 (기존 시스템 호환)
                const parseLocalDate = (dateStr) => {
                    const [year, month, day] = dateStr.split('-').map(Number);
                    return new Date(year, month - 1, day);
                };
                const startDateObj = parseLocalDate(startDate);
                const endDateObj = parseLocalDate(endDate);
                await requestHolding(user.username, startDateObj, endDateObj);

                alert(`홀딩 신청이 완료되었습니다.\n기간: ${startDate} ~ ${endDate}`);

                // Reload data
                const holding = await getActiveHolding(user.username);
                setActiveHolding(holding);
            } else {
                // 결석 신청 - Firebase에 저장
                for (const date of sortedDates) {
                    await createAbsenceRequest(user.username, date);
                }

                alert(`결석 신청이 완료되었습니다.\n날짜: ${sortedDates.join(', ')}`);

                // Reload data
                const absenceList = await getAbsencesByStudent(user.username);
                setAbsences(absenceList);
            }

            setSelectedDates([]);
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
                            <li>홀딩은 주 {weeklyFrequency}회 수업 기준 최대 <strong>{weeklyFrequency}회</strong>까지 가능합니다.</li>
                            <li>홀딩은 등록 기간 중 <strong>1회만</strong> 사용 가능합니다.</li>
                        </ul>
                    </div>
                </div>

                {/* 홀딩 사용 완료 알림 */}
                {hasUsedHolding && (
                    <div className="info-card" style={{ background: '#fee2e2', borderColor: '#ef4444' }}>
                        <div className="info-icon">⚠️</div>
                        <div className="info-content">
                            <h3 style={{ color: '#dc2626' }}>홀딩 사용 완료</h3>
                            <p style={{ margin: 0, color: '#7f1d1d' }}>
                                이미 홀딩을 사용하셨습니다. 등록 기간 중 홀딩은 1회만 사용 가능합니다.
                            </p>
                        </div>
                    </div>
                )}

                {/* 현재 활성 홀딩/결석 목록 - Google Sheets 데이터 기준 */}
                {(holdingHistory.length > 0 || absences.length > 0) && (
                    <div className="info-card" style={{ marginBottom: '24px', background: '#f0f4ff', borderColor: '#667eea' }}>
                        <div className="info-icon">📋</div>
                        <div className="info-content">
                            <h3 style={{ color: '#4338ca' }}>현재 신청 내역</h3>

                            {holdingHistory.length > 0 && (() => {
                                // Google Sheets의 홀딩 데이터 사용
                                const holdingData = holdingHistory[0];

                                // 홀딩 시작일의 첫 수업 시간이 지났는지 확인
                                const holdingStartDate = new Date(holdingData.startDate + 'T00:00:00');
                                const dayOfWeek = holdingStartDate.getDay();
                                const dayMap = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
                                const dayName = dayMap[dayOfWeek];
                                const classInfo = schedule.find(s => s.day === dayName);

                                let canCancelHolding = true;
                                if (classInfo) {
                                    const period = PERIODS.find(p => p.id === classInfo.period);
                                    if (period) {
                                        const classDateTime = new Date(holdingStartDate);
                                        classDateTime.setHours(period.startHour, period.startMinute, 0, 0);
                                        canCancelHolding = new Date() < classDateTime;
                                    }
                                }

                                return (
                                    <div style={{ marginTop: '12px', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #667eea' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <strong style={{ color: '#667eea' }}>⏸️ 홀딩</strong>
                                                <div style={{ fontSize: '14px', marginTop: '4px', color: '#374151' }}>
                                                    {holdingData.startDate} ~ {holdingData.endDate}
                                                    <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '12px' }}>
                                                        ({holdingData.dates.length}일)
                                                    </span>
                                                </div>
                                            </div>
                                            {canCancelHolding && activeHolding ? (
                                                <button
                                                    onClick={async () => {
                                                        if (confirm('홀딩을 취소하시겠습니까?')) {
                                                            try {
                                                                await cancelHolding(activeHolding.id);
                                                                setActiveHolding(null);
                                                                alert('홀딩이 취소되었습니다.');
                                                            } catch (error) {
                                                                alert('취소 실패: ' + error.message);
                                                            }
                                                        }
                                                    }}
                                                    style={{
                                                        padding: '6px 12px',
                                                        background: '#dc2626',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        fontSize: '13px'
                                                    }}
                                                >
                                                    취소
                                                </button>
                                            ) : (
                                                <span style={{
                                                    padding: '6px 12px',
                                                    background: '#e5e7eb',
                                                    color: '#6b7280',
                                                    borderRadius: '6px',
                                                    fontSize: '13px'
                                                }}>
                                                    {canCancelHolding ? '승인됨' : '수업 시작됨'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {absences.length > 0 && (
                                <div style={{ marginTop: '12px' }}>
                                    <strong style={{ color: '#764ba2' }}>❌ 결석</strong>
                                    {absences.map(absence => {
                                        // 결석 날짜의 수업 시간이 지났는지 확인
                                        const absenceDate = new Date(absence.date + 'T00:00:00');
                                        const dayOfWeek = absenceDate.getDay();
                                        const dayMap = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금' };
                                        const dayName = dayMap[dayOfWeek];
                                        const classInfo = schedule.find(s => s.day === dayName);

                                        let canCancelAbsence = true;
                                        if (classInfo) {
                                            const period = PERIODS.find(p => p.id === classInfo.period);
                                            if (period) {
                                                const classDateTime = new Date(absenceDate);
                                                classDateTime.setHours(period.startHour, period.startMinute, 0, 0);
                                                canCancelAbsence = new Date() < classDateTime;
                                            }
                                        }

                                        return (
                                            <div key={absence.id} style={{ marginTop: '8px', padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #764ba2' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ fontSize: '14px', color: '#374151' }}>
                                                        {absence.date}
                                                    </div>
                                                    {canCancelAbsence ? (
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm('결석을 취소하시겠습니까?')) {
                                                                    try {
                                                                        await cancelAbsence(absence.id);
                                                                        const updated = await getAbsencesByStudent(user.username);
                                                                        setAbsences(updated);
                                                                        alert('결석이 취소되었습니다.');
                                                                    } catch (error) {
                                                                        alert('취소 실패: ' + error.message);
                                                                    }
                                                                }
                                                            }}
                                                            style={{
                                                                padding: '6px 12px',
                                                                background: '#dc2626',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontSize: '13px'
                                                            }}
                                                        >
                                                            취소
                                                        </button>
                                                    ) : (
                                                        <span style={{
                                                            padding: '6px 12px',
                                                            background: '#e5e7eb',
                                                            color: '#6b7280',
                                                            borderRadius: '6px',
                                                            fontSize: '13px'
                                                        }}>
                                                            수업 시작됨
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 신청 유형 선택 */}
                <div className="request-type-selector">
                    <label className={`type-option ${requestType === 'holding' ? 'selected' : ''} ${hasUsedHolding ? 'disabled' : ''}`}>
                        <input
                            type="radio"
                            name="requestType"
                            value="holding"
                            checked={requestType === 'holding'}
                            disabled={hasUsedHolding}
                            onChange={() => {
                                setRequestType('holding');
                                setSelectedDates([]);
                            }}
                        />
                        <span className="type-icon">⏸️</span>
                        <span className="type-label">홀딩 신청</span>
                        <span className="type-desc">{hasUsedHolding ? '사용 완료' : '연속 기간 홀딩'}</span>
                    </label>
                    <label className={`type-option ${requestType === 'absence' ? 'selected' : ''}`}>
                        <input
                            type="radio"
                            name="requestType"
                            value="absence"
                            checked={requestType === 'absence'}
                            onChange={() => {
                                setRequestType('absence');
                                setSelectedDates([]);
                            }}
                        />
                        <span className="type-icon">❌</span>
                        <span className="type-label">결석 신청</span>
                        <span className="type-desc">특정 날짜 결석</span>
                    </label>
                </div>

                {/* 달력 */}
                <div className="calendar-card">
                    <h2 className="form-title">홀딩 날짜 선택</h2>
                    <p className="calendar-subtitle">수업일을 클릭하여 홀딩할 날짜를 선택하세요 (여러 날짜 선택 가능)</p>
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

                                const isInPeriod = isWithinMembershipPeriod(date);
                                const isClass = isClassDay(date) && isInPeriod; // 수강 기간 내의 수업일만 표시
                                const isHolding = isHoldingDate(date);
                                const isAbsence = absences.some(a => a.date === formatLocalDate(date));
                                const isSelected = selectedDates.includes(formatLocalDate(date));
                                const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
                                const holidayName = isHoliday(date);
                                const isOutOfPeriod = !isInPeriod; // 수강 기간 외 날짜
                                const canRequest = isClass && canRequestHolding(date) && !isHolding && !isAbsence && !holidayName && isInPeriod;

                                return (
                                    <div
                                        key={index}
                                        className={`calendar-day
                                            ${isClass ? 'class-day' : ''}
                                            ${isHolding ? 'holding-day' : ''}
                                            ${isAbsence ? 'absence-day' : ''}
                                            ${isSelected ? 'selected' : ''}
                                            ${holidayName ? 'holiday-day' : ''}
                                            ${!canRequest ? 'disabled' : ''}
                                            ${isPast ? 'past' : ''}
                                            ${isOutOfPeriod ? 'out-of-period' : ''}`}
                                        onClick={() => handleDateClick(date)}
                                    >
                                        <span className="day-number">{date.getDate()}</span>
                                        {isClass && <span className="class-indicator">●</span>}
                                        {isHolding && <span className="holding-badge">홀딩</span>}
                                        {isAbsence && <span className="absence-badge">결석</span>}
                                        {holidayName && <span className="holiday-badge">{holidayName}</span>}
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
                                <span className="legend-dot absence">●</span> 결석 신청
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot holiday">●</span> 공휴일
                            </div>
                            <div className="legend-item">
                                <span className="legend-dot selected">●</span> 선택됨
                            </div>
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
                            <span>{isSubmitting ? '신청 중...' : (requestType === 'holding' ? '홀딩 신청하기' : '결석 신청하기')}</span>
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
    );
};

export default HoldingManager;
