import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField } from '../services/googleSheetsService';
import {
    getActiveMakeupRequest,
    createMakeupRequest,
    cancelMakeupRequest,
    getMakeupRequestsByWeek,
    getHoldingsByWeek,
    getAbsencesByDate,
    getActiveHolding,
    getAbsencesByStudent
} from '../services/firebaseService';
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
 * Check if student is currently enrolled based on start and end dates
 * @param {Object} student - Student object from Google Sheets
 * @returns {boolean} - True if currently enrolled
 */
const isCurrentlyEnrolled = (student) => {
    const startDateStr = student['시작날짜'];
    const endDateStr = student['종료날짜'];

    if (!startDateStr) {
        console.warn('Student missing start date:', student['이름']);
        return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = parseSheetDate(startDateStr);
    if (!startDate) {
        console.warn('Could not parse start date for student:', student['이름'], startDateStr);
        return false;
    }

    // If no end date, check if start date has passed
    if (!endDateStr) {
        return startDate <= today;
    }

    const endDate = parseSheetDate(endDateStr);
    if (!endDate) {
        console.warn('Could not parse end date for student:', student['이름'], endDateStr);
        return startDate <= today;
    }

    // Check if today is between start date and end date (inclusive)
    const isEnrolled = startDate <= today && today <= endDate;

    console.log(`📅 Enrollment check for ${student['이름']}: start=${startDateStr}, end=${endDateStr}, enrolled=${isEnrolled}`);

    return isEnrolled;
};

/**
 * Transform Google Sheets student data into timetable format
 */
const transformGoogleSheetsData = (students) => {
    const regularEnrollments = [];
    const holds = [];

    // Filter students to only include currently enrolled ones
    const enrolledStudents = students.filter(isCurrentlyEnrolled);

    console.log(`📊 Filtering students: ${students.length} total → ${enrolledStudents.length} currently enrolled`);

    enrolledStudents.forEach((student) => {
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

const WeeklySchedule = ({ user, studentData, onBack }) => {
    const [mode, setMode] = useState(user?.role === 'coach' ? 'coach' : 'student'); // 'student' | 'coach'
    const { students, isAuthenticated, loading } = useGoogleSheets();

    // Makeup request state
    const [showMakeupModal, setShowMakeupModal] = useState(false);
    const [selectedMakeupSlot, setSelectedMakeupSlot] = useState(null);
    const [selectedOriginalClass, setSelectedOriginalClass] = useState(null);
    const [activeMakeupRequest, setActiveMakeupRequest] = useState(null);
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);

    // Coach mode: Firebase data for this week
    const [weekMakeupRequests, setWeekMakeupRequests] = useState([]);
    const [weekHoldings, setWeekHoldings] = useState([]);
    const [weekAbsences, setWeekAbsences] = useState([]);

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
        const key = `${day} -${periodId} `;
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
        const key = `${day} -${periodId} `;
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

    // 수강생 시간표 파싱
    const studentSchedule = useMemo(() => {
        if (!studentData) return [];
        const scheduleStr = getStudentField(studentData, '요일 및 시간');
        console.log('📋 Student schedule string:', scheduleStr);
        const parsed = parseScheduleString(scheduleStr);
        console.log('📋 Parsed student schedule:', parsed);
        return parsed;
    }, [studentData]);

    // Load active makeup request and holding/absence data on mount
    useEffect(() => {
        const loadStudentData = async () => {
            if (mode === 'student' && user) {
                try {
                    // Load makeup request
                    const makeup = await getActiveMakeupRequest(user.username);
                    setActiveMakeupRequest(makeup);

                    // Load holding and absence data for seat calculation
                    const holding = await getActiveHolding(user.username);
                    const absences = await getAbsencesByStudent(user.username);

                    // Calculate this week's date range
                    const today = new Date();
                    const dayOfWeek = today.getDay();
                    const monday = new Date(today);
                    const diff = dayOfWeek === 0 ? 1 : 1 - dayOfWeek;
                    monday.setDate(today.getDate() + diff);

                    const formatDate = (date) => {
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                    };

                    const startDate = formatDate(monday);
                    const friday = new Date(monday);
                    friday.setDate(monday.getDate() + 4);
                    const endDate = formatDate(friday);

                    // Load all makeup requests for this week (to calculate seat availability)
                    const makeups = await getMakeupRequestsByWeek(startDate, endDate);

                    // Store in state for seat calculation
                    if (holding) {
                        setWeekHoldings([holding]);
                    }
                    if (absences && absences.length > 0) {
                        setWeekAbsences(absences);
                    }
                    if (makeups && makeups.length > 0) {
                        setWeekMakeupRequests(makeups);
                    }

                    console.log(`📊 Student data loaded: holding=${!!holding}, absences=${absences?.length || 0}, makeups=${makeups?.length || 0}`);
                } catch (error) {
                    console.error('Failed to load student data:', error);
                }
            }
        };
        loadStudentData();
    }, [mode, user]);

    // Helper function to load weekly data
    const loadWeeklyData = async () => {
        try {
            // Calculate this week's Monday-Friday dates
            const today = new Date();
            const dayOfWeek = today.getDay();
            const monday = new Date(today);
            const diff = dayOfWeek === 0 ? 1 : 1 - dayOfWeek;
            monday.setDate(today.getDate() + diff);

            // Get Monday and Friday dates in YYYY-MM-DD format
            const formatDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const startDate = formatDate(monday);
            // Extend to next Friday to include next week's makeup requests
            const nextFriday = new Date(monday);
            nextFriday.setDate(monday.getDate() + 11); // +11 days = next week Friday
            const endDate = formatDate(nextFriday);

            console.log(`📅 Loading weekly data: ${startDate} ~ ${endDate}`);

            // Load makeup requests and holdings for this week
            const [makeups, holdings] = await Promise.all([
                getMakeupRequestsByWeek(startDate, endDate).catch(err => {
                    console.warn('Failed to load makeup requests:', err);
                    return [];
                }),
                getHoldingsByWeek(startDate, endDate).catch(err => {
                    console.warn('Failed to load holdings:', err);
                    return [];
                })
            ]);

            // Load absences for each day of the week
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(formatDate(date));
            }

            const absencePromises = dates.map(date =>
                getAbsencesByDate(date).catch(err => {
                    console.warn(`Failed to load absences for ${date}:`, err);
                    return [];
                })
            );

            const absenceArrays = await Promise.all(absencePromises);
            const allAbsences = absenceArrays.flat();

            setWeekMakeupRequests(makeups || []);
            setWeekHoldings(holdings || []);
            setWeekAbsences(allAbsences || []);

            console.log(`✅ Loaded ${makeups?.length || 0} makeup requests, ${holdings?.length || 0} holdings, ${allAbsences?.length || 0} absences`);
        } catch (error) {
            console.error('Failed to load weekly data:', error);
            // Don't crash, just set empty arrays
            setWeekMakeupRequests([]);
            setWeekHoldings([]);
            setWeekAbsences([]);
        }
    };

    // Load weekly Firebase data for coach mode and student mode
    useEffect(() => {
        loadWeeklyData();
    }, [mode]); // Only depend on mode, not weekDates

    // Handle available seat click
    const handleAvailableSeatClick = (day, periodId, date) => {
        if (mode !== 'student') return;

        if (activeMakeupRequest) {
            alert('이미 활성화된 보강 신청이 있습니다. 먼저 취소해주세요.');
            return;
        }

        const period = PERIODS.find(p => p.id === periodId);
        // day는 이미 한글 요일 (월, 화, 수, 목, 금)
        const makeupSlot = { day, period: periodId, periodName: period.name, date };
        console.log('🎯 Selected makeup slot:', makeupSlot);
        console.log('   day:', day, 'periodName:', period.name, 'date:', date);
        setSelectedMakeupSlot(makeupSlot);
        setShowMakeupModal(true);
    };

    // Handle makeup submission
    const handleMakeupSubmit = async () => {
        if (!selectedOriginalClass || !selectedMakeupSlot) return;

        setIsSubmittingMakeup(true);
        try {
            await createMakeupRequest(user.username, selectedOriginalClass, selectedMakeupSlot);
            alert(`보강 신청 완료!\n${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} → ${selectedMakeupSlot.day}요일 ${selectedMakeupSlot.periodName} `);

            // Reload makeup request data
            const makeup = await getActiveMakeupRequest(user.username);
            setActiveMakeupRequest(makeup);

            // Reload weekly data to update seat availability immediately
            await loadWeeklyData();

            setShowMakeupModal(false);
            setSelectedMakeupSlot(null);
            setSelectedOriginalClass(null);
        } catch (error) {
            alert(`보강 신청 실패: ${error.message} `);
        } finally {
            setIsSubmittingMakeup(false);
        }
    };

    // Handle makeup cancellation
    const handleMakeupCancel = async () => {
        if (!activeMakeupRequest || !confirm('보강 신청을 취소하시겠습니까?')) return;

        try {
            await cancelMakeupRequest(activeMakeupRequest.id);
            alert('보강 신청이 취소되었습니다.');
            setActiveMakeupRequest(null);
        } catch (error) {
            alert(`보강 신청 취소 실패: ${error.message} `);
        }
    };

    // 현재 셀이 수강생의 등록된 수업인지 확인
    const isMyClass = (day, periodId) => {
        return studentSchedule.some(s => s.day === day && s.period === periodId);
    };

    // 이번 주 날짜 계산 (월~금)
    const weekDates = useMemo(() => {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0(일) ~ 6(토)

        // 이번 주 월요일 찾기
        // 일요일(0)이면 다음 주 월요일(+1일)
        // 월요일(1)이면 오늘(+0일)
        // 화요일(2)~토요일(6)이면 이번 주 월요일
        const monday = new Date(today);
        let diff;
        if (dayOfWeek === 0) {
            // 일요일: 다음 주 월요일 (내일)
            diff = 1;
        } else {
            // 월~토: 이번 주 월요일
            diff = 1 - dayOfWeek;
        }
        monday.setDate(today.getDate() + diff);

        // 월~금 날짜 생성
        const dates = {};
        const dayNames = ['월', '화', '수', '목', '금'];

        dayNames.forEach((dayName, index) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + index);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            dates[dayName] = `${month}/${day}`;
        });

        return dates;
    }, []);

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

        // 4. Firebase data processing (Both student and coach modes)
        let makeupStudents = [];
        let makeupAbsentStudents = [];
        let holdingStudents = [];

        // Get date for this slot
        const dateStr = weekDates[day];
        if (dateStr) {
            const [month, dayNum] = dateStr.split('/');
            const year = new Date().getFullYear();
            const slotDate = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

            if (mode === 'coach') {
                console.log(`🔍 Checking ${day} ${periodObj.name} (${slotDate})`);
                console.log(`   Makeup requests:`, weekMakeupRequests.length);
                console.log(`   Holdings:`, weekHoldings.length);
            }

            // Find makeup students coming TO this slot
            makeupStudents = weekMakeupRequests
                .filter(m => {
                    const match = m.makeupClass.day === day &&
                        m.makeupClass.period === periodObj.id &&
                        m.makeupClass.date === slotDate;
                    if (match && mode === 'coach') {
                        console.log(`   ✓ Makeup TO found: ${m.studentName} (${m.originalClass.day} ${m.originalClass.periodName} → ${m.makeupClass.day} ${m.makeupClass.periodName})`);
                    }
                    return match;
                })
                .map(m => m.studentName);

            // Find students absent FROM this slot due to makeup
            makeupAbsentStudents = weekMakeupRequests
                .filter(m => {
                    const match = m.originalClass.day === day &&
                        m.originalClass.period === periodObj.id &&
                        m.originalClass.date === slotDate;
                    if (match && mode === 'coach') {
                        console.log(`   ✓ Makeup FROM found: ${m.studentName} (${m.originalClass.day} ${m.originalClass.periodName} → ${m.makeupClass.day} ${m.makeupClass.periodName})`);
                    }
                    return match;
                })
                .map(m => m.studentName);

            // Find students on holding during this date
            holdingStudents = weekHoldings
                .filter(h => {
                    const isInRange = h.startDate <= slotDate && h.endDate >= slotDate;
                    if (isInRange && mode === 'coach') {
                        console.log(`   ✓ Holding found: ${h.studentName} (${h.startDate} ~ ${h.endDate})`);
                    }
                    return isInRange;
                })
                .map(h => h.studentName)
                .filter(name => studentNames.includes(name));

            // Find students with absence requests for this date
            const absenceStudents = weekAbsences
                .filter(a => a.date === slotDate)
                .map(a => a.studentName);

            // Combine makeup absent and absence request students
            makeupAbsentStudents = [...new Set([...makeupAbsentStudents, ...absenceStudents])];

            if (mode === 'coach') {
                if (makeupStudents.length > 0) {
                    console.log(`   → Makeup students: ${makeupStudents.join(', ')}`);
                }
                if (makeupAbsentStudents.length > 0) {
                    console.log(`   → Makeup/Absence absent: ${makeupAbsentStudents.join(', ')}`);
                }
                if (holdingStudents.length > 0) {
                    console.log(`   → Holding students: ${holdingStudents.join(', ')}`);
                }
            }
        }

        // 5. Calculate counts
        // Active Students = (Regular - Holds - MakeupAbsent - Holding) + Substitutes + MakeupStudents
        const activeStudents = studentNames.filter(name =>
            !holdNames.includes(name) &&
            !makeupAbsentStudents.includes(name) &&
            !holdingStudents.includes(name)
        );

        // Regular students who are on the roster (not holding, but may be makeup-absent)
        const regularStudentsPresent = studentNames.filter(name =>
            !holdNames.includes(name) &&
            !holdingStudents.includes(name)
        );

        const currentCount = activeStudents.length + subs.length + makeupStudents.length;
        const availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
        const isFull = availableSeats === 0;

        return {
            studentNames,
            holdNames,
            subs,
            currentCount,
            availableSeats,
            isFull,
            activeStudents,
            makeupStudents,
            makeupAbsentStudents,
            holdingStudents,
            regularStudentsPresent
        };
    };

    const handleCellClick = (day, periodObj, cellData) => {
        if (periodObj.type === 'free') return;

        if (mode === 'student') {
            if (cellData.isFull) {
                alert('만석입니다.');
            } else {
                // Calculate date for this slot
                const dateStr = weekDates[day];
                if (dateStr) {
                    const [month, dayNum] = dateStr.split('/');
                    const year = new Date().getFullYear();
                    // Use UTC to avoid timezone issues
                    const dateFormatted = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

                    handleAvailableSeatClick(day, periodObj.id, dateFormatted);
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
            // Check if this is my class
            const myClass = isMyClass(day, periodObj.id);

            // Check if there are registered students (even if on hold)
            const hasRegisteredStudents = data.studentNames.length > 0;

            // If class is disabled by coach AND no registered students, show "수업 없음"
            if (classDisabled && !hasRegisteredStudents) {
                return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
            }

            // If it is my class, highlight it!
            if (myClass) {
                return (
                    <div
                        className="schedule-cell cell-available my-class"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge">MY</span>
                        </div>
                    </div>
                );
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

            // If no students at all (including holding and makeup-absent), show empty cell
            if (data.currentCount === 0 &&
                data.holdNames.length === 0 &&
                data.holdingStudents.length === 0 &&
                data.makeupAbsentStudents.length === 0) {
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
                        {/* 1. Regular Students Present (not on hold, not holding) - show with makeup-absent styling if applicable */}
                        {data.regularStudentsPresent.map(name => {
                            const isMakeupAbsent = data.makeupAbsentStudents.includes(name);
                            if (isMakeupAbsent) {
                                return (
                                    <span key={name} className="student-tag" style={{ backgroundColor: '#fef3c7', color: '#92400e', textDecoration: 'line-through' }}>
                                        {name}(보강결석)
                                    </span>
                                );
                            }
                            return <span key={name} className="student-tag">{name}</span>;
                        })}

                        {/* 2. Makeup Students (coming TO this slot) */}
                        {data.makeupStudents.map(name => (
                            <span key={`makeup-${name}`} className="student-tag substitute">{name}(보강)</span>
                        ))}

                        {/* 3. Holding Students */}
                        {data.holdingStudents.map(name => (
                            <span key={`holding-${name}`} className="student-tag" style={{ backgroundColor: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' }}>{name}(홀딩)</span>
                        ))}

                        {/* 4. Substitutes (legacy) */}
                        {data.subs.map(sub => (
                            <span key={sub.name} className="student-tag substitute">{sub.name}</span>
                        ))}

                        {/* 5. Holds (legacy - already shown in holdingStudents) */}
                        {data.holdNames.filter(name => !data.holdingStudents.includes(name)).map(name => (
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

            {user?.role === 'coach' && (
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
            )}

            {students && students.length > 0 && (
                <div style={{ textAlign: 'center', marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
                    📊 Google Sheets 연동됨 ({students.length}명의 수강생)
                </div>
            )}

            <div className="schedule-grid">
                {/* Top Header: Time Label + Days */}
                <div className="grid-header"></div> {/* Empty corner slot */}
                {DAYS.map(day => (
                    <div key={day} className="grid-header">
                        {day} ({weekDates[day]})
                    </div>
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

            {/* Makeup Request Modal */}
            {showMakeupModal && mode === 'student' && selectedMakeupSlot && (
                <div className="makeup-modal-overlay" onClick={() => setShowMakeupModal(false)}>
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
                                    console.log('📝 Rendering schedule item:');
                                    console.log('   schedule.day:', schedule.day);
                                    console.log('   schedule.period:', schedule.period);
                                    console.log('   periodInfo:', periodInfo);
                                    console.log('   periodInfo?.name:', periodInfo?.name);
                                    return (
                                        <div
                                            key={index}
                                            className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''}`}
                                            onClick={() => {
                                                const today = new Date();
                                                const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
                                                const targetDay = dayMap[schedule.day];
                                                const currentDay = today.getDay();

                                                let daysUntilTarget = targetDay - currentDay;
                                                if (daysUntilTarget <= 0) daysUntilTarget += 7;

                                                const originalDate = new Date(today);
                                                originalDate.setDate(today.getDate() + daysUntilTarget);
                                                const originalDateStr = originalDate.toISOString().split('T')[0];

                                                setSelectedOriginalClass({
                                                    day: schedule.day,
                                                    period: schedule.period,
                                                    periodName: periodInfo.name,
                                                    date: originalDateStr
                                                });
                                            }}
                                        >
                                            <span className="period-name">{schedule.day}요일 {periodInfo?.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="makeup-modal-actions">
                            <button
                                className="btn-cancel"
                                onClick={() => {
                                    setShowMakeupModal(false);
                                    setSelectedMakeupSlot(null);
                                    setSelectedOriginalClass(null);
                                }}
                            >
                                취소
                            </button>
                            <button
                                className="btn-submit"
                                onClick={handleMakeupSubmit}
                                disabled={!selectedOriginalClass || isSubmittingMakeup}
                            >
                                {isSubmittingMakeup ? '신청 중...' : '보강 신청'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Active Makeup Banner */}
            {activeMakeupRequest && mode === 'student' && (
                <div className="active-makeup-banner">
                    <div className="banner-content">
                        <span className="banner-icon">🔄</span>
                        <div className="banner-text">
                            <strong>활성 보강:</strong> {activeMakeupRequest.originalClass.day}요일 {activeMakeupRequest.originalClass.periodName} → {activeMakeupRequest.makeupClass.day}요일 {activeMakeupRequest.makeupClass.periodName}
                        </div>
                        <button className="banner-cancel-btn" onClick={handleMakeupCancel}>취소</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WeeklySchedule;
