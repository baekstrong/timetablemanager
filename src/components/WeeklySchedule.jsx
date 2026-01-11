import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField } from '../services/googleSheetsService';
import { PERIODS, DAYS, MOCK_DATA, MAX_CAPACITY } from '../data/mockData';
import './WeeklySchedule.css';

/**
 * Parse schedule string from Google Sheets
 * Examples: "월5수5" → [{day: '월', period: 5}, {day: '수', period: 5}]
 *           "화4목4" → [{day: '화', period: 4}, {day: '목', period: 4}]
 */
const parseScheduleString = (scheduleStr) => {
    if (!scheduleStr || typeof scheduleStr !== 'string') return [];

    const result = [];
    const dayMap = { '월': '월', '화': '화', '수': '수', '목': '목', '금': '금', '토': '토', '일': '일' };

    // Remove spaces and split into characters
    const chars = scheduleStr.replace(/\s/g, '');

    let i = 0;
    while (i < chars.length) {
        const char = chars[i];

        // Check if it's a day character
        if (dayMap[char]) {
            const day = char;
            i++;

            // Look for following numbers (period)
            let periodStr = '';
            while (i < chars.length && /\d/.test(chars[i])) {
                periodStr += chars[i];
                i++;
            }

            if (periodStr) {
                const period = parseInt(periodStr);
                if (period >= 1 && period <= 6) {
                    result.push({ day, period });
                }
            }
        } else {
            i++;
        }
    }

    return result;
};

/**
 * Parse date string from Google Sheets (YYMMDD format)
 * Example: "260111" → Date(2026, 0, 11)
 */
const parseSheetDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return null;

    // Remove any non-digit characters
    const cleaned = dateStr.replace(/\D/g, '');

    if (cleaned.length !== 6) return null;

    const year = parseInt('20' + cleaned.substring(0, 2)); // 26 → 2026
    const month = parseInt(cleaned.substring(2, 4)) - 1; // 01 → 0 (January)
    const day = parseInt(cleaned.substring(4, 6)); // 11 → 11

    return new Date(year, month, day);
};

/**
 * Check if student is currently on hold
 */
const isCurrentlyOnHold = (student) => {
    const holdingStatus = getStudentField(student, '홀딩 사용여부');

    // If holding status is not 'O', not on hold
    if (holdingStatus !== 'O' && holdingStatus?.toLowerCase() !== 'o') {
        return false;
    }

    // Get holding dates
    const startDateStr = getStudentField(student, '홀딩 시작일');
    const endDateStr = getStudentField(student, '홀딩 종료일');

    // If no dates specified, use holding status only
    if (!startDateStr || !endDateStr) {
        return true; // Assume on hold if status is 'O' but no dates
    }

    const startDate = parseSheetDate(startDateStr);
    const endDate = parseSheetDate(endDateStr);

    if (!startDate || !endDate) {
        return true; // If dates are invalid, assume on hold
    }

    // Check if current date is within holding period
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time for date comparison

    return today >= startDate && today <= endDate;
};

/**
 * Transform Google Sheets student data into timetable format
 */
const transformGoogleSheetsData = (students) => {
    const regularEnrollments = [];
    const holds = [];

    students.forEach((student) => {
        const name = student['이름'];
        const scheduleStr = student['요일 및 시간'];
        const isHolding = isCurrentlyOnHold(student);

        if (!name || !scheduleStr) return;

        // Parse schedule
        const schedules = parseScheduleString(scheduleStr);

        schedules.forEach(({ day, period }) => {
            // Always add to regular enrollments (even if holding)
            // This ensures studentNames.length > 0 for holding students
            const existing = regularEnrollments.find(
                e => e.day === day && e.period === period
            );

            if (existing) {
                if (!existing.names.includes(name)) {
                    existing.names.push(name);
                }
            } else {
                regularEnrollments.push({
                    day,
                    period,
                    names: [name]
                });
            }

            // If holding, also add to holds array
            if (isHolding) {
                holds.push({ day, period, name });
            }
        });
    });

    return {
        regularEnrollments,
        holds,
        substitutes: [] // Not implemented yet
    };
};

