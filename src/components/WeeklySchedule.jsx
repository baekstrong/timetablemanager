import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField, parseHoldingStatus } from '../services/googleSheetsService';
import {
    getActiveMakeupRequest,
    getActiveMakeupRequests,
    createMakeupRequest,
    cancelMakeupRequest,
    completeMakeupRequest,
    getMakeupRequestsByWeek,
    getHoldingsByWeek,
    getAbsencesByDate,
    getActiveHolding,
    getAbsencesByStudent,
    getDisabledClasses,
    toggleDisabledClass,
    getLockedSlots,
    toggleLockedSlot,
    getHolidays,
    getNewStudentRegistrations,
    deleteNewStudentRegistration,
    createWaitlistRequest,
    getActiveWaitlistRequests,
    getAllActiveWaitlist,
    cancelWaitlistRequest,
    notifyWaitlistRequest,
    revertWaitlistNotification,
    acceptWaitlistRequest
} from '../services/firebaseService';
import { writeSheetData } from '../services/googleSheetsService';
import { PERIODS, DAYS, MOCK_DATA, MAX_CAPACITY, KOREAN_HOLIDAYS } from '../data/mockData';
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
 * Parse 특이사항 field to extract agreed absence dates
 * Format: "26.2.10, 26.2.12 결석" → ["2026-02-10", "2026-02-12"]
 */
const parseAgreedAbsenceDates = (notesStr) => {
    if (!notesStr || typeof notesStr !== 'string') return [];

    // Match: one or more "YY.M.D" dates (comma-separated), followed by "결석"
    const absencePattern = /((?:\d{2}\.\d{1,2}\.\d{1,2}(?:\s*,\s*)?)+)\s*결석/g;
    const dates = [];

    let match;
    while ((match = absencePattern.exec(notesStr)) !== null) {
        const datesPart = match[1];
        const dateStrings = datesPart.split(',').map(s => s.trim()).filter(Boolean);

        for (const dateStr of dateStrings) {
            const parts = dateStr.split('.');
            if (parts.length === 3) {
                const year = 2000 + parseInt(parts[0]);
                const month = parseInt(parts[1]);
                const day = parseInt(parts[2]);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                }
            }
        }
    }

    return dates;
};

/**
 * Check if student is currently on hold
 */
