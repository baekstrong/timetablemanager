import { Fragment, useState, useMemo, useEffect } from 'react';
import { PERIODS, DAYS, MAX_CAPACITY, KOREAN_HOLIDAYS } from '../../data/mockData';
import {
    getActiveMakeupRequests,
    getWeekMakeupRequests,
    createMakeupRequest,
    cancelMakeupRequest,
    completeMakeupRequest,
    getHolidays,
    createMakeupWaitlist,
    getActiveMakeupWaitlists,
    updateMakeupWaitlistStatus,
    acceptMakeupWaitlist,
    declineMakeupWaitlist,
} from '../../services/firebaseService';
import { normalizeWaitlistEntry, onSeatFreed } from '../../services/makeupWaitlistService';
import { isNotificationExpired, getNotificationDeadline } from '../../utils/makeupWaitlist';
import { processHolidayMakeupEndDate, getStudentField, calculateMembershipStats } from '../../services/googleSheetsService';
import {
    weekDateToISO,
    isClassWithinMinutes,
    getThisWeekRange,
    getWaitlistCountForSlot,
    parseSheetDate,
    formatDateISO,
    wouldDoubleBookDay,
} from '../../utils/scheduleUtils';
import { getMakeupWeeklyLimit, countWeekMakeupCommitments } from '../../utils/makeupQuota';
import { secondClassDayISO, cappedEndForFirstClassMove } from '../../utils/makeupEndDate';
import MakeupModal from './MakeupModal';
import MakeupWaitlistResponseModal from './MakeupWaitlistModal';
import { StudentTag, AvailableSeatsCell, HolidayCell } from './ScheduleCell';
import StudentClassView from './StudentClassView';
import StudentMakeupSlot from './StudentMakeupSlot';
import ReviewModal from '../../features/today/ReviewModal';
import { buildStudentWeek, studentWeekDays, classLabel, classStartMs, sourceUnavailableReason, studentDateISO } from './studentClassModel';

