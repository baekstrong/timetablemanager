import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField, parseHoldingStatus } from '../services/googleSheetsService';
import {
    getActiveMakeupRequest,
    createMakeupRequest,
    cancelMakeupRequest,
    getMakeupRequestsByWeek,
    getHoldingsByWeek,
    getAbsencesByDate,
    getActiveHolding,
    getAbsencesByStudent,
    getDisabledClasses,
    toggleDisabledClass
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

    // Class disabled state (stored in Firebase)
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [disabledClassesLoading, setDisabledClassesLoading] = useState(true);

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

    // Load active makeup request for student mode (holdings are loaded by loadWeeklyData from Google Sheets)
    useEffect(() => {
        const loadStudentMakeupData = async () => {
            if (mode === 'student' && user && user.role !== 'coach') {
                try {
                    // Load makeup request (only for actual students, not coaches in student mode)
                    const makeup = await getActiveMakeupRequest(user.username);

                    // 보강 수업 시작 1시간 전이면 자동으로 완료 처리
                    if (makeup && isMakeupClassSoon(makeup)) {
                        console.log('⏰ 보강 수업 시작 1시간 전 - 자동 완료 처리');
                        try {
                            const { completeMakeupRequest } = await import('../services/firebaseService');
                            await completeMakeupRequest(makeup.id);
                            setActiveMakeupRequest(null);
                        } catch (error) {
                            console.error('보강 자동 완료 실패:', error);
                            setActiveMakeupRequest(makeup);
                        }
                    } else {
                        setActiveMakeupRequest(makeup);
                    }

                    console.log(`📊 Student makeup data loaded: makeup=${!!makeup}`);
                } catch (error) {
                    console.error('Failed to load student makeup data:', error);
                }
            }
        };
        loadStudentMakeupData();

        // 1분마다 체크하여 보강 시간이 다가오면 자동 완료 처리
        const checkInterval = setInterval(() => {
            if (activeMakeupRequest && isMakeupClassSoon(activeMakeupRequest)) {
                loadStudentMakeupData();
            }
        }, 60000); // 1분마다 체크

        return () => clearInterval(checkInterval);
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

            // Load makeup requests from Firebase
            const makeups = await getMakeupRequestsByWeek(startDate, endDate).catch(err => {
                console.warn('Failed to load makeup requests:', err);
                return [];
            });

            // Extract holding data from Google Sheets students instead of Firebase
            const holdings = [];
            if (students && students.length > 0) {
                students.forEach(student => {
                    const holdingStatus = getStudentField(student, '홀딩 사용여부');
                    // Parse holding status (supports both 'O' and 'O(1/2)' formats)
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

                                // Only include if holding period overlaps with THIS WEEK (not next week)
                                // Use thisWeekEndDate instead of endDate to limit to current week
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

            console.log(`✅ Loaded ${makeups?.length || 0} makeup requests, ${holdings?.length || 0} holdings (from Google Sheets), ${allAbsences?.length || 0} absences`);
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

        // Auto-refresh every 30 minutes when component is mounted
        const refreshInterval = setInterval(async () => {
            console.log('🔄 Auto-refreshing weekly data...');
            // Google Sheets 데이터도 새로고침 (홀딩 실시간 반영)
            await refresh();
            loadWeeklyData();
        }, 1800000); // 30 minutes

        // Refresh when window gains focus (user comes back to the page)
        const handleFocus = async () => {
            console.log('🔄 Window focused - refreshing data...');
            // Google Sheets 데이터도 새로고침 (홀딩 실시간 반영)
            await refresh();
            loadWeeklyData();
        };
        window.addEventListener('focus', handleFocus);

        // Cleanup
        return () => {
            clearInterval(refreshInterval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [mode, students, refresh]); // Depend on students to reload holdings when Google Sheets data changes

    // Handle available seat click
    const handleAvailableSeatClick = (day, periodId, date) => {
        // Only allow makeup requests for actual students (not coaches viewing student mode)
        if (mode !== 'student' || user?.role === 'coach') return;

        if (activeMakeupRequest) {
            alert('이미 활성화된 보강 신청이 있습니다. 먼저 취소해주세요.');
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
        let holdingStudents = [];

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

            // Find students with absence requests for this date (일반 결석)
            // 해당 슬롯에 등록된 학생만 결석으로 표시
            absenceStudents = weekAbsences
                .filter(a => a.date === slotDate && studentNames.includes(a.studentName))
                .map(a => a.studentName)
                // 보강결석이 아닌 학생만 일반 결석으로 표시
                .filter(name => !makeupAbsentStudents.includes(name));

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
        }

        // 5. Calculate counts
        // Active Students = (Regular - MakeupAbsent - Absence - Holding) + Substitutes + MakeupStudents
        const allAbsentStudents = [...new Set([...makeupAbsentStudents, ...absenceStudents])];
        const activeStudents = studentNames.filter(name =>
            !allAbsentStudents.includes(name) &&
            !holdingStudents.includes(name)
        );

        // Regular students who are on the roster (not holding, but may be absent)
        const regularStudentsPresent = studentNames.filter(name =>
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
            absenceStudents, // 새로 추가: 일반 결석 학생
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

            // Check if this cell is part of makeup request
            let isMakeupFrom = false; // 보강으로 결석하는 수업
            let isMakeupTo = false; // 보강으로 출석하는 수업

            if (activeMakeupRequest && weekDates) {
                // weekDates[day]는 "M/D" 형식 (예: "2/4")
                // activeMakeupRequest의 date는 "YYYY-MM-DD" 형식 (예: "2026-02-04")
                // 비교를 위해 weekDates를 YYYY-MM-DD 형식으로 변환
                const cellDateMMDD = weekDates[day]; // "2/4"
                let cellDateFormatted = '';
                if (cellDateMMDD) {
                    const [month, dayNum] = cellDateMMDD.split('/');
                    const year = new Date().getFullYear();
                    cellDateFormatted = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;
                }

                // Check if this is the original class (makeup FROM)
                if (activeMakeupRequest.originalClass.date === cellDateFormatted &&
                    activeMakeupRequest.originalClass.day === day &&
                    activeMakeupRequest.originalClass.period === periodObj.id) {
                    isMakeupFrom = true;
                }

                // Check if this is the makeup class (makeup TO)
                if (activeMakeupRequest.makeupClass.date === cellDateFormatted &&
                    activeMakeupRequest.makeupClass.day === day &&
                    activeMakeupRequest.makeupClass.period === periodObj.id) {
                    isMakeupTo = true;
                }
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
                        onClick={() => toggleClassDisabledHandler(day, periodObj.id)}
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
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 'bold', borderBottom: '1px solid #eee' }}>
                        <span>
                            {data.isFull
                                ? <span style={{ color: 'red' }}>Full</span>
                                : <>{data.currentCount}명<span style={{ color: '#666', fontWeight: 'normal', marginLeft: '4px' }}>(여석: {data.availableSeats}자리)</span></>
                            }
                        </span>
                    </div>

                    <div className="student-list">
                        {/* 1. Regular Students Present (not on hold, not holding) - show with makeup-absent or absence styling if applicable */}
                        {data.regularStudentsPresent.map(name => {
                            const isMakeupAbsent = data.makeupAbsentStudents.includes(name);
                            const isAbsent = data.absenceStudents && data.absenceStudents.includes(name);
                            if (isMakeupAbsent) {
                                return (
                                    <span key={name} className="student-tag" style={{ backgroundColor: '#fef3c7', color: '#92400e', textDecoration: 'line-through' }}>
                                        {name}(보강결석)
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

                                    // 해당 요일의 날짜 계산
                                    const dateStr = weekDates[schedule.day];
                                    let originalDateStr = '';
                                    let isPastDate = false;
                                    let isStarted = false;
                                    if (dateStr) {
                                        const [month, dayNum] = dateStr.split('/');
                                        const year = new Date().getFullYear();
                                        originalDateStr = `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;

                                        // 과거 날짜인지 확인
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const classDate = new Date(originalDateStr + 'T00:00:00');
                                        isPastDate = classDate < today;

                                        // 수업이 이미 시작했는지 확인 (오늘 날짜인 경우)
                                        if (!isPastDate) {
                                            isStarted = hasClassStarted(originalDateStr, schedule.period);
                                        }
                                    }

                                    const isDisabled = isPastDate || isStarted;

                                    return (
                                        <div
                                            key={index}
                                            className={`original-class-item ${selectedOriginalClass?.day === schedule.day && selectedOriginalClass?.period === schedule.period ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#f3f4f6' } : {}}
                                            onClick={() => {
                                                if (isPastDate) {
                                                    alert('이미 지난 수업은 보강 신청을 할 수 없습니다.');
                                                    return;
                                                }
                                                if (isStarted) {
                                                    alert('이미 시작한 수업은 보강 신청을 할 수 없습니다.');
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
                                                ({dateStr}){isPastDate && ' - 지남'}{isStarted && ' - 수업 중'}
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

            {/* Active Makeup Banner - 보강 수업 시작 1시간 전에는 숨김 */}
            {activeMakeupRequest && mode === 'student' && !isMakeupClassSoon(activeMakeupRequest) && (
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