const WeeklySchedule = ({ user, onBack }) => {
    const [mode, setMode] = useState(user?.role || 'student'); // 'student' | 'coach'
    const { students, isAuthenticated, loading } = useGoogleSheets();

    // Class disabled state (stored in localStorage)
    const [disabledClasses, setDisabledClasses] = useState(() => {
        const saved = localStorage.getItem('disabled_classes');
        return saved ? JSON.parse(saved) : [];
    });

    // Save disabled classes to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem('disabled_classes', JSON.stringify(disabledClasses));
    }, [disabledClasses]);

    // Toggle class disabled status
    const toggleClassDisabled = (day, periodId) => {
        const key = `${day}-${periodId}`;
        setDisabledClasses(prev => {
            if (prev.includes(key)) {
                return prev.filter(k => k !== key);
            } else {
                return [...prev, key];
            }
        });
    };

    // Check if class is disabled
    const isClassDisabled = (day, periodId) => {
        const key = `${day}-${periodId}`;
        return disabledClasses.includes(key);
    };

    // Transform Google Sheets data into timetable format
    const scheduleData = useMemo(() => {
        if (!students || students.length === 0) {
            console.log('📅 No Google Sheets data, using MOCK_DATA');
            return MOCK_DATA;
        }

        console.log('📅 Transforming Google Sheets data for timetable:', students);
        const transformed = transformGoogleSheetsData(students);
        console.log('📅 Transformed data:', transformed);
        return transformed;
    }, [students]);

    // --- Logic to process raw data into cell data ---
    const getCellData = (day, periodObj) => {
        // 1. Find Regular Enrollments for this slot
        const regularClass = scheduleData.regularEnrollments.find(
            e => e.day === day && e.period === periodObj.id
        );
        let studentNames = regularClass ? [...regularClass.names] : [];

        // 2. Identify Holds (People who are absent)
        const holds = scheduleData.holds.filter(
            h => h.day === day && h.period === periodObj.id
        );
        const holdNames = holds.map(h => h.name);

        // 3. Identify Substitutes (People filling in)
        const subs = scheduleData.substitutes.filter(
            s => s.day === day && s.period === periodObj.id
        );

        // 4. Calculate counts
        // Active Students = (Regular - Holds) + Substitutes
        const activeStudents = studentNames.filter(name => !holdNames.includes(name));
        const currentCount = activeStudents.length + subs.length;
        const availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
        const isFull = availableSeats === 0;

        return {
            studentNames,
            holdNames,
            subs,
            currentCount,
            availableSeats,
            isFull,
            activeStudents
        };
    };

    const handleCellClick = (day, periodObj, cellData) => {
        if (periodObj.type === 'free') return;

        if (mode === 'student') {
            if (cellData.isFull) {
                alert('만석입니다. 대기 신청을 하시겠습니까?');
            } else {
                if (confirm(`${day}요일 ${periodObj.name}에 수강 신청(보강) 하시겠습니까?`)) {
                    // Logic to add current user as substitute would go here
                    alert('신청되었습니다!');
                }
            }
        } else {
            // Coach Mode
            const attendingList = [
                ...cellData.activeStudents,
                ...cellData.subs.map(s => s.name)
            ].join(', ');
            alert(`[${day}요일 ${periodObj.name} 출석 명단]\n${attendingList}`);
            // Navigate to training log logic would go here
        }
    };

    // Render logic for a single cell
    const renderCell = (day, periodObj) => {
        // Special Case: Free Training (Autonomous)
        if (periodObj.type === 'free') {
            return <div className="schedule-cell cell-free">자율 운동</div>;
        }

        const data = getCellData(day, periodObj);

        // Check if class is disabled by coach
        const classDisabled = isClassDisabled(day, periodObj.id);

        // --- STUDENT MODE RENDER ---
        if (mode === 'student') {
            // Check if there are registered students (even if on hold)
            const hasRegisteredStudents = data.studentNames.length > 0;

            // If class is disabled by coach AND no registered students, show "수업 없음"
            if (classDisabled && !hasRegisteredStudents) {
                return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
            }

            // If class is NOT disabled and no registered students, show available seats (7 자리)
            // This allows students to sign up for coach-activated empty classes
            if (!classDisabled && !hasRegisteredStudents) {
                return (
                    <div
                        className="schedule-cell cell-available"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <span className="seat-count">{MAX_CAPACITY}</span>
                        <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
                    </div>
                );
            }

            // If all students are on hold (registered but not attending), show available seats
            // This should work even if class was previously disabled
            if (data.currentCount === 0 && hasRegisteredStudents) {
                return (
                    <div
                        className="schedule-cell cell-available"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <span className="seat-count">{data.availableSeats}</span>
                        <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
                    </div>
                );
            }
            if (data.isFull) {
                return (
                    <div
                        className="schedule-cell cell-full"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <span className="cell-full-text">Full</span>
                        <span style={{ fontSize: '0.8em' }}>(만석)</span>
                    </div>
                );
            }
            return (
                <div
                    className="schedule-cell cell-available"
                    onClick={() => handleCellClick(day, periodObj, data)}
                >
                    <span className="seat-count">{data.availableSeats}</span>
                    <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
                </div>
            );
        }

        // --- COACH MODE RENDER ---
        else {
            // If class is disabled, show disabled state with toggle
            if (classDisabled) {
                return (
                    <div
                        className="schedule-cell cell-disabled"
                        style={{ backgroundColor: '#f3f4f6', cursor: 'pointer' }}
                        onClick={() => toggleClassDisabled(day, periodObj.id)}
                    >
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>수업 없음</div>
                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '4px' }}>클릭하여 활성화</div>
                    </div>
                );
            }

            if (data.currentCount === 0 && data.holdNames.length === 0) {
                return (
                    <div
                        className="schedule-cell"
                        onClick={() => toggleClassDisabled(day, periodObj.id)}
                        style={{ cursor: 'pointer' }}
                    >
                        <span style={{ color: '#ccc' }}>-</span>
                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '4px' }}>클릭하여 비활성화</div>
                    </div>
                );
            }

            return (
                <div
                    className="schedule-cell"
                    onClick={() => handleCellClick(day, periodObj, data)}
                    style={{ alignItems: 'flex-start', justifyContent: 'flex-start', padding: '8px' }}
                >
                    {/* Header with count for Coach */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 'bold', borderBottom: '1px solid #eee' }}>
                        <span>{data.isFull ? <span style={{ color: 'red' }}>Full</span> : `${data.currentCount}명`}</span>
                    </div>

                    <div className="student-list">
                        {/* 1. Regular Students not on hold */}
                        {data.studentNames.map(name => {
                            const isHold = data.holdNames.includes(name);
                            if (isHold) return null; // Don't show holds in the main list, or show differently? 
                            // Request said: "who is attending"
                            return <span key={name} className="student-tag">{name}</span>;
                        })}

                        {/* 2. Substitutes */}
                        {data.subs.map(sub => (
                            <span key={sub.name} className="student-tag substitute">{sub.name}</span>
                        ))}

                        {/* 3. Holds (Optional: Show struck through or red?) */}
                        {data.holdNames.map(name => (
                            <span key={name} className="student-tag" style={{ backgroundColor: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' }}>{name}</span>
                        ))}
                    </div>
                </div>
            );
        }
    };

    // Show loading state
    if (loading) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    {onBack && (
                        <button onClick={onBack} className="back-button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            뒤로가기
                        </button>
                    )}
                    <h1 className="schedule-page-title">
                        {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                    </h1>
                </div>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <div className="loading-spinner"></div>
                    <p>시간표를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    // Show not connected message
    if (!isAuthenticated) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    {onBack && (
                        <button onClick={onBack} className="back-button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            뒤로가기
                        </button>
                    )}
                    <h1 className="schedule-page-title">
                        {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                    </h1>
                </div>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h3>⚠️ Google Sheets에 연결되지 않았습니다</h3>
                    <p>대시보드에서 Google 계정을 연결해주세요.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="schedule-container">
            <div className="schedule-page-header">
                {onBack && (
                    <button onClick={onBack} className="back-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        뒤로가기
                    </button>
                )}
                <h1 className="schedule-page-title">
                    {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                </h1>
            </div>

            <div className="controls">
                <button
                    className={`mode-toggle ${mode === 'student' ? 'active' : ''}`}
                    onClick={() => setMode('student')}
                >
                    수강생 모드
                </button>
                <button
                    className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                    onClick={() => setMode('coach')}
                >
                    코치 모드
                </button>
            </div>

            {students && students.length > 0 && (
                <div style={{ textAlign: 'center', marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
                    📊 Google Sheets 연동됨 ({students.length}명의 수강생)
                </div>
            )}

            <div className="schedule-grid">
                {/* Top Header: Time Label + Days */}
                <div className="grid-header"></div> {/* Empty corner slot */}
                {DAYS.map(day => (
                    <div key={day} className="grid-header">{day}</div>
                ))}

                {/* Rows: Each Period */}
                {PERIODS.map(period => (
                    <>
                        {/* Time Column */}
                        <div className="time-header">
                            <div className="period-name">{period.name}</div>
                            <div className="period-time">{period.time}</div>
                        </div>

                        {/* Day Columns for this Period */}
                        {DAYS.map(day => (
                            <div key={`${day}-${period.id}`} style={{ display: 'contents' }}>
                                {renderCell(day, period)}
                            </div>
                        ))}
                    </>
                ))}
            </div>

            <div className="legend">
                {mode === 'student' ? (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (대기 가능)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#f59e0b' }}></span> 자율 운동</div>
                    </>
                ) : (
                    <>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem' }}>김철수</span> 출석 예정</div>
                        <div className="legend-item"><span className="student-tag substitute" style={{ fontSize: '0.8rem' }}>이영희(보강)</span> 보강/대타</div>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem', backgroundColor: '#fee2e2', textDecoration: 'line-through' }}>박민수</span> 결석/홀딩</div>
                    </>
                )}
            </div>
        </div>
    );
};

export default WeeklySchedule;