const isCurrentlyOnHold = (student) => {
    const holdingStatus = getStudentField(student, '홀딩 사용여부');

    // Parse holding status (supports both 'O' and 'O(1/2)' formats)
    const holdingInfo = parseHoldingStatus(holdingStatus);

    // If holding is not currently used, not on hold
    if (!holdingInfo.isCurrentlyUsed) {
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
 * Check if student is currently enrolled
 * Modified: Now simply checks if schedule string exists (manual control)
 * @param {Object} student - Student object from Google Sheets
 * @returns {boolean} - True if should be displayed in schedule
 */
const isCurrentlyEnrolled = (student) => {
    const scheduleStr = student['요일 및 시간'];

    // If no schedule string, not enrolled
    if (!scheduleStr) {
        return false;
    }

    // Manual control: date checking removed
    // As long as there is a schedule string, we consider the student enrolled
    // This allows manual control via the Google Sheet (clearing the schedule string removes the student)

    /*
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
    */

    return true;
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
    const { students, isAuthenticated, loading, refresh } = useGoogleSheets();

    // 시간표 순서 정렬을 위한 헬퍼 함수
    const getScheduleSortKey = (scheduleStr) => {
        if (!scheduleStr) return 999;
        const parsed = parseScheduleString(scheduleStr);
        if (parsed.length === 0) return 999;
        const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
        // 첫 번째 수업의 요일+교시로 정렬
        const first = parsed[0];
        return (dayOrder[first.day] || 0) * 10 + first.period;
    };

    // Makeup request state (복수 보강 신청 지원)
    const [showMakeupModal, setShowMakeupModal] = useState(false);
    const [selectedMakeupSlot, setSelectedMakeupSlot] = useState(null);
    const [selectedOriginalClass, setSelectedOriginalClass] = useState(null);
    const [activeMakeupRequests, setActiveMakeupRequests] = useState([]); // 배열로 변경
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);

    // 학생의 주횟수 계산
    const weeklyFrequency = useMemo(() => {
        if (!studentData) return 2; // 기본값 2회
        const freqStr = getStudentField(studentData, '주횟수');
        const freq = parseInt(freqStr);
        return isNaN(freq) ? 2 : freq;
    }, [studentData]);

    // Coach mode: Firebase data for this week
    const [weekMakeupRequests, setWeekMakeupRequests] = useState([]);
    const [weekHoldings, setWeekHoldings] = useState([]);
    const [weekAbsences, setWeekAbsences] = useState([]);

    // Holiday state (from Firebase)
    const [weekHolidays, setWeekHolidays] = useState([]);

    // Pending new student registrations (for "신규 전용" mode)
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // 대기/이동 신청 state
    const [weekWaitlist, setWeekWaitlist] = useState([]);
    const [newStudentWaitlist, setNewStudentWaitlist] = useState([]);
    const [showWaitlistDeleteMode, setShowWaitlistDeleteMode] = useState(false);
    const [studentWaitlist, setStudentWaitlist] = useState([]);
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);
    const [waitlistDesiredSlot, setWaitlistDesiredSlot] = useState(null);
    const [waitlistStudentName, setWaitlistStudentName] = useState(''); // 코치가 선택한 수강생
    const [waitlistStudentSearch, setWaitlistStudentSearch] = useState(''); // 검색어
    const [isDirectTransfer, setIsDirectTransfer] = useState(false); // true: 즉시 이동, false: 대기 등록

    // Class disabled state (stored in Firebase)
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [disabledClassesLoading, setDisabledClassesLoading] = useState(true);

    // Locked slots state (보강 차단, stored in Firebase)
    const [lockedSlots, setLockedSlots] = useState([]);
    const [lockedSlotsLoading, setLockedSlotsLoading] = useState(true);

    // 수강생의 실질 종료일 계산 (보강 신청 고려)
    // 종료날짜의 마지막 수업이 보강으로 다른 날로 이동된 경우, 보강 날짜를 실질 종료일로 사용
    const getEffectiveEndDate = (student, endDate) => {
        if (!endDate || !weekMakeupRequests || weekMakeupRequests.length === 0) return endDate;
        const name = student['이름'];
        if (!name) return endDate;

        const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

        // 이 수강생의 종료날짜에 해당하는 원본 수업이 보강으로 이동되었는지 확인
        const makeupFromEndDate = weekMakeupRequests.find(m =>
            m.studentName === name &&
            m.originalClass.date === endDateStr &&
            (m.status === 'active' || m.status === 'completed')
        );

        if (makeupFromEndDate) {
            // 보강 수업 날짜를 실질 종료일로 사용
            const makeupDate = new Date(makeupFromEndDate.makeupClass.date + 'T00:00:00');
            return makeupDate;
        }

        return endDate;
    };

    // 오늘 마지막 날인 수강생 (코치 모드) - 이름(요일 및 시간,결제금액) 형식
    // 보강 신청으로 마지막 수업이 다른 날로 이동된 경우도 고려
    // 오늘 요일의 교시 기준 정렬 + 수업 시간 ±30분 볼드 표시
    const lastDayStudents = (() => {
        if (user?.role !== 'coach' || !students || students.length === 0) return [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const todayDay = todayDayNames[today.getDay()];
        return students.filter(student => {
            const endDateStr = student['종료날짜'];
            if (!endDateStr) return false;
            const endDate = parseSheetDate(endDateStr);
            if (!endDate) return false;
            endDate.setHours(0, 0, 0, 0);

            // 보강 고려한 실질 종료일
            const effectiveEnd = getEffectiveEndDate(student, endDate);
            effectiveEnd.setHours(0, 0, 0, 0);

            return effectiveEnd.getTime() === today.getTime();
        }).map(s => {
            const name = s['이름'];
            if (!name) return null;
            const schedule = s['요일 및 시간'] || '';
            const payment = s['결제금액'] || s['결제\n금액'] || '';
            // 오늘 실제 출석 교시 찾기 (보강 고려)
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            // 보강으로 오늘 다른 교시에 출석하는 경우 확인
            const makeupToday = weekMakeupRequests && weekMakeupRequests.find(m =>
                m.studentName === name &&
                m.makeupClass.date === todayStr &&
                (m.status === 'active' || m.status === 'completed')
            );
            let todayPeriod;
            if (makeupToday) {
                todayPeriod = makeupToday.makeupClass.period;
            } else {
                const parsed = parseScheduleString(schedule);
                const todayClass = parsed.find(p => p.day === todayDay);
                todayPeriod = todayClass ? todayClass.period : 999;
            }
            return { name, schedule, payment, todayPeriod };
        }).filter(Boolean).sort((a, b) => a.todayPeriod - b.todayPeriod);
    })();

    // 재등록 지연 수강생 (종료일 다음날인데 재등록 안한 경우)
    // 같은 이름의 학생이 여러 시트에 존재할 수 있으므로, 가장 최신 종료날짜 행만 사용
    const delayedReregistrationStudents = (() => {
        if (user?.role !== 'coach' || !students || students.length === 0) return [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 학생별로 가장 최신 종료날짜 행만 남기기
        const latestByName = {};
        students.forEach(student => {
            const name = student['이름'];
            if (!name) return;
            const endDateStr = student['종료날짜'];
            if (!endDateStr) return;
            const endDate = parseSheetDate(endDateStr);
            if (!endDate) return;

            if (!latestByName[name] || endDate > latestByName[name].endDate) {
                latestByName[name] = { student, endDate };
            }
        });

        return Object.values(latestByName).filter(({ student, endDate }) => {
            const ed = new Date(endDate);
            ed.setHours(0, 0, 0, 0);

            // 보강 고려한 실질 종료일
            const effectiveEnd = getEffectiveEndDate(student, ed);
            effectiveEnd.setHours(0, 0, 0, 0);

            // 실질 종료일이 오늘 이전 (= 종료일 다음날 이후 = 재등록 필요)
            if (effectiveEnd >= today) return false;
            // 요일 및 시간이 있어야 (아직 종료 처리 안됨)
            const schedule = student['요일 및 시간'];
            if (!schedule || !schedule.trim()) return false;
            return true;
        }).map(({ student, endDate }) => {
            const name = student['이름'];
            const schedule = student['요일 및 시간'] || '';
            const payment = student['결제금액'] || student['결제\n금액'] || '';
            const endDateFormatted = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
            return { name, schedule, payment, endDate: endDateFormatted };
        }).sort((a, b) => getScheduleSortKey(a.schedule) - getScheduleSortKey(b.schedule));
    })();

    // Load disabled classes from Firebase on mount
    useEffect(() => {
        const loadDisabledClasses = async () => {
            try {
                const disabled = await getDisabledClasses();
                setDisabledClasses(disabled);
                console.log('📋 Disabled classes loaded from Firebase:', disabled);
            } catch (error) {
                console.error('Failed to load disabled classes:', error);
                // Fallback to localStorage for backwards compatibility
                const saved = localStorage.getItem('disabled_classes');
                if (saved) {
                    setDisabledClasses(JSON.parse(saved));
                }
            } finally {
                setDisabledClassesLoading(false);
            }
        };
        loadDisabledClasses();
    }, []);

    // Load locked slots from Firebase on mount
    useEffect(() => {
        const loadLockedSlots = async () => {
            try {
                const locked = await getLockedSlots();
                setLockedSlots(locked);
            } catch (error) {
                console.error('Failed to load locked slots:', error);
            } finally {
                setLockedSlotsLoading(false);
            }
        };
        loadLockedSlots();
    }, []);

    // Load pending registrations for "신규 전용" mode + 신규 대기(만석) 목록
    useEffect(() => {
        if (user?.role === 'coach') {
            getNewStudentRegistrations('pending')
                .then(setPendingRegistrations)
                .catch(() => {});
            getNewStudentRegistrations('waitlist')
                .then(setNewStudentWaitlist)
                .catch(() => {});
        }
    }, [user]);

    // Toggle class disabled status (save to Firebase)
    const toggleClassDisabledHandler = async (day, periodId) => {
        const key = `${day}-${periodId}`;
        try {
            const isNowDisabled = await toggleDisabledClass(key);
            setDisabledClasses(prev => {
                if (isNowDisabled) {
                    return [...prev, key];
                } else {
                    return prev.filter(k => k !== key);
                }
            });
        } catch (error) {
            console.error('Failed to toggle class disabled status:', error);
            alert('수업 상태 변경에 실패했습니다.');
        }
    };

    // Check if class is disabled
    const isClassDisabled = (day, periodId) => {
        const key = `${day}-${periodId}`;
        return disabledClasses.includes(key);
    };

    // Toggle locked slot (보강 차단) - 해당 날짜에만 적용, 날짜 지나면 자동 해제
    const toggleLockedSlotHandler = async (day, periodId) => {
        const key = `${day}-${periodId}`;
        // weekDates에서 해당 요일의 날짜를 YYYY-MM-DD로 변환
        const dateMMDD = weekDates[day];
        if (!dateMMDD) return;
        const [month, dayNum] = dateMMDD.split('/');
        const year = new Date().getFullYear();
        const date = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

        try {
            const isNowLocked = await toggleLockedSlot(key, date);
            setLockedSlots(prev => {
                if (isNowLocked) {
                    return [...prev, key];
                } else {
                    return prev.filter(k => k !== key);
                }
            });
        } catch (error) {
            console.error('Failed to toggle locked slot:', error);
            alert('슬롯 잠금 상태 변경에 실패했습니다.');
        }
    };

    // Check if slot is locked
    const isSlotLocked = (day, periodId) => {
        const key = `${day}-${periodId}`;
        return lockedSlots.includes(key);
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

    // Helper function to check if a makeup class is within 1 hour of starting
    const isMakeupClassSoon = (makeupRequest) => {
        if (!makeupRequest || !makeupRequest.makeupClass) return false;

        const { date, period } = makeupRequest.makeupClass;
        const periodInfo = PERIODS.find(p => p.id === period);
        if (!periodInfo) return false;

        const now = new Date();
        const classDate = new Date(date + 'T00:00:00');
        classDate.setHours(periodInfo.startHour, periodInfo.startMinute, 0, 0);

        // 수업 시작 1시간 전
        const oneHourBefore = new Date(classDate.getTime() - 60 * 60 * 1000);

        // 현재 시간이 수업 시작 1시간 전 이후인지 확인
        return now >= oneHourBefore;
    };

    // Helper function to check if a makeup class time has already passed
    const isMakeupClassPassed = (makeupRequest) => {
        if (!makeupRequest || !makeupRequest.makeupClass) return false;

        const { date, period } = makeupRequest.makeupClass;
        const periodInfo = PERIODS.find(p => p.id === period);
        if (!periodInfo) return false;

        const now = new Date();
        const classDate = new Date(date + 'T00:00:00');
        classDate.setHours(periodInfo.startHour, periodInfo.startMinute, 0, 0);

        return now >= classDate;
    };

    // Helper function to check if a class has started or is within 30 minutes of starting
    // Used for preventing makeup requests to classes that are about to start
    const isClassStartingSoon = (date, periodId) => {
        const periodInfo = PERIODS.find(p => p.id === periodId);
        if (!periodInfo) return false;

        const now = new Date();
        const classDate = new Date(date + 'T00:00:00');
        classDate.setHours(periodInfo.startHour, periodInfo.startMinute, 0, 0);

        // 수업 시작 30분 전
        const thirtyMinutesBefore = new Date(classDate.getTime() - 30 * 60 * 1000);

        // 현재 시간이 수업 시작 30분 전 이후인지 확인
        return now >= thirtyMinutesBefore;
    };

    // Helper function to check if a class has already started
    // Used for disabling original class selection in makeup modal
    const hasClassStarted = (date, periodId) => {
        const periodInfo = PERIODS.find(p => p.id === periodId);
        if (!periodInfo) return false;

        const now = new Date();
        const classDate = new Date(date + 'T00:00:00');
        classDate.setHours(periodInfo.startHour, periodInfo.startMinute, 0, 0);

        // 현재 시간이 수업 시작 시간 이후인지 확인
        return now >= classDate;
    };

    // 이번 주 월~금 날짜 범위 계산
    const getThisWeekRange = () => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        monday.setDate(today.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fmt = (d) => d.toISOString().split('T')[0];
        return { start: fmt(monday), end: fmt(sunday) };
    };

    // Load makeup requests for student mode (active + 이번 주 completed)
    useEffect(() => {
        const loadStudentMakeupData = async () => {
            if (mode === 'student' && user && user.role !== 'coach') {
                try {
                    const makeups = await getActiveMakeupRequests(user.username);
                    const { start, end } = getThisWeekRange();

                    // 시간 지난 active 보강 자동완료 처리 (지난주 보강 포함)
                    for (const m of makeups) {
                        if (m.status === 'active' && isMakeupClassPassed(m)) {
                            try {
                                await completeMakeupRequest(m.id);
                                m.status = 'completed';
                                console.log('✅ 수강생 보강 자동 완료:', m.id, m.studentName);
                            } catch (err) {
                                console.error('❌ 수강생 보강 자동 완료 실패:', m.id, err);
                            }
                        }
                    }

                    // active, completed 모두 이번 주 보강 날짜 범위로 필터
                    const thisWeekMakeups = makeups.filter(m => {
                        const makeupDate = m.makeupClass?.date;
                        return makeupDate >= start && makeupDate <= end;
                    });

                    setActiveMakeupRequests(thisWeekMakeups);
                    console.log(`📊 Student makeup data loaded: ${thisWeekMakeups.length}개 (active: ${thisWeekMakeups.filter(m => m.status === 'active').length}, completed: ${thisWeekMakeups.filter(m => m.status === 'completed').length})`);

                    // 수강생 대기 신청 목록 로드
                    const waitlist = await getActiveWaitlistRequests(user.username);
                    setStudentWaitlist(waitlist);
                } catch (error) {
                    console.error('Failed to load student makeup data:', error);
                }
            }
        };
        loadStudentMakeupData();
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

            // For holdings, only use current week (Monday to Friday)
            const currentFriday = new Date(monday);
            currentFriday.setDate(monday.getDate() + 4); // +4 days = this week Friday
            const thisWeekEndDate = formatDate(currentFriday); // Renamed to avoid collision with inner scope

            console.log(`📅 Loading weekly data: ${startDate} ~ ${endDate}`);
            console.log(`📅 Holding date range: ${startDate} ~ ${thisWeekEndDate} (current week only)`);

            // Extract holding data from Google Sheets students (no API call)
            const holdings = [];
            if (students && students.length > 0) {
                students.forEach(student => {
                    const holdingStatus = getStudentField(student, '홀딩 사용여부');
                    const holdingInfo = parseHoldingStatus(holdingStatus);
                    if (holdingInfo.isCurrentlyUsed) {
                        const startDateStr = getStudentField(student, '홀딩 시작일');
                        const endDateStr = getStudentField(student, '홀딩 종료일');

                        if (startDateStr && endDateStr) {
                            const holdingStartDate = parseSheetDate(startDateStr);
                            const holdingEndDate = parseSheetDate(endDateStr);

                            if (holdingStartDate && holdingEndDate) {
                                const holdingStartStr = formatDate(holdingStartDate);
                                const holdingEndStr = formatDate(holdingEndDate);

                                if (holdingEndStr >= startDate && holdingStartStr <= thisWeekEndDate) {
                                    holdings.push({
                                        studentName: student['이름'],
                                        startDate: holdingStartStr,
                                        endDate: holdingEndStr
                                    });
                                    console.log(`   📌 Holding from Google Sheets: ${student['이름']} (${holdingStartStr} ~ ${holdingEndStr})`);
                                }
                            }
                        }
                    }
                });
            }

            // Firebase 호출 병렬화 (makeup, absences, holidays 동시 호출)
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(formatDate(date));
            }

            const [makeups, absenceArrays, holidays, waitlist] = await Promise.all([
                getMakeupRequestsByWeek(startDate, endDate).catch(err => {
                    console.warn('Failed to load makeup requests:', err);
                    return [];
                }),
                Promise.all(dates.map(date =>
                    getAbsencesByDate(date).catch(err => {
                        console.warn(`Failed to load absences for ${date}:`, err);
                        return [];
                    })
                )),
                getHolidays().catch(err => {
                    console.warn('Failed to load holidays:', err);
                    return [];
                }),
                getAllActiveWaitlist().catch(err => {
                    console.warn('Failed to load waitlist:', err);
                    return [];
                })
            ]);

            const allAbsences = absenceArrays.flat();

            // 수업 시간이 지난 active 보강은 자동으로 completed 처리 (코치/수강생 모두)
            const passedActiveMakeups = (makeups || []).filter(m => m.status === 'active' && isMakeupClassPassed(m));
            for (const makeup of passedActiveMakeups) {
                try {
                    await completeMakeupRequest(makeup.id);
                    makeup.status = 'completed';
                    console.log('✅ 보강 자동 완료 처리:', makeup.id, makeup.studentName);
                } catch (err) {
                    console.error('❌ 보강 자동 완료 실패:', makeup.id, err);
                }
            }

            // active + completed 모두 시간표에 표시 (주간 내역 유지)
            setWeekMakeupRequests(makeups || []);
            setWeekHoldings(holdings || []);
            setWeekAbsences(allAbsences || []);
            setWeekHolidays(holidays || []);
            setWeekWaitlist(waitlist || []);

            console.log(`✅ Loaded ${makeups?.length || 0} makeup requests (${passedActiveMakeups.length}개 자동완료), ${holdings?.length || 0} holdings (from Google Sheets), ${allAbsences?.length || 0} absences, ${holidays?.length || 0} holidays, ${waitlist?.length || 0} waitlist`);
        } catch (error) {
            console.error('Failed to load weekly data:', error);
            setWeekMakeupRequests([]);
            setWeekHoldings([]);
            setWeekAbsences([]);
            setWeekWaitlist([]);
        }
    };

    // Load weekly Firebase data for coach mode and student mode
    useEffect(() => {
        loadWeeklyData();
    }, [mode, students]); // Depend on students to reload holdings when Google Sheets data changes

    // 코치 모드: 30분마다 자동 리프레시
    useEffect(() => {
        if (user?.role !== 'coach' || mode !== 'coach') return;

        const REFRESH_INTERVAL = 30 * 60 * 1000; // 30분
        const intervalId = setInterval(async () => {
            console.log('🔄 코치 시간표 자동 리프레시 (30분 주기)');
            try {
                await refresh();
                await loadWeeklyData();
            } catch (error) {
                console.error('자동 리프레시 실패:', error);
            }
        }, REFRESH_INTERVAL);

        return () => clearInterval(intervalId);
    }, [user, mode]);

    // 수동 새로고침 상태
    const [isRefreshing, setIsRefreshing] = useState(false);

    // 수동 새로고침 핸들러
    const handleManualRefresh = async () => {
        setIsRefreshing(true);
        try {
            console.log('🔄 Manual refresh triggered...');
            await refresh(); // Google Sheets 새로고침
            await loadWeeklyData(); // Firebase 데이터 새로고침
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    // Handle available seat click
    const handleAvailableSeatClick = (day, periodId, date) => {
        // Only allow makeup requests for actual students (not coaches viewing student mode)
        if (mode !== 'student' || user?.role === 'coach') return;

        // 잠긴 슬롯이면 보강 신청 불가
        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // 주횟수에 따른 보강 신청 제한 체크 (휴일 고려)
        // 이번 주 수강생의 정규 수업 중 휴일과 겹치는 수업 수를 빼서 실제 보강 가능 횟수 계산
        const effectiveMakeupLimit = (() => {
            let holidayClassCount = 0;
            if (studentSchedule.length > 0 && weekDates) {
                studentSchedule.forEach(schedule => {
                    const dateMMDD = weekDates[schedule.day];
                    if (!dateMMDD) return;
                    const [m, d] = dateMMDD.split('/');
                    const y = new Date().getFullYear();
                    const slotDateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                    // Firebase 휴일 또는 한국 공휴일 확인
                    const isFirebaseHoliday = weekHolidays.some(h => h.date === slotDateStr);
                    const isKoreanHoliday = !!KOREAN_HOLIDAYS[slotDateStr];
                    if (isFirebaseHoliday || isKoreanHoliday) {
                        holidayClassCount++;
                    }
                });
            }
            return Math.max(0, weeklyFrequency - holidayClassCount);
        })();

        if (activeMakeupRequests.filter(m => m.status === 'active').length >= effectiveMakeupLimit) {
            if (effectiveMakeupLimit < weeklyFrequency) {
                alert(`이번 주 휴일로 인해 보강 신청이 최대 ${effectiveMakeupLimit}개까지 가능합니다.\n(주 ${weeklyFrequency}회 중 ${weeklyFrequency - effectiveMakeupLimit}회 휴일)\n기존 보강을 취소 후 다시 신청해주세요.`);
            } else {
                alert(`주 ${weeklyFrequency}회 수업이므로 보강 신청은 최대 ${weeklyFrequency}개까지 가능합니다.\n기존 보강을 취소 후 다시 신청해주세요.`);
            }
            return;
        }

        // 과거 날짜 방지: 보강을 받을 날짜가 오늘 이전이면 신청 불가
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selectedDate = new Date(date + 'T00:00:00');
        if (selectedDate < today) {
            alert('과거 날짜로는 보강 신청을 할 수 없습니다.');
            return;
        }

        // 수업 시작 30분 전까지만 보강 신청 가능
        if (isClassStartingSoon(date, periodId)) {
            const period = PERIODS.find(p => p.id === periodId);
            alert(`${period?.name} 수업이 곧 시작됩니다.\n수업 시작 30분 전까지만 보강 신청이 가능합니다.`);
            return;
        }

        // 자기 정규 수업 슬롯에 보강 신청 방지
        // (예: 화5목5 수강생이 목5에 보강 신청하면 자기 수업에 보강하는 것)
        if (isMyClass(day, periodId)) {
            // 해당 날짜에 이미 보강으로 빠지는 수업인지 확인
            const isAlreadyMakeupAbsent = activeMakeupRequests.some(m =>
                m.originalClass.day === day &&
                m.originalClass.period === periodId &&
                m.originalClass.date === date
            );
            if (!isAlreadyMakeupAbsent) {
                alert('본인의 정규 수업 시간에는 보강 신청을 할 수 없습니다.\n다른 시간을 선택해주세요.');
                return;
            }
        }

        const period = PERIODS.find(p => p.id === periodId);
        // day는 이미 한글 요일 (월, 화, 수, 목, 금)
        const makeupSlot = { day, period: periodId, periodName: period.name, date };
        console.log('🎯 Selected makeup slot:', makeupSlot);
        console.log('   day:', day, 'periodName:', period.name, 'date:', date);
        setSelectedMakeupSlot(makeupSlot);
        setShowMakeupModal(true);
    };

    // 수강생 보강 목록 새로고침 헬퍼
    const reloadStudentMakeups = async () => {
        const makeups = await getActiveMakeupRequests(user.username);
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = makeups.filter(m => {
            if (m.status === 'active') return true;
            const makeupDate = m.makeupClass?.date;
            return makeupDate >= start && makeupDate <= end;
        });
        setActiveMakeupRequests(thisWeekMakeups);
    };

    // Handle makeup submission
    const handleMakeupSubmit = async () => {
        if (!selectedOriginalClass || !selectedMakeupSlot) return;

        // 보강 슬롯이 원본 슬롯과 동일한지 최종 체크
        if (selectedOriginalClass.day === selectedMakeupSlot.day &&
            selectedOriginalClass.period === selectedMakeupSlot.period &&
            selectedOriginalClass.date === selectedMakeupSlot.date) {
            alert('같은 수업으로 보강 신청할 수 없습니다.\n다른 시간을 선택해주세요.');
            return;
        }

        setIsSubmittingMakeup(true);
        try {
            await createMakeupRequest(user.username, selectedOriginalClass, selectedMakeupSlot);
            alert(`보강 신청 완료!\n${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} → ${selectedMakeupSlot.day}요일 ${selectedMakeupSlot.periodName}`);

            await reloadStudentMakeups();
            await loadWeeklyData();

            setShowMakeupModal(false);
            setSelectedMakeupSlot(null);
            setSelectedOriginalClass(null);
        } catch (error) {
            alert(`보강 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingMakeup(false);
        }
    };

    // Handle makeup cancellation (특정 보강 ID로 취소)
    const handleMakeupCancel = async (makeupId) => {
        if (!makeupId || !confirm('이 보강 신청을 취소하시겠습니까?')) return;

        try {
            await cancelMakeupRequest(makeupId);
            alert('보강 신청이 취소되었습니다.');

            await reloadStudentMakeups();
            await loadWeeklyData();
        } catch (error) {
            alert(`보강 신청 취소 실패: ${error.message}`);
        }
    };

    // 즉시 시간표 이동 핸들러 (코치가 신규 전용 모드에서 여석 있는 셀로 수강생 이동)
    const handleDirectTransfer = async (studentName, currentSlot) => {
        if (!waitlistDesiredSlot) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        if (!confirm(
            `시간표를 이동하시겠습니까?\n\n` +
            `${studentName}: ${currentSlot.day}요일 ${currentSlot.periodName} → ${waitlistDesiredSlot.day}요일 ${period?.name}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        try {
            // 1. 수강생의 Google Sheets 데이터 찾기
            const studentEntry = students.find(s => s['이름'] === studentName && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const sheetName = studentEntry._foundSheetName;
            const rowIndex = studentEntry._rowIndex;
            const actualRow = rowIndex + 3;
            const currentSchedule = studentEntry['요일 및 시간'];

            // 2. 스케줄 문자열 변환
            const parsed = parseScheduleString(currentSchedule);
            const updated = parsed.map(s => {
                if (s.day === currentSlot.day && s.period === currentSlot.period) {
                    return { day: waitlistDesiredSlot.day, period: waitlistDesiredSlot.period };
                }
                return s;
            });
            const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
            updated.sort((a, b) => (dayOrder[a.day] || 0) - (dayOrder[b.day] || 0) || a.period - b.period);
            const newSchedule = updated.map(s => `${s.day}${s.period}`).join('');

            // 3. Google Sheets D열 업데이트
            const range = `${sheetName}!D${actualRow}`;
            await writeSheetData(range, [[newSchedule]]);

            alert(`시간표 이동 완료!\n${studentName}: ${currentSchedule} → ${newSchedule}`);
            setShowWaitlistModal(false);
            setWaitlistDesiredSlot(null);
            setWaitlistStudentName('');
            setWaitlistStudentSearch('');
            setIsDirectTransfer(false);

            await refresh();
            await loadWeeklyData();
        } catch (error) {
            alert(`시간표 이동 실패: ${error.message}`);
            console.error('시간표 이동 실패:', error);
        }
    };

    // 대기 등록 핸들러 (코치가 신규 전용 모드에서 만석 셀 대기 등록)
    const handleWaitlistSubmit = async (studentName, currentSlot) => {
        if (!waitlistDesiredSlot) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        try {
            await createWaitlistRequest(studentName, currentSlot, {
                day: waitlistDesiredSlot.day,
                period: waitlistDesiredSlot.period,
                periodName: period?.name || ''
            });
            alert(`대기 등록 완료!\n${studentName}: ${currentSlot.day} ${currentSlot.periodName} → ${waitlistDesiredSlot.day} ${period?.name}\n자리가 나면 수강생에게 알림이 갑니다.`);
            setShowWaitlistModal(false);
            setWaitlistDesiredSlot(null);
            setWaitlistStudentName('');
            setWaitlistStudentSearch('');
            setIsDirectTransfer(false);
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 등록 실패: ${error.message}`);
        }
    };

    // 대기 취소 핸들러 (수강생/코치 공용)
    const handleWaitlistCancel = async (waitlistId) => {
        if (!confirm('대기 신청을 취소하시겠습니까?')) return;
        try {
            await cancelWaitlistRequest(waitlistId);
            alert('대기 신청이 취소되었습니다.');
            if (user?.role !== 'coach') {
                const waitlist = await getActiveWaitlistRequests(user.username);
                setStudentWaitlist(waitlist);
            }
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 취소 실패: ${error.message}`);
        }
    };

    // 대기 수락 핸들러 - 자리가 나서 수강생이 수락 → Google Sheets D열 영구 변경
    const handleWaitlistAccept = async (waitlistItem) => {
        const { currentSlot, desiredSlot } = waitlistItem;
        if (!confirm(
            `${desiredSlot.day}요일 ${desiredSlot.periodName}에 자리가 났습니다!\n\n` +
            `시간표를 변경하시겠습니까?\n` +
            `${currentSlot.day}요일 ${currentSlot.periodName} → ${desiredSlot.day}요일 ${desiredSlot.periodName}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        try {
            // 1. 수강생의 최신 Google Sheets 데이터 찾기
            const studentEntry = students.find(s => s['이름'] === user.username && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const sheetName = studentEntry._foundSheetName;
            const rowIndex = studentEntry._rowIndex;
            const actualRow = rowIndex + 3; // 행번호 변환
            const currentSchedule = studentEntry['요일 및 시간'];

            // 2. 스케줄 문자열 변환 (예: "화5목5" → "화5금5")
            const parsed = parseScheduleString(currentSchedule);
            const updated = parsed.map(s => {
                if (s.day === currentSlot.day && s.period === currentSlot.period) {
                    return { day: desiredSlot.day, period: desiredSlot.period };
                }
                return s;
            });
            // 요일 순서로 정렬
            const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
            updated.sort((a, b) => (dayOrder[a.day] || 0) - (dayOrder[b.day] || 0) || a.period - b.period);
            const newSchedule = updated.map(s => `${s.day}${s.period}`).join('');

            // 3. Google Sheets D열 업데이트
            const range = `${sheetName}!D${actualRow}`;
            await writeSheetData(range, [[newSchedule]]);

            // 4. Firebase 대기 수락 처리
            await acceptWaitlistRequest(waitlistItem.id);

            alert(`시간표 변경 완료!\n${currentSchedule} → ${newSchedule}`);

            // 5. 전체 데이터 새로고침
            await refresh();
            await loadWeeklyData();
            const waitlist = await getActiveWaitlistRequests(user.username);
            setStudentWaitlist(waitlist);
        } catch (error) {
            alert(`시간표 변경 실패: ${error.message}`);
            console.error('시간표 변경 실패:', error);
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

        // 2. Holds are now handled by holdingStudents based on actual slot date
        // The old scheduleData.holds used "today's date" which was incorrect
        // holdingStudents (from weekHoldings) correctly checks each slot's specific date
        const holdNames = []; // Deprecated, kept for compatibility but always empty

        // 3. Identify Substitutes (People filling in)
        const subs = scheduleData.substitutes.filter(
            s => s.day === day && s.period === periodObj.id
        );

        // 4. Firebase data processing (Both student and coach modes)
        let makeupStudents = [];
        let makeupAbsentStudents = []; // 보강으로 인해 결석 (다른 시간에 수업)
        let absenceStudents = []; // 일반 결석 신청
        let agreedAbsenceStudents = []; // 합의결석 (코치가 설정한 결석)
        let holdingStudents = [];
        let delayedStartStudents = [];
        let newStudents = []; // 신규이면서 시작일 전인 학생

        // Get date for this slot
        const dateStr = weekDates[day];
        if (dateStr) {
            const [month, dayNum] = dateStr.split('/');
            const year = new Date().getFullYear();
            const slotDate = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

            // Debug log for both modes to troubleshoot seat calculation
            console.log(`🔍 [${mode}] Checking ${day} ${periodObj.name} (${slotDate})`);
            console.log(`   Makeup requests:`, weekMakeupRequests.length);
            console.log(`   Holdings:`, weekHoldings.length);

            // Find makeup students coming TO this slot
            makeupStudents = weekMakeupRequests
                .filter(m => {
                    const match = m.makeupClass.day === day &&
                        m.makeupClass.period === periodObj.id &&
                        m.makeupClass.date === slotDate;
                    if (match) {
                        console.log(`   ✓ Makeup TO found: ${m.studentName} (${m.originalClass.day} ${m.originalClass.periodName} → ${m.makeupClass.day} ${m.makeupClass.periodName})`);
                    }
                    return match;
                })
                .map(m => m.studentName);

            // Find students absent FROM this slot due to makeup (보강결석)
            makeupAbsentStudents = weekMakeupRequests
                .filter(m => {
                    const match = m.originalClass.day === day &&
                        m.originalClass.period === periodObj.id &&
                        m.originalClass.date === slotDate;
                    if (match) {
                        console.log(`   ✓ Makeup FROM found: ${m.studentName} (${m.originalClass.day} ${m.originalClass.periodName} → ${m.makeupClass.day} ${m.makeupClass.periodName})`);
                    }
                    return match;
                })
                .map(m => m.studentName);

            // Find students on holding during this date
            holdingStudents = weekHoldings
                .filter(h => {
                    const isInRange = h.startDate <= slotDate && h.endDate >= slotDate;
                    if (isInRange) {
                        console.log(`   ✓ Holding found: ${h.studentName} (${h.startDate} ~ ${h.endDate})`);
                    }
                    return isInRange;
                })
                .map(h => h.studentName)
                .filter(name => studentNames.includes(name));

            // Find students whose start date is after this slot date (시작지연/신규)
            // 단, 같은 이름으로 해당 슬롯 날짜에 유효한 수강(종료날짜 >= 슬롯날짜)이 있으면 미리 등록한 것이므로 제외
            const slotDateObj = new Date(slotDate + 'T00:00:00');
            const delayedStudentsRaw = students
                .filter(s => {
                    const name = s['이름'];
                    if (!name || !studentNames.includes(name)) return false;
                    if (holdingStudents.includes(name)) return false;
                    const startDateStr = s['시작날짜'];
                    if (!startDateStr) return false;
                    const startDate = parseSheetDate(startDateStr);
                    if (!startDate) return false;
                    if (startDate <= slotDateObj) return false;
                    // 같은 이름의 다른 행에서 종료날짜가 슬롯 날짜 이후인 게 있으면 미리 등록 → 제외
                    const hasActiveEnrollment = students.some(other => {
                        if (other === s) return false;
                        if (other['이름'] !== name) return false;
                        const endDateStr = other['종료날짜'];
                        if (!endDateStr) return false;
                        const endDate = parseSheetDate(endDateStr);
                        return endDate && endDate >= slotDateObj;
                    });
                    return !hasActiveEnrollment;
                });

            // 신규이면서 시작일 전 → newStudents, 나머지 → delayedStartStudents
            newStudents = delayedStudentsRaw
                .filter(s => getStudentField(s, '신규/재등록') === '신규')
                .map(s => s['이름']);
            delayedStartStudents = delayedStudentsRaw
                .filter(s => getStudentField(s, '신규/재등록') !== '신규')
                .map(s => s['이름']);

            // Find students with absence requests for this date (일반 결석)
            // 해당 슬롯에 등록된 학생만 결석으로 표시
            absenceStudents = weekAbsences
                .filter(a => a.date === slotDate && studentNames.includes(a.studentName))
                .map(a => a.studentName)
                // 보강결석이 아닌 학생만 일반 결석으로 표시
                .filter(name => !makeupAbsentStudents.includes(name));

            // Find students with agreed absence (합의결석) from 특이사항 field
            agreedAbsenceStudents = students
                .filter(s => {
                    const name = s['이름'];
                    if (!name || !studentNames.includes(name)) return false;
                    // 이미 다른 결석 유형으로 표시된 학생은 제외
                    if (makeupAbsentStudents.includes(name) || absenceStudents.includes(name)) return false;
                    const notes = s['특이사항'] || getStudentField(s, '특이사항') || '';
                    const absenceDates = parseAgreedAbsenceDates(notes);
                    return absenceDates.includes(slotDate);
                })
                .map(s => s['이름']);

            if (makeupStudents.length > 0) {
                console.log(`   → Makeup students: ${makeupStudents.join(', ')}`);
            }
            if (makeupAbsentStudents.length > 0) {
                console.log(`   → Makeup absent (보강결석): ${makeupAbsentStudents.join(', ')}`);
            }
            if (absenceStudents.length > 0) {
                console.log(`   → Absence (결석): ${absenceStudents.join(', ')}`);
            }
            if (holdingStudents.length > 0) {
                console.log(`   → Holding students: ${holdingStudents.join(', ')}`);
            }
            if (newStudents.length > 0) {
                console.log(`   → New students (신규): ${newStudents.join(', ')}`);
            }
            if (delayedStartStudents.length > 0) {
                console.log(`   → Delayed start students: ${delayedStartStudents.join(', ')}`);
            }
            if (agreedAbsenceStudents.length > 0) {
                console.log(`   → Agreed absence (합의결석): ${agreedAbsenceStudents.join(', ')}`);
            }
        }

        // 5. Calculate counts
        // Active Students = (Regular - MakeupAbsent - Absence - AgreedAbsence - Holding) + Substitutes + MakeupStudents
        const allAbsentStudents = [...new Set([...makeupAbsentStudents, ...absenceStudents, ...agreedAbsenceStudents])];
        const activeStudents = studentNames.filter(name =>
            !allAbsentStudents.includes(name) &&
            !holdingStudents.includes(name) &&
            !delayedStartStudents.includes(name) &&
            !newStudents.includes(name)
        );

        // Regular students who are on the roster (not holding, not delayed start, not new, but may be absent)
        const regularStudentsPresent = studentNames.filter(name =>
            !holdingStudents.includes(name) &&
            !delayedStartStudents.includes(name) &&
            !newStudents.includes(name)
        );

        let currentCount, availableSeats, isFull;

        // pending 등록자 이름 (신규 전용 모드에서 사용)
        let pendingNames = [];

        if (mode === 'student' && user?.role === 'coach') {
            // 코치가 보는 수강생 모드: 순수 등록 인원 + pending 등록 인원 기준
            // 신규 수강생 상담 시 정확한 정원 파악용
            const pendingForSlot = pendingRegistrations.filter(reg =>
                reg.requestedSlots?.some(s => s.day === day && s.period === periodObj.id)
            );
            pendingNames = pendingForSlot.map(reg => reg.name);
            currentCount = studentNames.length + pendingForSlot.length;
            availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
            isFull = availableSeats === 0;
        } else {
            // 코치 모드 & 수강생 대시보드: 실시간 반영 (보강/홀딩/결석 반영된 실제 출석 인원)
            currentCount = activeStudents.length + subs.length + makeupStudents.length;
            availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
            isFull = availableSeats === 0;
        }

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
            absenceStudents,
            agreedAbsenceStudents, // 합의결석 학생
            holdingStudents,
            delayedStartStudents,
            newStudents,
            pendingNames,
            regularStudentsPresent
        };
    };

    const handleCellClick = (day, periodObj, cellData) => {
        if (periodObj.type === 'free') return;

        if (mode === 'student') {
            if (user?.role === 'coach') {
                // 코치 신규 전용 모드: 시간표 이동/대기 모달
                setWaitlistDesiredSlot({ day, period: periodObj.id });
                setIsDirectTransfer(!cellData.isFull); // 여석 있으면 즉시 이동, 만석이면 대기
                setShowWaitlistModal(true);
                return;
            }

            if (cellData.isFull) {
                alert('만석입니다.\n자리가 나면 코치에게 문의해주세요.');
                return;
            } else {
                // Calculate date for this slot
                const dateStr = weekDates[day];
                if (dateStr) {
                    const [month, dayNum] = dateStr.split('/');
                    const year = new Date().getFullYear();
                    const dateFormatted = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

                    handleAvailableSeatClick(day, periodObj.id, dateFormatted);
                }
            }
        } else {
            // Coach Mode: 출석 학생을 선택하여 훈련일지로 이동
            const attendingStudents = [
                ...cellData.activeStudents,
                ...cellData.makeupStudents,
                ...cellData.subs.map(s => s.name)
            ];

            // 훈련일지에서 읽을 수 있도록 localStorage에 선택된 학생 저장
            localStorage.setItem('coachSelectedStudents', JSON.stringify(attendingStudents));

            // 훈련일지로 이동
            window.location.href = './training-log/index.html';
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

        // --- Check if this date is a holiday (Firebase + Korean public holidays) ---
        let isHoliday = false;
        let holidayReason = '';
        if (weekDates[day]) {
            const [hMonth, hDay] = weekDates[day].split('/');
            const hYear = new Date().getFullYear();
            const slotDateStr = `${hYear}-${hMonth.padStart(2, '0')}-${hDay.padStart(2, '0')}`;
            // 1) Firebase에 등록된 휴일 확인
            const holidayMatch = weekHolidays.find(h => h.date === slotDateStr);
            if (holidayMatch) {
                isHoliday = true;
                holidayReason = holidayMatch.reason || '';
            }
            // 2) 한국 공휴일 확인
            if (!isHoliday && KOREAN_HOLIDAYS[slotDateStr]) {
                isHoliday = true;
                holidayReason = KOREAN_HOLIDAYS[slotDateStr];
            }
        }

        // --- STUDENT MODE RENDER ---
        if (mode === 'student') {
            // If holiday, show "휴일" regardless of other data (단, 코치의 신규 전용 모드에서는 여석 확인이 목적이므로 휴일 표시 안 함)
            if (isHoliday && user?.role !== 'coach') {
                return (
                    <div className="schedule-cell" style={{ backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.9rem' }}>휴일</span>
                        {holidayReason && <span style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '2px' }}>{holidayReason}</span>}
                    </div>
                );
            }

            // Check if this is my class
            const myClass = isMyClass(day, periodObj.id);

            // Check if there are registered students (even if on hold)
            const hasRegisteredStudents = data.studentNames.length > 0;

            // Check if this cell is part of any makeup request (복수 보강 지원)
            let isMakeupFrom = false; // 보강으로 결석하는 수업
            let isMakeupTo = false; // 보강으로 출석하는 수업

            if (activeMakeupRequests.length > 0 && weekDates) {
                // weekDates[day]는 "M/D" 형식 (예: "2/4")
                // makeup의 date는 "YYYY-MM-DD" 형식 (예: "2026-02-04")
                // 비교를 위해 weekDates를 YYYY-MM-DD 형식으로 변환
                const cellDateMMDD = weekDates[day]; // "2/4"
                let cellDateFormatted = '';
                if (cellDateMMDD) {
                    const [month, dayNum] = cellDateMMDD.split('/');
                    const year = new Date().getFullYear();
                    cellDateFormatted = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;
                }

                // Check if any makeup request has this as the original class (makeup FROM)
                isMakeupFrom = activeMakeupRequests.some(makeup =>
                    makeup.originalClass.date === cellDateFormatted &&
                    makeup.originalClass.day === day &&
                    makeup.originalClass.period === periodObj.id
                );

                // Check if any makeup request has this as the makeup class (makeup TO)
                isMakeupTo = activeMakeupRequests.some(makeup =>
                    makeup.makeupClass.date === cellDateFormatted &&
                    makeup.makeupClass.day === day &&
                    makeup.makeupClass.period === periodObj.id
                );
            }

            // If it is my class, highlight it! (check first, even if disabled)
            if (myClass) {
                return (
                    <div
                        className={`schedule-cell cell-available my-class ${isMakeupFrom ? 'makeup-absent' : ''}`}
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            {isMakeupFrom ? (
                                <span className="my-class-badge" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>보강결석</span>
                            ) : (
                                <span className="my-class-badge">MY</span>
                            )}
                        </div>
                    </div>
                );
            }

            // If this is makeup TO class, show with special badge
            if (isMakeupTo) {
                return (
                    <div
                        className="schedule-cell cell-available makeup-class"
                        onClick={() => handleCellClick(day, periodObj, data)}
                        style={{ borderColor: '#3b82f6', borderWidth: '2px' }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: '#3b82f6', color: '#fff' }}>보강</span>
                        </div>
                    </div>
                );
            }

            // If class is disabled by coach, show "수업 없음" (for non-enrolled students)
            if (classDisabled) {
                return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
            }

            // If slot is locked by coach, show "보강 불가" (보강 차단)
            const slotLocked = isSlotLocked(day, periodObj.id);
            if (slotLocked) {
                return (
                    <div className="schedule-cell" style={{ backgroundColor: '#fef2f2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '1.2rem' }}>🔒</span>
                        <span style={{ color: '#991b1b', fontSize: '0.8rem', fontWeight: 'bold', marginTop: '2px' }}>보강 불가</span>
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
                        <span className="seat-count">{data.availableSeats}</span>
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
                // 대기 인원 수 (기존 수강생 + 신규 대기 합산)
                const existingWaitCount = weekWaitlist.filter(w =>
                    w.desiredSlot.day === day &&
                    w.desiredSlot.period === periodObj.id
                ).length;
                const newWaitCount = newStudentWaitlist.filter(r => {
                    const slots = r.requestedSlots || [];
                    if (slots.length > 0) return slots.some(s => s.day === day && s.period === periodObj.id);
                    const parsed = (r.scheduleString || '').match(/([월화수목금])(\d)/g);
                    return parsed ? parsed.some(m => m[0] === day && parseInt(m[1]) === periodObj.id) : false;
                }).length;
                const waitCount = existingWaitCount + newWaitCount;

                return (
                    <div
                        className="schedule-cell cell-full"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <span className="cell-full-text">Full</span>
                        <span style={{ fontSize: '0.8em' }}>(만석)</span>
                        {waitCount > 0 && user?.role === 'coach' && (
                            <span style={{ fontSize: '0.7em', color: '#d97706' }}>대기 {waitCount}명</span>
                        )}
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
            // If holiday, show "휴일" for coach too
            if (isHoliday) {
                return (
                    <div className="schedule-cell" style={{ backgroundColor: '#fef2f2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.9rem' }}>휴일</span>
                        {holidayReason && <span style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '2px' }}>{holidayReason}</span>}
                    </div>
                );
            }

            // If class is disabled, show disabled state with toggle
            if (classDisabled) {
                return (
                    <div
                        className="schedule-cell cell-disabled"
                        style={{ backgroundColor: '#f3f4f6', cursor: 'pointer' }}
                        onClick={() => {
                            if (confirm(`${day}요일 ${periodObj.name} 수업을 활성화하시겠습니까?`)) {
                                toggleClassDisabledHandler(day, periodObj.id);
                            }
                        }}
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
                data.makeupAbsentStudents.length === 0 &&
                data.agreedAbsenceStudents.length === 0 &&
                data.delayedStartStudents.length === 0 &&
                data.newStudents.length === 0) {
                return (
                    <div
                        className="schedule-cell"
                        onClick={() => toggleClassDisabledHandler(day, periodObj.id)}
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
                    {/* Header with count and available seats for Coach */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 'bold', borderBottom: '1px solid #eee' }}>
                        <span>
                            {data.isFull
                                ? <span style={{ color: 'red' }}>Full</span>
                                : <>{data.currentCount}명<span style={{ color: '#666', fontWeight: 'normal', marginLeft: '4px' }}>(여석: {data.availableSeats}자리)</span></>
                            }
                            {(() => {
                                const existingWaiters = weekWaitlist.filter(w =>
                                    w.desiredSlot.day === day &&
                                    w.desiredSlot.period === periodObj.id
                                );
                                const newWaiters = newStudentWaitlist.filter(r => {
                                    const slots = r.requestedSlots || [];
                                    if (slots.length > 0) return slots.some(s => s.day === day && s.period === periodObj.id);
                                    const parsed = (r.scheduleString || '').match(/([월화수목금])(\d)/g);
                                    return parsed ? parsed.some(m => m[0] === day && parseInt(m[1]) === periodObj.id) : false;
                                });
                                const totalWait = existingWaiters.length + newWaiters.length;
                                if (totalWait === 0) return null;
                                const tooltipParts = [
                                    ...existingWaiters.map(w => `${w.studentName}(${w.currentSlot.day}${w.currentSlot.period}→)`),
                                    ...newWaiters.map(r => `${r.name}(신규)`)
                                ];
                                return (
                                    <span style={{ color: '#d97706', fontWeight: 'bold', marginLeft: '4px', fontSize: '0.75rem' }}
                                        title={`대기: ${tooltipParts.join(', ')}`}>
                                        대기 {totalWait}명
                                    </span>
                                );
                            })()}
                        </span>
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleLockedSlotHandler(day, periodObj.id);
                            }}
                            style={{
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                padding: '0 2px',
                                borderRadius: '4px',
                                ...(isSlotLocked(day, periodObj.id)
                                    ? { border: '1px solid #ef4444', backgroundColor: '#fef2f2' }
                                    : { color: '#d1d5db' })
                            }}
                            title={isSlotLocked(day, periodObj.id) ? '보강 잠금 해제' : '보강 잠금'}
                        >
                            {isSlotLocked(day, periodObj.id) ? '🔒' : '🔓'}
                        </span>
                    </div>

                    <div className="student-list">
                        {/* 1. Regular Students Present (not on hold, not holding) - show with makeup-absent, absence, or agreed-absence styling if applicable */}
                        {data.regularStudentsPresent.map(name => {
                            const isMakeupAbsent = data.makeupAbsentStudents.includes(name);
                            const isAbsent = data.absenceStudents && data.absenceStudents.includes(name);
                            const isAgreedAbsent = data.agreedAbsenceStudents && data.agreedAbsenceStudents.includes(name);
                            if (isMakeupAbsent) {
                                return (
                                    <span key={name} className="student-tag" style={{ backgroundColor: '#fef3c7', color: '#92400e', textDecoration: 'line-through' }}>
                                        {name}(보강결석)
                                    </span>
                                );
                            }
                            if (isAgreedAbsent) {
                                return (
                                    <span key={name} className="student-tag" style={{ backgroundColor: '#fce7f3', color: '#be185d', textDecoration: 'line-through' }}>
                                        {name}(합의결석)
                                    </span>
                                );
                            }
                            if (isAbsent) {
                                return (
                                    <span key={name} className="student-tag" style={{ backgroundColor: '#fecaca', color: '#991b1b', textDecoration: 'line-through' }}>
                                        {name}(결석)
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

                        {/* 3.5. New Students before start date (신규) */}
                        {data.newStudents.map(name => (
                            <span key={`new-${name}`} className="student-tag" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>{name}(신규)</span>
                        ))}

                        {/* 3.6. Delayed Start Students (시작지연) - 재등록 등 */}
                        {data.delayedStartStudents.map(name => (
                            <span key={`delayed-${name}`} className="student-tag" style={{ backgroundColor: '#dcfce7', color: '#166534', textDecoration: 'line-through' }}>{name}(시작지연)</span>
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
        <div className={`schedule-container mode-${mode}`}>
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
                {user?.role === 'coach' && (
                    <button
                        onClick={handleManualRefresh}
                        disabled={isRefreshing}
                        style={{
                            marginLeft: '12px',
                            padding: '4px 12px',
                            fontSize: '0.9rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            backgroundColor: isRefreshing ? '#f3f4f6' : '#fff',
                            cursor: isRefreshing ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isRefreshing ? '새로고침 중...' : '🔄 새로고침'}
                    </button>
                )}
            </div>

            {user?.role === 'coach' && (
                <div className="controls">
                    <button
                        className={`mode-toggle ${mode === 'student' ? 'active' : ''}`}
                        onClick={() => setMode('student')}
                    >
                        신규 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                        onClick={() => setMode('coach')}
                    >
                        코치 전용
                    </button>
                </div>
            )}

            {mode === 'coach' && lastDayStudents.length > 0 && (
                <section style={{
                    background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
                    border: '1px solid #4ade80',
                    borderRadius: '12px',
                    padding: '1rem 1.25rem',
                    marginBottom: '1rem'
                }}>
                    <div style={{ fontWeight: '700', fontSize: '1rem', color: '#166534', marginBottom: '0.5rem' }}>
                        오늘 마지막 수업
                    </div>
                    <div style={{ color: '#14532d', fontSize: '0.95rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {lastDayStudents.map((s) => {
                            // 수업 시간 ±30분이면 볼드 표시
                            const now = new Date();
                            const period = PERIODS.find(p => p.id === s.todayPeriod);
                            let isBold = false;
                            if (period) {
                                const classStartMin = period.startHour * 60 + period.startMinute;
                                const classEndMin = classStartMin + 90; // 수업 90분
                                const nowMin = now.getHours() * 60 + now.getMinutes();
                                isBold = nowMin >= (classStartMin - 30) && nowMin <= (classEndMin + 30);
                            }
                            return (
                                <div key={s.name} style={{ fontWeight: isBold ? '800' : '400' }}>
                                    {s.name}({s.schedule}{s.payment ? `,${s.payment}` : ''}) {period ? <span style={{ fontSize: '0.8rem', color: '#15803d' }}>{period.id}교시</span> : ''}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {mode === 'coach' && delayedReregistrationStudents.length > 0 && (
                <section style={{
                    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                    border: '1px solid #f59e0b',
                    borderRadius: '12px',
                    padding: '1rem 1.25rem',
                    marginBottom: '1rem'
                }}>
                    <div style={{ fontWeight: '700', fontSize: '1rem', color: '#92400e', marginBottom: '0.5rem' }}>
                        재등록 지연
                    </div>
                    <div style={{ color: '#78350f', fontSize: '0.95rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {delayedReregistrationStudents.map((s) => (
                            <div key={s.name}>
                                {s.name}({s.schedule}{s.payment ? `,${s.payment}` : ''}) <span style={{ fontSize: '0.8rem', color: '#b45309' }}>종료: {s.endDate}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {mode === 'coach' && (weekWaitlist.length > 0 || newStudentWaitlist.length > 0) && (
                <section style={{
                    background: 'linear-gradient(135deg, #fef9c3, #fde047)',
                    border: '1px solid #eab308',
                    borderRadius: '12px',
                    padding: '1rem 1.25rem',
                    marginBottom: '1rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <div style={{ fontWeight: '700', fontSize: '1rem', color: '#713f12' }}>
                            시간표 대기 현황 <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>({weekWaitlist.length + newStudentWaitlist.length}명)</span>
                        </div>
                        <button
                            onClick={() => setShowWaitlistDeleteMode(prev => !prev)}
                            style={{
                                fontSize: '0.75rem',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                border: showWaitlistDeleteMode ? '1px solid #dc2626' : '1px solid #a16207',
                                background: showWaitlistDeleteMode ? '#fee2e2' : 'transparent',
                                color: showWaitlistDeleteMode ? '#dc2626' : '#a16207',
                                cursor: 'pointer',
                                fontWeight: '600'
                            }}
                        >
                            {showWaitlistDeleteMode ? '완료' : '삭제'}
                        </button>
                    </div>
                    <div style={{ color: '#78350f', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {weekWaitlist.map(w => {
                            const desiredP = PERIODS.find(p => p.id === w.desiredSlot.period);
                            const currentP = PERIODS.find(p => p.id === w.currentSlot.period);
                            const slot = scheduleData.regularEnrollments.find(
                                e => e.day === w.desiredSlot.day && e.period === w.desiredSlot.period
                            );
                            const registeredCount = slot ? slot.names.length : 0;
                            const hasSpace = registeredCount < MAX_CAPACITY;
                            return (
                                <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>
                                        {w.studentName}
                                        <span style={{ fontSize: '0.8rem', color: '#92400e', marginLeft: '4px' }}>
                                            {w.currentSlot.day}{currentP ? currentP.id : w.currentSlot.period}교시 → {w.desiredSlot.day}{desiredP ? desiredP.id : w.desiredSlot.period}교시
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: '#a16207', marginLeft: '4px' }}>
                                            ({w.status === 'waiting' ? '대기중' : w.status === 'notified' ? '승인완료' : w.status})
                                        </span>
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                        {w.status === 'waiting' && (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await notifyWaitlistRequest(w.id);
                                                        setWeekWaitlist(prev => prev.map(item =>
                                                            item.id === w.id ? { ...item, status: 'notified' } : item
                                                        ));
                                                    } catch (err) {
                                                        alert('승인 실패: ' + err.message);
                                                    }
                                                }}
                                                disabled={!hasSpace}
                                                style={{
                                                    fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                                    border: hasSpace ? '1px solid #16a34a' : '1px solid #9ca3af',
                                                    background: hasSpace ? '#dcfce7' : '#f3f4f6',
                                                    color: hasSpace ? '#16a34a' : '#9ca3af',
                                                    cursor: hasSpace ? 'pointer' : 'not-allowed',
                                                    fontWeight: '600'
                                                }}
                                            >
                                                {hasSpace ? '승인' : '승인(만석)'}
                                            </button>
                                        )}
                                        {w.status === 'notified' && (
                                            <>
                                                <span style={{
                                                    fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                                    background: '#dbeafe', color: '#2563eb', fontWeight: '600'
                                                }}>
                                                    수락중...
                                                </span>
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            await revertWaitlistNotification(w.id);
                                                            setWeekWaitlist(prev => prev.map(item =>
                                                                item.id === w.id ? { ...item, status: 'waiting' } : item
                                                            ));
                                                        } catch (err) {
                                                            alert('승인 취소 실패: ' + err.message);
                                                        }
                                                    }}
                                                    style={{
                                                        fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                                        border: '1px solid #dc2626', background: '#fee2e2', color: '#dc2626',
                                                        cursor: 'pointer', fontWeight: '600'
                                                    }}
                                                >
                                                    취소
                                                </button>
                                            </>
                                        )}
                                        {showWaitlistDeleteMode && (
                                            <button
                                                onClick={async () => {
                                                    if (!confirm(`"${w.studentName}"의 대기 신청을 삭제하시겠습니까?`)) return;
                                                    try {
                                                        await cancelWaitlistRequest(w.id);
                                                        setWeekWaitlist(prev => prev.filter(item => item.id !== w.id));
                                                    } catch (err) {
                                                        alert('삭제 실패: ' + err.message);
                                                    }
                                                }}
                                                style={{
                                                    fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                                    border: '1px solid #dc2626', background: '#fee2e2', color: '#dc2626',
                                                    cursor: 'pointer', fontWeight: '600'
                                                }}
                                            >
                                                삭제
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {newStudentWaitlist.map(r => {
                            const slots = r.requestedSlots || [];
                            const slotStr = slots.length > 0
                                ? slots.map(s => `${s.day}${s.period}`).join('')
                                : (r.scheduleString || '');
                            return (
                                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>
                                        {r.name}
                                        <span style={{ fontSize: '0.8rem', color: '#92400e', marginLeft: '4px' }}>
                                            {slotStr}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: '#d97706', marginLeft: '4px', fontWeight: '600' }}>
                                            (신규대기)
                                        </span>
                                    </span>
                                    {showWaitlistDeleteMode && (
                                        <button
                                            onClick={async () => {
                                                if (!confirm(`"${r.name}"의 신규 대기 신청을 삭제하시겠습니까?`)) return;
                                                try {
                                                    await deleteNewStudentRegistration(r.id);
                                                    setNewStudentWaitlist(prev => prev.filter(item => item.id !== r.id));
                                                } catch (err) {
                                                    alert('삭제 실패: ' + err.message);
                                                }
                                            }}
                                            style={{
                                                fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                                border: '1px solid #dc2626', background: '#fee2e2', color: '#dc2626',
                                                cursor: 'pointer', fontWeight: '600', flexShrink: 0
                                            }}
                                        >
                                            삭제
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {mode === 'student' && user?.role !== 'coach' && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    fontSize: '0.82rem',
                    color: '#0c4a6e',
                    lineHeight: '1.6'
                }}>
                    <strong>이용 안내</strong>
                    <div style={{ marginTop: '4px' }}>
                        · 여석이 있는 칸을 눌러 <strong>보강 신청</strong>할 수 있습니다 (1회성 수업 이동)<br/>
                        · 시간표 변경은 코치에게 문의해주세요
                    </div>
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
                    user?.role === 'coach' ? (
                        <>
                            <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 여석 있음 (클릭: 시간표 이동)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (클릭: 대기 등록)</div>
                        </>
                    ) : (
                        <>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (대기 가능)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#f59e0b' }}></span> 자율 운동</div>
                        </>
                    )
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

                                    // 해당 요일의 날짜 계산
                                    const dateStr = weekDates[schedule.day];
                                    let originalDateStr = '';
                                    let isAlreadyRequested = false;
                                    if (dateStr) {
                                        const [month, dayNum] = dateStr.split('/');
                                        const year = new Date().getFullYear();
                                        originalDateStr = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

                                        // 이미 보강 신청한 수업인지 확인
                                        isAlreadyRequested = activeMakeupRequests.some(m =>
                                            m.originalClass.date === originalDateStr &&
                                            m.originalClass.day === schedule.day &&
                                            m.originalClass.period === schedule.period
                                        );
                                    }

                                    const isDisabled = isAlreadyRequested;

                                    return (
                                        <div
                                            key={index}
                                            className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#e0f2fe' } : {}}
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
                                            <span style={{ fontSize: '0.8em', color: isDisabled ? '#999' : '#666', marginLeft: '8px' }}>
                                                ({dateStr}){isAlreadyRequested && ' - 신청됨'}
                                            </span>
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

            {/* 시간표 이동/대기 모달 - 코치 신규 전용 모드 */}
            {showWaitlistModal && user?.role === 'coach' && waitlistDesiredSlot && (
                <div className="makeup-modal-overlay" onClick={() => { setShowWaitlistModal(false); setWaitlistDesiredSlot(null); setWaitlistStudentName(''); setWaitlistStudentSearch(''); setIsDirectTransfer(false); }}>
                    <div className="makeup-modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        <h2>{isDirectTransfer ? '시간표 이동' : '대기 등록'}</h2>
                        <p className="makeup-modal-subtitle">
                            목표: <strong>{waitlistDesiredSlot.day}요일 {PERIODS.find(p => p.id === waitlistDesiredSlot.period)?.name}</strong>
                            {isDirectTransfer ? ' (여석 있음)' : ' (만석)'}
                        </p>
                        <p style={{ fontSize: '0.85rem', color: '#666', margin: '4px 0 12px' }}>
                            {isDirectTransfer
                                ? '수강생을 선택하면 시간표가 즉시 변경됩니다'
                                : '자리가 나면 수강생에게 알림 → 수락 시 시간표 영구 변경'}
                        </p>

                        {/* 기존 대기자 목록 (대기 모드에서만) */}
                        {!isDirectTransfer && (() => {
                            const existingWaiters = weekWaitlist.filter(w =>
                                w.desiredSlot.day === waitlistDesiredSlot.day &&
                                w.desiredSlot.period === waitlistDesiredSlot.period
                            );
                            if (existingWaiters.length === 0) return null;
                            return (
                                <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#92400e', marginBottom: '4px' }}>현재 대기 ({existingWaiters.length}명)</div>
                                    {existingWaiters.map(w => (
                                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '2px 0' }}>
                                            <span>{w.studentName} ({w.currentSlot.day}{w.currentSlot.period} → {w.desiredSlot.day}{w.desiredSlot.period})</span>
                                            <button onClick={() => handleWaitlistCancel(w.id)} style={{ fontSize: '0.75rem', padding: '2px 6px', border: '1px solid #d97706', borderRadius: '4px', backgroundColor: 'transparent', color: '#b45309', cursor: 'pointer' }}>취소</button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {/* 수강생 검색 */}
                        <div className="makeup-modal-content">
                            <h3>수강생 선택</h3>
                            <input
                                type="text"
                                placeholder="수강생 이름 검색..."
                                value={waitlistStudentSearch}
                                onChange={(e) => { setWaitlistStudentSearch(e.target.value); setWaitlistStudentName(''); }}
                                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '8px', boxSizing: 'border-box' }}
                            />
                            {waitlistStudentSearch && !waitlistStudentName && (
                                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '8px' }}>
                                    {(() => {
                                        const uniqueNames = [...new Set(students.filter(s => s['요일 및 시간']).map(s => s['이름']))];
                                        const filtered = uniqueNames.filter(name =>
                                            name && name.includes(waitlistStudentSearch)
                                        );
                                        if (filtered.length === 0) return <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: '0.85rem' }}>검색 결과 없음</div>;
                                        return filtered.map(name => (
                                            <div key={name}
                                                onClick={() => { setWaitlistStudentName(name); setWaitlistStudentSearch(name); }}
                                                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid #f3f4f6' }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f9ff'}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                                            >
                                                {name}
                                            </div>
                                        ));
                                    })()}
                                </div>
                            )}

                            {/* 선택된 수강생의 수업 목록 */}
                            {waitlistStudentName && (
                                <>
                                    <h3 style={{ marginTop: '8px' }}>{waitlistStudentName}님의 수업 중 옮길 수업 선택</h3>
                                    <div className="original-class-list">
                                        {(() => {
                                            const studentEntry = students.find(s => s['이름'] === waitlistStudentName && s['요일 및 시간']);
                                            if (!studentEntry) return <div style={{ padding: '8px', color: '#999' }}>수강생 정보를 찾을 수 없습니다.</div>;
                                            const scheduleStr = studentEntry['요일 및 시간'];
                                            const parsed = parseScheduleString(scheduleStr);
                                            if (parsed.length === 0) return <div style={{ padding: '8px', color: '#999' }}>등록된 수업이 없습니다.</div>;

                                            return parsed.map((schedule, index) => {
                                                const periodInfo = PERIODS.find(p => p.id === schedule.period);
                                                const isSameSlot = schedule.day === waitlistDesiredSlot.day && schedule.period === waitlistDesiredSlot.period;
                                                const alreadyWaiting = !isDirectTransfer && weekWaitlist.some(w =>
                                                    w.studentName === waitlistStudentName &&
                                                    w.desiredSlot.day === waitlistDesiredSlot.day &&
                                                    w.desiredSlot.period === waitlistDesiredSlot.period
                                                );
                                                const isDisabled = isSameSlot || alreadyWaiting;

                                                return (
                                                    <div key={index}
                                                        className={`original-class-item ${isDisabled ? 'disabled' : ''}`}
                                                        style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#f3f4f6' } : {}}
                                                        onClick={() => {
                                                            if (isDisabled) return;
                                                            if (isDirectTransfer) {
                                                                handleDirectTransfer(waitlistStudentName, {
                                                                    day: schedule.day,
                                                                    period: schedule.period,
                                                                    periodName: periodInfo?.name || ''
                                                                });
                                                            } else {
                                                                handleWaitlistSubmit(waitlistStudentName, {
                                                                    day: schedule.day,
                                                                    period: schedule.period,
                                                                    periodName: periodInfo?.name || ''
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <span className="period-name">{schedule.day}요일 {periodInfo?.name}</span>
                                                        {isSameSlot && <span style={{ fontSize: '0.8em', color: '#999', marginLeft: '8px' }}>같은 시간</span>}
                                                        {alreadyWaiting && <span style={{ fontSize: '0.8em', color: '#d97706', marginLeft: '8px' }}>이미 대기 중</span>}
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="makeup-modal-actions">
                            <button className="btn-cancel" onClick={() => { setShowWaitlistModal(false); setWaitlistDesiredSlot(null); setWaitlistStudentName(''); setWaitlistStudentSearch(''); setIsDirectTransfer(false); }}>
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Makeup Banners - 이번 주 보강 내역 (active + completed) */}
            {mode === 'student' && activeMakeupRequests.length > 0 && (
                <div className="active-makeup-banner">
                    <div className="banner-header" style={{ marginBottom: '8px', fontSize: '0.9rem', color: '#666' }}>
                        🔄 이번 주 보강 ({activeMakeupRequests.length}/{weeklyFrequency}개)
                    </div>
                    {activeMakeupRequests.map((makeup, index) => (
                        <div key={makeup.id} className="banner-content" style={{ marginBottom: index < activeMakeupRequests.length - 1 ? '8px' : '0' }}>
                            <div className="banner-text">
                                {makeup.originalClass.day}요일 {makeup.originalClass.periodName} → {makeup.makeupClass.day}요일 {makeup.makeupClass.periodName}
                                {makeup.status === 'completed' && <span style={{ marginLeft: '6px', color: '#16a34a', fontWeight: 700 }}>완료</span>}
                            </div>
                            {makeup.status === 'active' && !isMakeupClassSoon(makeup) && (
                                <button className="banner-cancel-btn" onClick={() => handleMakeupCancel(makeup.id)}>취소</button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 대기 신청 배너는 Dashboard(공지사항)로 이동됨 */}
        </div>
    );
};

export default WeeklySchedule;