const DEFAULT_SERVICES = { getActiveMakeupRequests, getWeekMakeupRequests, createMakeupRequest, cancelMakeupRequest, completeMakeupRequest, getHolidays, createMakeupWaitlist, getActiveMakeupWaitlists, updateMakeupWaitlistStatus, acceptMakeupWaitlist, declineMakeupWaitlist, onSeatFreed, processHolidayMakeupEndDate };
const EMPTY_LIST = [];
const denyReadOnlyWrite = async () => { throw new Error('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); };
const READ_ONLY_WRITES = { createMakeupRequest: denyReadOnlyWrite, cancelMakeupRequest: denyReadOnlyWrite, completeMakeupRequest: denyReadOnlyWrite, createMakeupWaitlist: denyReadOnlyWrite, updateMakeupWaitlistStatus: denyReadOnlyWrite, acceptMakeupWaitlist: denyReadOnlyWrite, declineMakeupWaitlist: denyReadOnlyWrite, onSeatFreed: denyReadOnlyWrite, processHolidayMakeupEndDate: denyReadOnlyWrite };

const KOR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
// "2026-06-24" → "6월 24일(수)"
function formatKoreanDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getMonth() + 1}월 ${d.getDate()}일(${KOR_DAYS[d.getDay()]})`;
}

/**
 * 학생 모드(mode === 'student') 화면 전체를 렌더.
 * 실제 학생(user.role === 'student')과 코치의 "신규 전용" 뷰(user.role === 'coach' && mode === 'student') 모두 처리.
 *
 * 코치의 신규 전용 뷰에서의 셀 클릭(만석/여석 → 대기/직접 이동)은 부모의 CoachWaitlistModal에 위임하기 위해
 * onCoachCellClick 콜백으로 올려보낸다.
 */
export default function StudentSchedule(props) {
    // A new week cannot retain a previous week's selected class or open request.
    return <CurrentWeekStudentSchedule key={`${props.user?.username || ''}-${props.weekDates?.['월'] || ''}`} {...props} />;
}

function CurrentWeekStudentSchedule({
    user,
    // scheduleCore 파생 데이터
    weekDates,
    weekAbsences,
    weekWaitlist,
    studentSchedule,
    studentData,
    isMyHoldingDate,
    isMakeupHeld,
    getCellData,
    getHolidayInfo,
    loadWeeklyData,
    refreshStudents,
    // 셀 상태 판정
    isClassDisabled,
    isSlotLocked,
    // 코치 신규 전용 연동
    newStudentWaitlist = [],
    onCoachCellClick,
    freeWorkoutByDate = {},
    // 코치 "수강생 전용(강제)" 모드 — 시간 데드라인/주 1회/홀딩 제약 우회
    forceMode = false,
    onNavigate,
    weekHolidays = EMPTY_LIST,
    weekHoldings = EMPTY_LIST,
    weeklyDataLoaded = true,
    weeklyDataError = '',
    getEffectiveEndDate,
    services = DEFAULT_SERVICES,
    now: suppliedNow,
    readOnly = false,
    initialTab = 'mine',
}) {
    const effectiveServices = readOnly ? { ...services, ...READ_ONLY_WRITES } : services;
    const { getActiveMakeupRequests, getWeekMakeupRequests, createMakeupRequest, cancelMakeupRequest, completeMakeupRequest, getHolidays, createMakeupWaitlist, getActiveMakeupWaitlists, updateMakeupWaitlistStatus, acceptMakeupWaitlist, declineMakeupWaitlist, onSeatFreed, processHolidayMakeupEndDate } = effectiveServices;
    const [clockNow, setClockNow] = useState(() => new Date());
    const now = suppliedNow || clockNow;
    const [studentTab, setStudentTab] = useState(initialTab === 'all' ? 'all' : 'mine');
    const [personalReload, setPersonalReload] = useState(0);
    const [makeupDataState, setMakeupDataState] = useState('loading');
    const [flowStep, setFlowStep] = useState(null);
    const [flowTarget, setFlowTarget] = useState(null);
    const [flowWaiting, setFlowWaiting] = useState(false);
    const isRealStudent = user?.role !== 'coach';
    const modernStudent = isRealStudent && !forceMode;
    const studentRequestDataError = modernStudent
        ? weeklyDataError || (!weeklyDataLoaded || makeupDataState === 'loading'
            ? '최신 시간표 정보를 확인한 뒤 다시 신청해주세요.'
            : makeupDataState === 'error' ? '보강 정보를 불러오지 못했어요. 새로고침 후 다시 확인해주세요.'
                : !studentData ? '수강 정보를 찾을 수 없어요. 등록 상태를 코치에게 확인해주세요.' : '')
        : '';
    const days = studentWeekDays(weekDates, 0, now);
    useEffect(() => {
        if (suppliedNow) return;
        const interval = setInterval(() => setClockNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, [suppliedNow]);

    // ── 학생 전용 state ──
    const [showMakeupModal, setShowMakeupModal] = useState(false);
    const [selectedMakeupSlot, setSelectedMakeupSlot] = useState(null);
    const [selectedOriginalClass, setSelectedOriginalClass] = useState(null);
    // 이번 주 보강 이력 (cancelled 포함 — 주 수강 횟수별 쿼터 계산용)
    const [myWeekMakeupHistory, setMyWeekMakeupHistory] = useState([]);
    const makeupWeeklyLimit = useMemo(
        () => getMakeupWeeklyLimit(studentData, studentSchedule),
        [studentData, studentSchedule]
    );
    // 활성/완료 보강만 — 그리드/패널 렌더링용
    const activeMakeupRequests = useMemo(
        () => myWeekMakeupHistory.filter(m => m.status !== 'cancelled'),
        [myWeekMakeupHistory]
    );
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);
    // 원래 수업이 만석이라 '그냥 취소'가 불가능할 때, 다른 시간으로 옮기는 중인 보강
    const [changingMakeup, setChangingMakeup] = useState(null);

    // ── 만석 슬롯 보강 대기 ──
    const [activeWaitlists, setActiveWaitlists] = useState([]); // 전체 활성 대기 (슬롯별 대기 인원 표시용)
    const [showWaitlistRequest, setShowWaitlistRequest] = useState(false);
    const [waitlistSlot, setWaitlistSlot] = useState(null);            // { day, period, periodName, date }
    const [waitlistOriginalClass, setWaitlistOriginalClass] = useState(null);
    const [respondingWaitlist, setRespondingWaitlist] = useState(null); // notified 항목
    const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);

    const myWaitlists = useMemo(
        () => activeWaitlists.filter(w => w.studentName === user?.username),
        [activeWaitlists, user]
    );

    // 이번 주 보강 '약속' 건수(보강 이력 + 활성 대기) — 대기도 수락 시 보강이 되므로 미리 횟수에 포함
    const myWeekCommitments = useMemo(() => {
        const { start, end } = getThisWeekRange(now);
        const valid = myWaitlists.filter(entry => entry.status === 'waiting' ? classStartMs(entry) > now.getTime() : entry.status === 'notified' && !isNotificationExpired(entry, now));
        return countWeekMakeupCommitments(myWeekMakeupHistory, valid, start, end);
    }, [myWeekMakeupHistory, myWaitlists, now]);

    const allHolidays = [...Object.entries(KOREAN_HOLIDAYS).map(([date, reason]) => ({ date, reason })), ...weekHolidays];
    // Sheets의 현재 홀딩도 보존하되 실제 선택 날짜가 있는 Firebase 홀딩을 먼저 쓴다.
    const personalHoldings = [...weekHoldings];
    for (const registration of [studentData, studentData?._prevRegistration, studentData?._nextRegistration].filter(Boolean)) {
        const startDate = studentDateISO(registration['홀딩 시작일']);
        const endDate = studentDateISO(registration['홀딩 종료일']);
        if (startDate && endDate && String(registration['홀딩 사용여부'] || '').startsWith('O') && !personalHoldings.some(item => item.studentName === user?.username && item.startDate === startDate && item.endDate === endDate)) personalHoldings.push({ studentName: user?.username, startDate, endDate });
    }
    const personalSessions = buildStudentWeek({ days, studentData, studentName: user?.username, makeups: myWeekMakeupHistory, holdings: personalHoldings, absences: weekAbsences, holidays: allHolidays, isClassDisabled, freeWorkoutByDate });
    const membership = studentData && studentDateISO(getStudentField(studentData, '종료날짜')) ? calculateMembershipStats(studentData, weekHolidays) : null;
    if (membership?.endDate && getEffectiveEndDate) {
        const effective = getEffectiveEndDate(studentData, new Date(`${membership.endDate}T00:00:00`));
        if (effective) membership.endDate = formatDateISO(effective);
    }
    const validWaits = myWaitlists.filter(entry => entry.status === 'waiting' ? classStartMs(entry) > now.getTime() : entry.status === 'notified' && !isNotificationExpired(entry, now));

    function changeStudentTab(tab) {
        setStudentTab(tab);
    }

    function chooseOriginal(session) {
        const original = { date: session.date, day: session.day, period: session.period, periodName: session.periodName };
        setSelectedOriginalClass(original);
        setWaitlistOriginalClass(original);
    }

    function startStudentMakeup(session) {
        chooseOriginal(session);
        setStudentTab('all');
    }

    function closeStudentFlow() {
        if (isSubmittingMakeup || isSubmittingWaitlist) return;
        setFlowStep(null);
        setFlowTarget(null);
    }

    function validateStudentOriginal(original) {
        if (!modernStudent) return true;
        if (!validateStudentDataReady()) return false;
        const session = personalSessions.find(item => item.date === original?.date && Number(item.period) === Number(original?.period));
        const error = !session ? '등록 기간 안의 원래 수업을 다시 선택해주세요.' : sourceUnavailableReason(session, { now: new Date(), quotaUsed: myWeekCommitments, quotaLimit: makeupWeeklyLimit, waits: validWaits });
        if (error) { alert(error); return false; }
        return true;
    }

    function validateStudentDataReady() {
        if (studentRequestDataError) { alert(studentRequestDataError); return false; }
        return true;
    }

    async function retryStudentData() {
        setPersonalReload(value => value + 1);
        // 명단 오류도 복구해야 하므로 주간 Firestore 조회와 Sheets 조회를 함께 다시 한다.
        await Promise.allSettled([loadWeeklyData(), refreshStudents?.()]);
    }

    function wouldDoubleBookStudent(original, day, date, makeups = activeMakeupRequests) {
        // 등록 교체가 주중에 있으면 대표 등록 한 행의 요일로 판단하지 않는다.
        const schedule = modernStudent && days.some(item => item.date === date)
            ? personalSessions.filter(item => item.origin?.date === item.date && Number(item.origin?.period) === item.period).map(item => ({ day: item.day, period: item.period }))
            : studentSchedule;
        return wouldDoubleBookDay(schedule, makeups, original, day, date);
    }

    async function reloadMyWaitlists() {
        const list = await getActiveMakeupWaitlists();
        setActiveWaitlists(list.map(normalizeWaitlistEntry));
    }

    // 해당 슬롯(날짜+요일+교시)의 유효 대기 인원 수
    function getSeatWaitCount(date, day, periodId) {
        if (!date) return 0;
        return activeWaitlists.filter(w =>
            w.date === date && w.day === day && w.period === periodId &&
            (w.status === 'waiting' || (w.status === 'notified' && !isNotificationExpired(w)))
        ).length;
    }

    async function syncHolidayMakeupEndDate(makeupRequests, referenceDate = null) {
        // active 보강만 카운트 (completed는 과거에 이미 처리되었거나 레거시 데이터일 가능성 높아 재적용 시 종료일이 중복 당겨지는 것을 방지)
        const countedHolidayDates = (makeupRequests || [])
            .filter(m => m.status === 'active')
            .map(m => m.originalClass?.date)
            .filter(Boolean);

        if (referenceDate && !countedHolidayDates.includes(referenceDate)) {
            countedHolidayDates.push(referenceDate);
        }

        if (countedHolidayDates.length === 0) {
            return { success: true, updated: false };
        }

        const firebaseHolidays = await getHolidays().catch(() => []);
        return await processHolidayMakeupEndDate(
            user.username,
            countedHolidayDates,
            firebaseHolidays,
            referenceDate || countedHolidayDates[0]
        );
    }

    // ── 보강 데이터 로드 ──
    useEffect(() => {
        if (user?.role === 'coach' || !weeklyDataLoaded) return;
        let cancelled = false;
        async function loadStudentMakeupData() {
            try {
                // 세 조회는 서로 결과를 안 쓴다(getWeekMakeupRequests는 status 필터가 없어
                // 자동완료 전환에도 영향받지 않는다) → 병렬. 자동완료도 건별 독립이라 Promise.all.
                const { start, end } = getThisWeekRange();
                const [activeAndCompleted, thisWeekMakeups, waitlists] = await Promise.all([
                    getActiveMakeupRequests(user.username),
                    getWeekMakeupRequests(user.username, start, end),
                    getActiveMakeupWaitlists(),
                ]);
                if (cancelled) return;
                setMyWeekMakeupHistory(thisWeekMakeups);
                setActiveWaitlists(waitlists.map(normalizeWaitlistEntry));
                setMakeupDataState('loaded');

                // 지난 보강 자동 완료 처리 (active → completed)
                await Promise.all((readOnly ? [] : activeAndCompleted)
                    .filter(m => m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0))
                    .map(m => completeMakeupRequest(m.id)
                        .then(() => { m.status = 'completed'; })
                        .catch(err => console.error('수강생 보강 자동 완료 실패:', m.id, err))));
            } catch (error) {
                if (!cancelled) setMakeupDataState('error');
                console.error('Failed to load student makeup data:', error);
            }
        }
        loadStudentMakeupData();
        return () => { cancelled = true; };
    }, [user, personalReload, weeklyDataLoaded, completeMakeupRequest, getActiveMakeupRequests, getWeekMakeupRequests, getActiveMakeupWaitlists, readOnly]);

    // ── 헬퍼 ──
    // 보강 자리가 비었을 때(취소·시간 변경) 대기 1순위에게 알림. 취소된 보강생은 아직 주간 상태에
    // 남아 currentCount에 잡히므로 1명 뺀 값이 실제 인원. 이번 주 슬롯이 아니면 1자리 가정(null).
    async function notifyMakeupSeatFreed(mc) {
        try {
            const periodObj = PERIODS.find(p => p.id === mc.period);
            const expectedDate = weekDates[mc.day] ? weekDateToISO(weekDates[mc.day]) : null;
            const seats = (periodObj && expectedDate === mc.date)
                ? Math.max(0, MAX_CAPACITY - (getCellData(mc.day, periodObj).currentCount - 1))
                : null;
            await onSeatFreed(mc.date, mc.day, mc.period, seats);
        } catch (e) {
            console.error('보강 대기 알림 트리거 실패:', e);
        }
    }

    // 원래 수업 슬롯이 지금 만석인지 — 보강으로 나간 본인은 이미 인원에서 빠져 있으므로
    // isFull이면 "돌아가면 정원 초과". 이번 주 화면 범위 밖이면 판단하지 않는다(false).
    function isOriginalSlotFull(originalClass) {
        if (!originalClass) return false;
        const periodObj = PERIODS.find(p => p.id === originalClass.period);
        const expectedDate = weekDates[originalClass.day] ? weekDateToISO(weekDates[originalClass.day]) : null;
        if (!periodObj || expectedDate !== originalClass.date) return false;
        return getCellData(originalClass.day, periodObj).isFull;
    }

    // 종료일(그 주 첫 수업일) 수업을 '두번째 수업일'보다 뒤로 옮기면 표시상 종료일이 당겨짐 — 안내(취소 가능).
    // 진행해도 되면 true.
    function confirmEndDateShift(originalClass, targetSlot) {
        const endISO = (() => {
            const ed = parseSheetDate(getStudentField(studentData, '종료날짜'));
            return ed ? formatDateISO(ed) : null;
        })();
        if (!endISO || originalClass.date !== endISO) return true;

        const scheduleStr = getStudentField(studentData, '요일 및 시간') || '';
        const secondISO = secondClassDayISO(scheduleStr, endISO);
        if (!secondISO || targetSlot.date <= secondISO) return true;

        const secondM = myWeekMakeupHistory.find(m =>
            m.originalClass?.date === secondISO && (m.status === 'active' || m.status === 'completed')
        );
        const capped = cappedEndForFirstClassMove({
            scheduleStr, endDateISO: endISO,
            firstMakeupISO: targetSlot.date,
            secondMakeupISO: secondM?.makeupClass?.date || null,
        });
        return window.confirm(
            `이 수업이 ${forceMode ? '해당 수강생의 ' : ''}마지막 수업이에요.\n` +
            `보강으로 옮기면 수강 종료일(마지막 수업)이 ${formatKoreanDate(capped.capISO)}로 변경됩니다.\n\n계속하시겠어요?`
        );
    }

    async function reloadStudentMakeups() {
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
        setMyWeekMakeupHistory(thisWeekMakeups);
    }

    // ── 핸들러 ──
    function handleAvailableSeatClick(day, periodId, date) {
        if (user?.role === 'coach') return;
        if (!validateStudentDataReady()) return;

        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // 본인이 이 날짜 홀딩 중이면 보강 관련 클릭 전부 차단 (강제 모드에선 우회)
        if (!forceMode && isMyHoldingDate?.(date)) {
            alert('홀딩 기간 중에는 보강 신청을 할 수 없습니다.\n홀딩이 끝난 뒤 신청해주세요.');
            return;
        }

        // 주 수강 횟수만큼 당주 보강 신청 가능 (취소 내역·활성 대기도 소진으로 간주)
        if (!forceMode && myWeekCommitments >= makeupWeeklyLimit) {
            alert(`보강은 주 ${makeupWeeklyLimit}회까지 신청 가능합니다.\n이번 주 보강·대기 신청 내역(취소 포함)이 있어 추가 신청이 불가합니다.`);
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(date + 'T00:00:00') < today) {
            alert('과거 날짜로는 보강 신청을 할 수 없습니다.');
            return;
        }

        if (!forceMode && isClassWithinMinutes(date, periodId, 120)) {
            const period = PERIODS.find(p => p.id === periodId);
            alert(`${period?.name} 수업이 곧 시작됩니다.\n수업 시작 2시간 전까지만 보강 신청이 가능합니다.`);
            return;
        }

        // 이중 수강(원래 수업일이 있는 요일로 다른 날 수업을 옮겨오는 것)은 원래 수업 선택 후
        // 모달/제출 단계에서 wouldDoubleBookDay로 차단한다(같은 날 이동은 허용해야 하므로 여기선 막지 않음).
        const period = PERIODS.find(p => p.id === periodId);
        const slot = { day, period: periodId, periodName: period.name, date };

        // 시간 변경 중이면 원래 수업이 이미 정해져 있으므로 모달 없이 바로 교체한다.
        if (changingMakeup) {
            submitMakeupChange(slot);
            return;
        }

        setSelectedMakeupSlot(slot);
        if (modernStudent) {
            setFlowTarget(slot);
            setFlowWaiting(false);
            setFlowStep(selectedOriginalClass ? 'confirm' : 'source');
        } else setShowMakeupModal(true);
    }

    async function handleMakeupSubmit() {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!selectedOriginalClass || !selectedMakeupSlot) return;
        if (!validateStudentOriginal(selectedOriginalClass)) return;
        if (modernStudent && (isClassWithinMinutes(selectedMakeupSlot.date, selectedMakeupSlot.period, 120) || isSlotLocked(selectedMakeupSlot.day, selectedMakeupSlot.period) || isMyHoldingDate?.(selectedMakeupSlot.date))) {
            alert('선택한 보강 수업을 지금 신청할 수 없어요. 다른 시간을 선택해주세요.');
            return;
        }

        if (selectedOriginalClass.day === selectedMakeupSlot.day &&
            selectedOriginalClass.period === selectedMakeupSlot.period &&
            selectedOriginalClass.date === selectedMakeupSlot.date) {
            alert('같은 수업으로 보강 신청할 수 없습니다.\n다른 시간을 선택해주세요.');
            return;
        }

        // 이중 수강 방지: 다른 날 수업을 이미 정규 수업이 있는 요일로 옮기면 차단(같은 날 이동은 허용)
        if (wouldDoubleBookStudent(selectedOriginalClass, selectedMakeupSlot.day, selectedMakeupSlot.date)) {
            alert('보강 대상 요일에 이미 다른 정규 수업이 있어요.\n같은 날 다른 수업을 옮기거나, 다른 요일을 선택해주세요.');
            return;
        }

        if (!forceMode && isClassWithinMinutes(selectedOriginalClass.date, selectedOriginalClass.period, 120)) {
            alert(`${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} 수업이 이미 시작되었거나 곧 시작됩니다.\n원래 수업 시작 2시간 전까지만 보강 신청이 가능합니다.`);
            return;
        }

        if (!forceMode && isMyHoldingDate?.(selectedOriginalClass.date)) {
            alert('홀딩 기간 중인 수업은 보강 신청할 수 없습니다.\n홀딩이 끝난 뒤 신청해주세요.');
            return;
        }

        if (!confirmEndDateShift(selectedOriginalClass, selectedMakeupSlot)) return;

        setIsSubmittingMakeup(true);
        try {
            await createMakeupRequest(user.username, selectedOriginalClass, selectedMakeupSlot);
            let endDateMessage = '';
            try {
                const activeAndCompleted = await getActiveMakeupRequests(user.username);
                const endDateResult = await syncHolidayMakeupEndDate(activeAndCompleted, selectedOriginalClass.date);
                if (endDateResult.updated && endDateResult.newEndDate) {
                    endDateMessage = `\n새 종료일: ${endDateResult.newEndDate}`;
                    await refreshStudents?.();
                }
            } catch (endDateError) {
                console.error('휴일 보강 종료일 재계산 실패:', endDateError);
                endDateMessage = `\n※ 보강 신청은 완료되었지만 종료일 자동 조정에 실패했습니다. 코치에게 문의해주세요.${endDateError?.message ? `\n사유: ${endDateError.message}` : ''}`;
            }

            alert(`보강 신청 완료!\n${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} → ${selectedMakeupSlot.day}요일 ${selectedMakeupSlot.periodName}${endDateMessage}`);
            await Promise.all([reloadStudentMakeups(), loadWeeklyData()]);
            setShowMakeupModal(false);
            setSelectedMakeupSlot(null);
            setSelectedOriginalClass(null);
            setFlowStep(null);
            setFlowTarget(null);
            setStudentTab('mine');
        } catch (error) {
            alert(`보강 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingMakeup(false);
        }
    }

    async function handleMakeupCancel(makeupId) {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!validateStudentDataReady()) return;
        if (!makeupId) return;
        const makeup = activeMakeupRequests.find(m => m.id === makeupId);
        if (!forceMode && makeup && isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 60)) {
            alert('보강 수업 시작 1시간 전부터는 보강 취소가 불가합니다.');
            return;
        }
        // 보강으로 비운 원래 자리는 그 사이 다른 수강생이 채울 수 있다. 그 상태로 그냥 취소하면
        // 원래 수업이 정원(7명)을 넘기므로, 취소 대신 '다른 시간으로 변경'만 허용한다.
        const mo = makeup?.originalClass;
        const remaining = Math.max(0, makeupWeeklyLimit - myWeekCommitments);
        if (!forceMode && makeup && isOriginalSlotFull(mo)) {
            if (remaining <= 0) {
                alert(`원래 수업(${mo.day}요일 ${mo.periodName})이 지금 만석이라 돌아갈 자리가 없어요.\n`
                    + '이번 주 보강 횟수도 모두 사용해 시간 변경도 어렵습니다.\n코치에게 문의해주세요.');
                return;
            }
            if (!confirm(`원래 수업(${mo.day}요일 ${mo.periodName})이 지금 만석이라 돌아갈 자리가 없어요.\n\n`
                + '대신 보강을 다른 시간으로 옮길 수 있어요.\n확인을 누른 뒤 여석이 있는 칸을 선택해주세요.')) return;
            setChangingMakeup(makeup);
            if (modernStudent) setStudentTab('all');
            return;
        }
        const cancelMsg = '이 보강 신청을 취소하시겠습니까?\n\n'
            + (mo ? `취소하면 원래 수업(${mo.day}요일 ${mo.periodName})에 출석하셔야 해요.\n` : '')
            + '보강은 취소해도 이번 주 횟수가 복구되지 않습니다.\n'
            + (remaining > 0
                ? `(이번 주 남은 보강 ${remaining}회 — 다른 시간으로 다시 신청하실 수 있어요)`
                : '(이번 주 남은 보강 0회 — 다시 신청할 수 없어요)');
        if (!confirm(cancelMsg)) return;
        try {
            await cancelMakeupRequest(makeupId);

            // 보강 취소로 빠진 자리 → 대기자 알림 (실제 여석 기준, 만석 오알림 방지)
            if (makeup) await notifyMakeupSeatFreed(makeup.makeupClass);

            alert('보강 신청이 취소되었습니다.');
            await Promise.all([reloadStudentMakeups(), loadWeeklyData()]);
        } catch (error) {
            alert(`보강 신청 취소 실패: ${error.message}`);
        }
    }

    /**
     * 원래 수업이 만석일 때의 '보강 시간 변경' — 새 보강을 만들고 기존 보강을 취소한다.
     * 원래 수업은 그대로이므로 종료일 재계산(휴일 보강)은 결과가 같아 생략.
     */
    async function submitMakeupChange(newSlot) {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!validateStudentDataReady()) return;
        const target = changingMakeup;
        if (!target) return;
        const oc = target.originalClass;
        const mc = target.makeupClass;

        if (newSlot.day === mc.day && newSlot.period === mc.period && newSlot.date === mc.date) {
            alert('지금 신청된 보강과 같은 시간이에요.\n다른 시간을 선택해주세요.');
            return;
        }
        if (newSlot.day === oc.day && newSlot.period === oc.period && newSlot.date === oc.date) {
            alert('같은 수업으로 보강 신청할 수 없습니다.\n다른 시간을 선택해주세요.');
            return;
        }
        // 옮기려는 보강 자신은 이중 수강 판정에서 제외 — 그 자리는 곧 비운다.
        const otherMakeups = activeMakeupRequests.filter(m => m.id !== target.id);
        if (wouldDoubleBookStudent(oc, newSlot.day, newSlot.date, otherMakeups)) {
            alert('보강 대상 요일에 이미 다른 정규 수업이 있어요.\n다른 요일을 선택해주세요.');
            return;
        }
        if (!confirmEndDateShift(oc, newSlot)) return;
        if (!confirm(`보강 시간을 옮길까요?\n\n${mc.day}요일 ${mc.periodName} → ${newSlot.day}요일 ${newSlot.periodName}\n`
            + `(원래 수업: ${oc.day}요일 ${oc.periodName})\n\n※ 변경도 이번 주 보강 1회로 계산됩니다.`)) return;

        setIsSubmittingMakeup(true);
        try {
            await createMakeupRequest(user.username, oc, newSlot);
            await cancelMakeupRequest(target.id);
            await notifyMakeupSeatFreed(mc); // 비운 기존 보강 자리 → 대기자 알림
            setChangingMakeup(null);
            if (modernStudent) setStudentTab('mine');
            alert(`보강 시간이 변경되었습니다!\n${newSlot.day}요일 ${newSlot.periodName}`);
            await Promise.all([reloadStudentMakeups(), loadWeeklyData()]);
        } catch (error) {
            alert(`보강 시간 변경 실패: ${error.message}`);
        } finally {
            setIsSubmittingMakeup(false);
        }
    }

    // ── 보강 대기 핸들러 ──
    function openWaitlistRequest(day, periodId, date) {
        if (!validateStudentDataReady()) return;
        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }
        if (!forceMode && isMyHoldingDate?.(date)) {
            alert('홀딩 기간 중에는 보강 대기를 신청할 수 없습니다.');
            return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(date + 'T00:00:00') < today) {
            alert('과거 날짜로는 대기 신청을 할 수 없습니다.');
            return;
        }
        if (isClassWithinMinutes(date, periodId, 0)) {
            alert('이미 시작된 수업입니다.');
            return;
        }
        // 보강+대기를 합쳐 주 수강 횟수까지만 신청 가능. 이미 다 썼으면 대기해도 수락이 안 되므로 미리 차단.
        if (!forceMode && myWeekCommitments >= makeupWeeklyLimit) {
            alert(`이번 주 보강 횟수를 모두 사용하셔서 대기 신청을 할 수 없어요.\n(보강 신청과 대기 신청을 합쳐 주 ${makeupWeeklyLimit}회까지)`);
            return;
        }
        // 이중 수강 차단은 원래 수업 선택 후(대기 모달·수락 단계)에서 처리 — 같은 날 이동은 허용해야 하므로.
        const period = PERIODS.find(p => p.id === periodId);
        const slot = { day, period: periodId, periodName: period?.name || '', date };
        if (!modernStudent && !confirm(`이 시간은 현재 만석입니다.\n${day}요일 ${period?.name}에 보강 대기를 신청하시겠습니까?\n자리가 나면 선착순으로 문자 안내를 드립니다.`)) return;
        setWaitlistSlot(slot);
        if (modernStudent) {
            setWaitlistOriginalClass(selectedOriginalClass);
            setFlowTarget(slot);
            setFlowWaiting(true);
            setFlowStep(selectedOriginalClass ? 'confirm' : 'source');
        } else { setWaitlistOriginalClass(null); setShowWaitlistRequest(true); }
    }

    async function handleWaitlistRequestSubmit() {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!waitlistOriginalClass || !waitlistSlot) return;
        if (!validateStudentOriginal(waitlistOriginalClass)) return;
        if (modernStudent && (isClassWithinMinutes(waitlistSlot.date, waitlistSlot.period, 0) || isSlotLocked(waitlistSlot.day, waitlistSlot.period) || isMyHoldingDate?.(waitlistSlot.date) || wouldDoubleBookStudent(waitlistOriginalClass, waitlistSlot.day, waitlistSlot.date))) {
            alert('선택한 수업은 지금 대기를 신청할 수 없어요. 다른 시간을 선택해주세요.');
            return;
        }
        setIsSubmittingWaitlist(true);
        try {
            const phone = String(getStudentField(studentData, '핸드폰') || '').trim();
            await createMakeupWaitlist(user.username, phone, waitlistSlot, waitlistOriginalClass);
            alert(`보강 대기 신청 완료!\n자리가 나면 문자로 안내드립니다 (선착순).`);
            setShowWaitlistRequest(false);
            setWaitlistSlot(null);
            setWaitlistOriginalClass(null);
            setSelectedOriginalClass(null);
            setFlowStep(null);
            setFlowTarget(null);
            setStudentTab('mine');
            await reloadMyWaitlists();
        } catch (error) {
            alert(`대기 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    function handleWaitlistChipClick(entry) {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!validateStudentDataReady()) return;
        // 만료된 자리 안내 — 어느 경로로 클릭되든 정리 후 재신청 가능 상태로 전환
        if (entry.status === 'notified' && isNotificationExpired(entry)) {
            updateMakeupWaitlistStatus(entry.id, 'expired').catch(() => {});
            setActiveWaitlists(prev => prev.filter(w => w.id !== entry.id));
            alert('이전 자리 안내의 수락 시간이 지나 만료되었습니다.\n만석 칸을 다시 누르면 새로 대기 신청할 수 있습니다.');
            return;
        }
        if (entry.status === 'notified') {
            setRespondingWaitlist(entry);
            return;
        }
        if (entry.status === 'waiting') {
            if (confirm('이 시간의 보강 대기를 취소하시겠습니까?')) {
                updateMakeupWaitlistStatus(entry.id, 'cancelled')
                    .then(reloadMyWaitlists)
                    .catch(err => alert(`대기 취소 실패: ${err.message}`));
            }
        }
    }

    async function handleWaitlistAccept() {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!validateStudentDataReady()) return;
        const entry = respondingWaitlist;
        if (!entry || isSubmittingWaitlist) return;
        if (isNotificationExpired(entry)) {
            alert('수락 가능 시간이 지났습니다. 다음 기회에 다시 신청해주세요.');
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
            return;
        }
        // 원래 수업이 이미 시작/종료된 경우 — 출석한 수업을 보강으로 옮길 수 없음
        if (isClassWithinMinutes(entry.originalClass.date, entry.originalClass.period, 0)) {
            alert('옮기려던 원래 수업이 이미 시작되어 수락할 수 없습니다.');
            updateMakeupWaitlistStatus(entry.id, 'expired').catch(() => {});
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
            return;
        }
        if (!forceMode && myWeekMakeupHistory.length >= makeupWeeklyLimit) {
            alert(`보강은 주 ${makeupWeeklyLimit}회까지 가능합니다.\n이번 주 보강 한도를 모두 사용해 수락할 수 없습니다.`);
            return;
        }
        // 같은 원래 수업으로 이미 보강을 신청한 경우 중복 생성 방지
        const duplicateOriginal = activeMakeupRequests.some(m =>
            m.status === 'active' &&
            m.originalClass.date === entry.originalClass.date &&
            m.originalClass.day === entry.originalClass.day &&
            m.originalClass.period === entry.originalClass.period
        );
        if (duplicateOriginal) {
            alert('이 원래 수업은 이미 다른 보강으로 옮겨져 있습니다.\n대기를 거절 처리해주세요.');
            return;
        }
        // 이중 수강 방지: 다른 날 수업을 이미 정규 수업이 있는 요일로 옮기는 수락은 차단(같은 날 이동은 허용)
        if (wouldDoubleBookStudent(entry.originalClass, entry.day, entry.date)) {
            alert('그 날 이미 다른 정규 수업이 있어 수락할 수 없습니다.');
            return;
        }
        // 이번 주 시간표 범위면 여석 재확인 (그 사이 다시 만석이 됐을 수 있음)
        const expectedDate = weekDates[entry.day] ? weekDateToISO(weekDates[entry.day]) : null;
        if (expectedDate === entry.date) {
            const periodObj = PERIODS.find(p => p.id === entry.period);
            if (periodObj && getCellData(entry.day, periodObj).isFull) {
                alert('그 사이 자리가 다시 찼습니다. 자리가 나면 다시 안내드리겠습니다.');
                // notified로 두면 만석인데도 수락 프롬프트가 계속 떠 반복 실패하므로 대기 상태로 되돌림.
                await updateMakeupWaitlistStatus(entry.id, 'waiting').catch(() => {});
                setRespondingWaitlist(null);
                await reloadMyWaitlists();
                return;
            }
        }
        setIsSubmittingWaitlist(true);
        try {
            await createMakeupRequest(user.username, entry.originalClass, {
                date: entry.date, day: entry.day, period: entry.period, periodName: entry.periodName,
            });
            try {
                await acceptMakeupWaitlist(entry.id);
            } catch (statusError) {
                // 보강은 이미 확정됨 — 대기 상태 전환 실패는 치명적이지 않음 (백스톱이 정리)
                console.error('보강 대기 accepted 전환 실패 (보강은 생성됨):', entry.id, statusError);
            }
            try {
                const activeAndCompleted = await getActiveMakeupRequests(user.username);
                await syncHolidayMakeupEndDate(activeAndCompleted, entry.originalClass.date);
            } catch (endDateError) {
                console.error('보강 대기 수락 후 종료일 재계산 실패:', endDateError);
            }
            alert(`보강이 확정되었습니다!\n${entry.originalClass.day}요일 ${entry.originalClass.periodName} → ${entry.day}요일 ${entry.periodName} (${entry.date})`);
            setRespondingWaitlist(null);
            if (modernStudent) setStudentTab('mine');
            // 셋 다 서로 다른 state를 채우는 읽기 전용 리로드 → 병렬 (alert 이후 대기)
            await Promise.all([reloadMyWaitlists(), reloadStudentMakeups(), loadWeeklyData()]);
        } catch (error) {
            alert(`수락 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    async function handleWaitlistDecline() {
        if (readOnly) { alert('실데이터 조회 전용 화면에서는 신청·취소를 할 수 없습니다.'); return; }
        if (!validateStudentDataReady()) return;
        const entry = respondingWaitlist;
        if (!entry || isSubmittingWaitlist) return;
        if (isNotificationExpired(entry)) {
            alert('수락 가능 시간이 이미 지나 자동 만료되었습니다.');
            updateMakeupWaitlistStatus(entry.id, 'expired').catch(() => {});
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
            return;
        }
        if (!confirm('이 보강 자리를 거절하시겠습니까?\n다음 대기자에게 순번이 넘어갑니다.')) return;
        setIsSubmittingWaitlist(true);
        try {
            await declineMakeupWaitlist(entry.id);
            // 거절은 실제로 자리를 비우지 않으므로(거절자는 자리를 점유한 적 없음) 실제 여석 기준으로만 다음 순번 알림.
            const dPeriodObj = PERIODS.find(p => p.id === entry.period);
            const dExpectedDate = weekDates[entry.day] ? weekDateToISO(weekDates[entry.day]) : null;
            const dSeats = (dPeriodObj && dExpectedDate === entry.date)
                ? getCellData(entry.day, dPeriodObj).availableSeats
                : null;
            await onSeatFreed(entry.date, entry.day, entry.period, dSeats);
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
        } catch (error) {
            alert(`거절 처리 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    function handleCellClick(day, periodObj, cellData) {
        if (periodObj.type === 'free') return;

        if (user?.role === 'coach') {
            onCoachCellClick?.(day, periodObj.id, cellData);
            return;
        }
        if (changingMakeup && cellData.isFull) {
            alert('만석인 시간으로는 옮길 수 없어요.\n여석이 있는 칸을 선택해주세요.');
            return;
        }
        if (cellData.isFull) {
            const dateStr = weekDates[day];
            if (!dateStr) return;
            const date = weekDateToISO(dateStr);
            const myWait = myWaitlists.find(w =>
                w.date === date && w.day === day && w.period === periodObj.id &&
                (w.status === 'waiting' || w.status === 'notified')
            );
            if (myWait) {
                handleWaitlistChipClick(myWait);
                return;
            }
            openWaitlistRequest(day, periodObj.id, date);
        } else {
            const dateStr = weekDates[day];
            if (dateStr) {
                handleAvailableSeatClick(day, periodObj.id, weekDateToISO(dateStr));
            }
        }
    }

    // ── 셀 렌더 ──
    function renderStudentCell(day, periodObj) {
        const data = getCellData(day, periodObj);
        const holidayReason = getHolidayInfo(day);
        const isHoliday = holidayReason !== null;

        // Holiday cell (not for coach's "신규 전용" mode)
        if (isHoliday && user?.role !== 'coach') {
            return <HolidayCell reason={holidayReason} />;
        }

        // 셀 강조용 슬롯 단위 판정(요일+교시). 보강 신청 차단(요일 단위)과는 목적이 다름.
        const myClass = studentSchedule.some(s => s.day === day && s.period === periodObj.id);
        const cellClick = () => handleCellClick(day, periodObj, data);

        // Makeup status for this cell
        let isMakeupFrom = false;
        let isMakeupTo = false;
        let isMakeupToHeld = false;
        let isMakeupToAbsent = false;
        let isMakeupFromHeld = false;
        if (activeMakeupRequests.length > 0 && weekDates[day]) {
            const cellDate = weekDateToISO(weekDates[day]);
            const makeupFrom = activeMakeupRequests.find(m =>
                m.originalClass.date === cellDate &&
                m.originalClass.day === day &&
                m.originalClass.period === periodObj.id
            );
            const makeupTo = activeMakeupRequests.find(m =>
                m.makeupClass.date === cellDate &&
                m.makeupClass.day === day &&
                m.makeupClass.period === periodObj.id
            );
            isMakeupFrom = !!makeupFrom;
            isMakeupTo = !!makeupTo;
            if (makeupTo) {
                isMakeupToHeld = isMakeupHeld(makeupTo);
                isMakeupToAbsent = weekAbsences.some(a =>
                    a.studentName === user?.username && a.date === cellDate
                );
            }
            if (makeupFrom) isMakeupFromHeld = isMakeupHeld(makeupFrom);
        }

        // My class
        if (myClass) {
            const cellDateISO = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
            const isHoldingToday = cellDateISO ? (isMyHoldingDate?.(cellDateISO) ?? false) : false;

            if (isHoldingToday) {
                return (
                    <div
                        className="schedule-cell cell-available my-class"
                        onClick={cellClick}
                        style={{
                            borderColor: '#9ca3af',
                            borderWidth: '2px',
                            opacity: 0.7,
                            background: 'var(--canvas-tint)'
                        }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}>홀딩</span>
                        </div>
                    </div>
                );
            }

            // 보강이 홀딩된 경우: 원래 수업은 다시 정상 (보강이동이 아님)
            const showMakeupMoved = isMakeupFrom && !isMakeupFromHeld;
            return (
                <div
                    className={`schedule-cell cell-available my-class ${showMakeupMoved ? 'makeup-moved' : ''}`}
                    onClick={cellClick}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        {showMakeupMoved ? (
                            <span className="my-class-badge" style={{ backgroundColor: '#FAEAC2', color: '#92400e' }}>보강이동</span>
                        ) : (
                            <span className="my-class-badge">MY</span>
                        )}
                    </div>
                </div>
            );
        }

        // 보강 대기 칩 (만석 슬롯에서 대기중/보강승인중 표시)
        const waitCellDate = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
        const myWaitHere = waitCellDate ? myWaitlists.find(w =>
            w.date === waitCellDate && w.day === day && w.period === periodObj.id &&
            (w.status === 'waiting' || (w.status === 'notified' && !isNotificationExpired(w)))
        ) : null;
        if (myWaitHere && !myClass) {
            const isNotified = myWaitHere.status === 'notified';
            const seatWaitCount = getSeatWaitCount(waitCellDate, day, periodObj.id);
            return (
                <div
                    className="schedule-cell cell-available"
                    onClick={() => handleWaitlistChipClick(myWaitHere)}
                    style={isNotified
                        ? { borderColor: 'var(--accent)', borderWidth: '2px', backgroundColor: 'var(--accent-10)' }
                        : { borderColor: '#EDBC40', borderWidth: '2px', backgroundColor: '#EDBC401A' }}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        <span className="my-class-badge" style={isNotified
                            ? { backgroundColor: 'var(--accent)', color: '#fff', fontSize: '0.65rem' }
                            : { backgroundColor: '#EDBC40', color: '#5c4a0e', fontSize: '0.7rem' }}>
                            {isNotified ? '보강승인중' : '대기중'}
                        </span>
                        {seatWaitCount > 0 && (
                            <span style={{ fontSize: '0.65rem', color: '#9a7a12', fontWeight: 700, marginTop: '2px' }}>
                                대기 {seatWaitCount}명
                            </span>
                        )}
                    </div>
                </div>
            );
        }

        // Makeup TO cell
        if (isMakeupTo) {
            if (isMakeupToAbsent) {
                return (
                    <div
                        className="schedule-cell cell-available makeup-absent"
                        onClick={cellClick}
                        style={{ borderColor: '#E94E58', borderWidth: '2px' }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: '#F8D2D5', color: '#991b1b' }}>보강결석</span>
                        </div>
                    </div>
                );
            }
            if (isMakeupToHeld) {
                return (
                    <div
                        className="schedule-cell cell-available"
                        onClick={cellClick}
                        style={{ borderColor: '#9ca3af', borderWidth: '2px', opacity: 0.7 }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.65rem' }}>보강홀딩</span>
                        </div>
                    </div>
                );
            }
            return (
                <div
                    className="schedule-cell cell-available makeup-class"
                    onClick={cellClick}
                    style={{ borderColor: '#327AB8', borderWidth: '2px' }}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        <span className="my-class-badge" style={{ backgroundColor: '#327AB8', color: '#fff' }}>보강</span>
                    </div>
                </div>
            );
        }

        // Disabled class
        if (isClassDisabled(day, periodObj.id)) {
            return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
        }

        // Locked slot
        if (isSlotLocked(day, periodObj.id)) {
            return (
                <div className="schedule-cell" style={{ backgroundColor: '#E94E581A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '1.2rem' }}>🔒</span>
                    <span style={{ color: '#E94E58', fontSize: '0.8rem', fontWeight: 'bold', marginTop: '2px' }}>보강 불가</span>
                </div>
            );
        }

        // Empty or all-on-hold: show available seats
        if (!data.studentNames.length || (data.currentCount === 0 && data.studentNames.length > 0)) {
            return <AvailableSeatsCell seats={data.availableSeats} onClick={cellClick} />;
        }

        // Full
        if (data.isFull) {
            const waitCount = getWaitlistCountForSlot(day, periodObj.id, weekWaitlist, newStudentWaitlist);
            const seatWaitCount = getSeatWaitCount(waitCellDate, day, periodObj.id);
            return (
                <div className="schedule-cell cell-full" onClick={cellClick}>
                    <span className="cell-full-text">Full</span>
                    <span style={{ fontSize: '0.8em' }}>(만석)</span>
                    {waitCount > 0 && user?.role === 'coach' && (
                        <span style={{ fontSize: '0.7em', color: '#fff', fontWeight: 'bold' }}>대기 {waitCount}명</span>
                    )}
                    {isRealStudent && seatWaitCount > 0 && (
                        <span style={{ fontSize: '0.7em', color: '#fff', fontWeight: 'bold' }}>보강 대기 {seatWaitCount}명</span>
                    )}
                </div>
            );
        }

        // Available seats
        return <AvailableSeatsCell seats={data.availableSeats} onClick={cellClick} />;
    }

    function renderCell(day, periodObj) {
        if (periodObj.type === 'free') {
            const dISO = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
            const names = (dISO && freeWorkoutByDate[dISO]) || [];
            // ponytail: 출석자 명단·추가는 코치 전용 뷰(CoachSchedule)에서만. 여기선 본인 출석만 표시
            const attended = names.some(n => n.studentName === user?.username);
            return (
                <div className="schedule-cell cell-free" style={{ flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '0.72rem', color: '#9a7a12', fontWeight: 700 }}>자율 운동</div>
                    {attended && (
                        <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: '8px',
                            background: '#166534', color: '#fff', border: '1px solid #0f4424',
                            fontSize: '0.72rem', fontWeight: 700,
                        }}>출석</span>
                    )}
                </div>
            );
        }
        return renderStudentCell(day, periodObj);
    }

    function renderModernGrid() {
        return <div className="student-class-grid" aria-label="이번 주 보강 가능한 시간표">
            <span className="student-class-grid-heading-cell">시간</span>{days.map(item => <div className="student-class-grid-heading-cell" key={item.date}>{item.day}<br />{item.dateNumber}</div>)}
            {PERIODS.map(period => <Fragment key={period.id}><div className="student-class-grid-time"><strong>{period.id}교시</strong>{period.type === 'free' && <span>(자율)</span>}<span>{period.time.split(' ~ ')[0]}</span><span>~ {period.time.split(' ~ ')[1]}</span></div>{days.map(({ day, date }) => {
                const data = getCellData(day, period);
                const slot = { date, day, period: period.id };
                const existingWait = validWaits.find(item => item.date === date && Number(item.period) === period.id);
                const session = personalSessions.find(item => item.date === date && item.period === period.id);
                const source = changingMakeup?.originalClass || selectedOriginalClass;
                const otherMakeups = changingMakeup ? activeMakeupRequests.filter(item => item.id !== changingMakeup.id) : activeMakeupRequests;
                let reason = '';
                let label = data.isFull ? '대기' : `${data.availableSeats}자리`;
                if (period.type === 'free') reason = label = '자율 운동';
                else if (getHolidayInfo(day) !== null) reason = label = '휴일';
                else if (isClassDisabled(day, period.id)) reason = label = '수업 없음';
                else if (isSlotLocked(day, period.id)) reason = label = '신청 불가';
                else if (isMyHoldingDate?.(date)) reason = label = '홀딩';
                else if (classStartMs(slot) - now.getTime() <= (data.isFull ? 0 : 120 * 60 * 1000)) reason = label = '마감';
                else if (session && ['regular', 'makeup'].includes(session.type)) reason = label = session.type === 'makeup' ? '내 보강' : '내 수업';
                else if (source && wouldDoubleBookStudent(source, day, date, otherMakeups)) reason = label = '선택 불가';
                else if (myWeekCommitments >= makeupWeeklyLimit) reason = '이번 주 보강·대기 한도를 모두 사용했어요.';
                if (existingWait) { reason = ''; label = existingWait.status === 'notified' ? '자리 도착' : '대기 중'; }
                return <StudentMakeupSlot key={date} session={session} now={now} label={label} reason={reason}
                    isFull={data.isFull} existingWait={existingWait}
                    disabled={Boolean(reason) || isSubmittingMakeup || isSubmittingWaitlist}
                    ariaLabel={`${classLabel(slot)} ${label}${reason && reason !== label ? ` · ${reason}` : ''}`}
                    onClick={() => existingWait ? handleWaitlistChipClick(existingWait) : handleCellClick(day, period, data)} />;
            })}</Fragment>)}
        </div>;
    }

    const flowSourceSession = personalSessions.find(item => item.date === selectedOriginalClass?.date && item.period === selectedOriginalClass?.period);
    const flowSourceError = studentRequestDataError || (flowSourceSession ? sourceUnavailableReason(flowSourceSession, { now, quotaUsed: myWeekCommitments, quotaLimit: makeupWeeklyLimit, waits: validWaits }) : '옮길 수업을 선택해주세요.');
    const flowDoubleBooking = selectedOriginalClass && flowTarget && wouldDoubleBookStudent(selectedOriginalClass, flowTarget.day, flowTarget.date);
    const sameFlowSlot = selectedOriginalClass?.date === flowTarget?.date && selectedOriginalClass?.period === flowTarget?.period;
    const flowTargetError = flowDoubleBooking ? '이날 이미 다른 수업이 있어요. 다른 시간을 선택해주세요.' : sameFlowSlot ? '원래 수업과 다른 시간을 선택해주세요.' : '';
    const personalLoading = !weeklyDataLoaded || makeupDataState === 'loading';
    const personalError = !studentData ? '수강 정보를 찾을 수 없어요. 등록 상태를 코치에게 확인해주세요.' : weeklyDataError || (makeupDataState === 'error' ? '보강 정보를 불러오지 못했어요.' : '');

    return (
        <>
            {modernStudent && <StudentClassView
                readOnly={readOnly}
                days={days} sessions={personalSessions} now={now} tab={studentTab} onTabChange={changeStudentTab}
                loading={personalLoading} error={personalError} onRetry={retryStudentData}
                membership={membership} source={changingMakeup?.originalClass || selectedOriginalClass} quotaUsed={myWeekCommitments} quotaLimit={makeupWeeklyLimit}
                waits={validWaits} onWaitlist={handleWaitlistChipClick} onSourceChoose={() => { if (changingMakeup) return; setFlowTarget(null); setFlowStep('source'); }}
                onMakeup={startStudentMakeup} onCancelMakeup={handleMakeupCancel} onNavigate={onNavigate}
            >
                {changingMakeup && <div className="student-class-notice"><strong>보강 시간 변경 중</strong><p>원래 수업이 만석이에요. 다른 빈자리를 선택해주세요.</p><button type="button" className="student-class-link" onClick={() => setChangingMakeup(null)}>변경 그만두기</button></div>}
                {renderModernGrid()}
            </StudentClassView>}
            {!modernStudent && <>
            {/* Student usage guide */}
            {isRealStudent && !forceMode && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#329BE71A',
                    border: '1px solid #329BE74D',
                    fontSize: '0.82rem',
                    color: '#327AB8',
                    lineHeight: '1.6'
                }}>
                    <strong>이용 안내</strong>
                    <div style={{ marginTop: '4px' }}>
                        · 여석이 있는 칸을 눌러 <strong>보강 신청</strong>할 수 있습니다 (1회성 수업 이동)<br/>
                        · 만석(Full) 칸을 누르면 <strong>보강 대기</strong>를 신청할 수 있습니다 — 자리가 나면 문자로 안내드립니다<br/>
                        · 시간표 변경은 코치에게 문의해주세요
                    </div>
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #329BE74D' }}>
                        <strong>📌 보강 신청 조건</strong>
                        <div style={{ marginTop: '4px' }}>
                            · 원래 수업과 보강 대상 수업 모두 시작 <strong>2시간 전</strong>까지 신청 가능<br/>
                            · 주 수강 횟수만큼 당주 보강 신청 가능 <strong>(주2회=2회, 주3회=3회, 주4회=4회)</strong>
                        </div>
                    </div>
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #329BE74D' }}>
                        <strong>📌 보강 취소 조건</strong>
                        <div style={{ marginTop: '4px' }}>
                            · 보강 수업 시작 <strong>1시간 전</strong>까지 취소 가능<br/>
                            · <strong>취소해도 이번 주 보강 횟수는 복구되지 않습니다</strong> (취소한 신청도 1회로 계산)<br/>
                            · 남은 횟수가 있으면 다른 시간으로 다시 신청할 수 있어요 (이번 주 {myWeekCommitments}/{makeupWeeklyLimit}회 사용)
                        </div>
                    </div>
                </div>
            )}

            {/* 보강 시간 변경 모드 — 원래 수업이 만석이라 '그냥 취소'가 불가능한 경우 */}
            {isRealStudent && changingMakeup && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '12px 14px',
                    borderRadius: 'var(--r-md)',
                    backgroundColor: 'var(--accent-10)',
                    border: '1px solid var(--accent-30)',
                    color: '#327AB8',
                    fontSize: '0.85rem',
                    lineHeight: '1.6',
                }}>
                    <strong>보강 시간 변경 중</strong>
                    <div style={{ marginTop: '4px' }}>
                        원래 수업({changingMakeup.originalClass.day}요일 {changingMakeup.originalClass.periodName})이 만석이라
                        그냥 돌아갈 수 없어요.<br />
                        <strong>여석이 있는 칸</strong>을 눌러 옮길 시간을 선택해주세요.
                    </div>
                    <button
                        onClick={() => setChangingMakeup(null)}
                        style={{
                            marginTop: '8px', padding: '6px 14px', borderRadius: 'var(--r-chip)',
                            border: '1px solid var(--hairline)', background: 'var(--canvas)',
                            color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                        }}
                    >
                        그만두기
                    </button>
                </div>
            )}

            {/* Active makeup banners (시간표 위에 노출하여 취소 버튼을 쉽게 찾도록) */}
            {isRealStudent && activeMakeupRequests.length > 0 && (
                <div className="active-makeup-banner">
                    <div className="banner-header" style={{ marginBottom: '8px', fontSize: '0.9rem', color: 'rgba(0,0,0,0.6)' }}>
                        🔄 이번 주 보강 ({activeMakeupRequests.length}/{makeupWeeklyLimit}개)
                    </div>
                    {activeMakeupRequests.map((makeup, index) => {
                        const held = isMakeupHeld(makeup);
                        return (
                            <div key={makeup.id} className="banner-content" style={{
                                marginBottom: index < activeMakeupRequests.length - 1 ? '8px' : '0',
                                ...(held ? { background: '#A7A7AA' } : {})
                            }}>
                                <div className="banner-text" style={{ whiteSpace: 'normal' }}>
                                    {makeup.originalClass.day}요일 {makeup.originalClass.periodName} → {makeup.makeupClass.day}요일 {makeup.makeupClass.periodName}
                                    {held && <span style={{ marginLeft: '6px', fontWeight: 700 }}>홀딩</span>}
                                    {!held && makeup.status === 'completed' && <span style={{ marginLeft: '6px', color: '#2a8f46', fontWeight: 700 }}>완료</span>}
                                </div>
                                {!held && makeup.status === 'active' && (forceMode || !isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 60)) && (
                                    <button className="banner-cancel-btn" onClick={() => handleMakeupCancel(makeup.id)}>취소</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Schedule grid */}
            <div className="schedule-grid">
                <div className="grid-header"></div>
                {DAYS.map(day => (
                    <div key={day} className="grid-header">
                        {day} ({weekDates[day]})
                    </div>
                ))}

                {PERIODS.map(period => (
                    <>
                        <div className="time-header">
                            <div className="period-name">{period.name}</div>
                            <div className="period-time">{period.time}</div>
                        </div>
                        {DAYS.map(day => (
                            <div key={`${day}-${period.id}`} style={{ display: 'contents' }}>
                                {renderCell(day, period)}
                            </div>
                        ))}
                    </>
                ))}
            </div>

            {/* Legend */}
            <div className="legend">
                {isRealStudent ? (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#E94E58' }}></span> 만석 (대기 가능)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#EDBC40' }}></span> 자율 운동</div>
                    </>
                ) : (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 여석 있음 (클릭: 시간표 이동)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#E94E58' }}></span> 만석 (클릭: 대기 등록)</div>
                    </>
                )}
            </div>

            </>}

            {modernStudent && flowStep && <ReviewModal title={flowStep === 'source' ? '옮길 수업 선택' : flowWaiting ? '보강 대기 확인' : '보강 신청 확인'} busy={isSubmittingMakeup || isSubmittingWaitlist} onClose={closeStudentFlow}>
                <div className="student-class-modal">
                    {flowStep === 'source' ? <>
                        <p className="student-class-help">이번 주 내 수업 중 옮길 수업을 선택하세요.</p>
                        {personalSessions.filter(item => ['regular', 'holiday'].includes(item.type)).map(session => {
                            const error = studentRequestDataError || sourceUnavailableReason(session, { now, quotaUsed: myWeekCommitments, quotaLimit: makeupWeeklyLimit, waits: validWaits });
                            return <button type="button" key={`${session.date}-${session.period}`} className="student-class-choice" disabled={Boolean(error)} aria-pressed={selectedOriginalClass?.date === session.date && selectedOriginalClass?.period === session.period} onClick={() => chooseOriginal(session)}><strong>{classLabel(session)}</strong><small>{error || (session.type === 'holiday' ? '휴일 수업 · 보강 시 종료일이 앞당겨질 수 있어요.' : '정규 수업')}</small></button>;
                        })}
                        {!personalSessions.some(item => ['regular', 'holiday'].includes(item.type)) && <p className="student-class-help">이 주에는 옮길 수 있는 정규 수업이 없어요.</p>}
                        <div className="student-class-actions"><button type="button" className="student-class-button primary" disabled={Boolean(flowSourceError)} onClick={() => { setStudentTab('all'); setFlowStep(flowTarget ? 'confirm' : null); }}>보강 시간 선택</button></div>
                    </> : <>
                        <div className="student-class-route"><div><span>원래 수업</span><strong>{classLabel(selectedOriginalClass)}</strong></div><span aria-hidden="true">↓</span><div><span>{flowWaiting ? '대기할 수업' : '보강 수업'}</span><strong>{classLabel(flowTarget)}</strong></div></div>
                        <p className="student-class-help">{flowWaiting ? '자리를 수락하기 전까지 원래 수업은 유지돼요.' : '확정하면 원래 수업 대신 선택한 시간에 참석해요.'}</p>
                        {flowSourceSession?.type === 'holiday' && <p className="student-class-notice">휴일 수업을 미리 수강하면 수강 종료일이 앞당겨질 수 있어요.</p>}
                        <p className="student-class-help">신청 후 이번 주 보강·대기 {myWeekCommitments + 1}/{makeupWeeklyLimit}회<br />{flowWaiting ? '대기를 취소하면 대기 한도는 돌아와요.' : '보강을 취소해도 사용 횟수는 돌아오지 않아요.'}</p>
                        {(flowSourceError || flowTargetError) && <p className="student-class-notice" role="alert">{flowSourceError || flowTargetError}</p>}
                        <div className="student-class-actions"><button type="button" className="student-class-button" disabled={isSubmittingMakeup || isSubmittingWaitlist} onClick={closeStudentFlow}>다른 시간 선택</button><button type="button" className="student-class-button primary" disabled={readOnly || Boolean(flowSourceError || flowTargetError) || isSubmittingMakeup || isSubmittingWaitlist} onClick={flowWaiting ? handleWaitlistRequestSubmit : handleMakeupSubmit}>{readOnly ? '실데이터 조회 전용' : isSubmittingMakeup || isSubmittingWaitlist ? '신청 중…' : flowWaiting ? '대기 신청' : '보강 확정'}</button></div>
                    </>}
                </div>
            </ReviewModal>}

            {/* Makeup Request Modal (real student only) */}
            {showMakeupModal && isRealStudent && selectedMakeupSlot && (
                <MakeupModal
                    selectedMakeupSlot={selectedMakeupSlot}
                    selectedOriginalClass={selectedOriginalClass}
                    setSelectedOriginalClass={setSelectedOriginalClass}
                    studentSchedule={studentSchedule}
                    weekDates={weekDates}
                    activeMakeupRequests={activeMakeupRequests}
                    isSubmittingMakeup={isSubmittingMakeup}
                    getHolidayInfo={getHolidayInfo}
                    isMyHoldingDate={isMyHoldingDate}
                    forceMode={forceMode}
                    onSubmit={handleMakeupSubmit}
                    onClose={() => {
                        setShowMakeupModal(false);
                        setSelectedMakeupSlot(null);
                        setSelectedOriginalClass(null);
                    }}
                />
            )}

            {/* 보강 대기 신청 모달 (만석 슬롯) — MakeupModal 재사용 */}
            {showWaitlistRequest && isRealStudent && waitlistSlot && (
                <MakeupModal
                    title="보강 대기 신청"
                    submitLabel="대기 신청"
                    submittingLabel="신청 중..."
                    selectedMakeupSlot={waitlistSlot}
                    selectedOriginalClass={waitlistOriginalClass}
                    setSelectedOriginalClass={setWaitlistOriginalClass}
                    studentSchedule={studentSchedule}
                    weekDates={weekDates}
                    activeMakeupRequests={activeMakeupRequests}
                    isSubmittingMakeup={isSubmittingWaitlist}
                    getHolidayInfo={getHolidayInfo}
                    isMyHoldingDate={isMyHoldingDate}
                    forceMode={forceMode}
                    onSubmit={handleWaitlistRequestSubmit}
                    onClose={() => {
                        setShowWaitlistRequest(false);
                        setWaitlistSlot(null);
                        setWaitlistOriginalClass(null);
                    }}
                />
            )}

            {/* 보강 대기 수락/거절 모달 */}
            {respondingWaitlist && modernStudent && <ReviewModal title="기다리던 자리 확인" busy={isSubmittingWaitlist} onClose={() => { if (!isSubmittingWaitlist) setRespondingWaitlist(null); }}>
                <div className="student-class-modal">
                    <div className="student-class-route"><div><span>원래 수업</span><strong>{classLabel(respondingWaitlist.originalClass)}</strong></div><span aria-hidden="true">↓</span><div><span>수락할 보강 수업</span><strong>{classLabel(respondingWaitlist)}</strong></div></div>
                    <p className="student-class-help">수락하기 전까지 원래 수업은 유지돼요. 수락하면 선택한 보강 시간으로 이동해요.</p>
                    <p className="student-class-notice">{getNotificationDeadline(respondingWaitlist)?.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}까지 수락할 수 있어요.</p>
                    {studentRequestDataError && <p className="student-class-notice" role="alert">{studentRequestDataError}</p>}
                    <div className="student-class-actions"><button type="button" className="student-class-button" disabled={readOnly || Boolean(studentRequestDataError) || isSubmittingWaitlist} onClick={handleWaitlistDecline}>이번에는 거절</button><button type="button" className="student-class-button primary" disabled={readOnly || Boolean(studentRequestDataError) || isSubmittingWaitlist || isNotificationExpired(respondingWaitlist, now)} onClick={handleWaitlistAccept}>{isSubmittingWaitlist ? '처리 중…' : '자리 수락'}</button></div>
                </div>
            </ReviewModal>}
            {respondingWaitlist && isRealStudent && !modernStudent && (
                <MakeupWaitlistResponseModal
                    entry={respondingWaitlist}
                    isSubmitting={isSubmittingWaitlist}
                    onAccept={handleWaitlistAccept}
                    onDecline={handleWaitlistDecline}
                    onClose={() => setRespondingWaitlist(null)}
                />
            )}

        </>
    );
}
