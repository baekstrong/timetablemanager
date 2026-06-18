import { useState, useMemo, useEffect } from 'react';
import { PERIODS, DAYS, MAX_CAPACITY } from '../../data/mockData';
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
import { isNotificationExpired } from '../../utils/makeupWaitlist';
import { processHolidayMakeupEndDate, getStudentField } from '../../services/googleSheetsService';
import {
    weekDateToISO,
    isClassWithinMinutes,
    getThisWeekRange,
    getWaitlistCountForSlot,
} from '../../utils/scheduleUtils';
import { getMakeupWeeklyLimit } from '../../utils/makeupQuota';
import MakeupModal from './MakeupModal';
import MakeupWaitlistResponseModal from './MakeupWaitlistModal';
import { StudentTag, AvailableSeatsCell, HolidayCell } from './ScheduleCell';

/**
 * 학생 모드(mode === 'student') 화면 전체를 렌더.
 * 실제 학생(user.role === 'student')과 코치의 "신규 전용" 뷰(user.role === 'coach' && mode === 'student') 모두 처리.
 *
 * 코치의 신규 전용 뷰에서의 셀 클릭(만석/여석 → 대기/직접 이동)은 부모의 CoachWaitlistModal에 위임하기 위해
 * onCoachCellClick 콜백으로 올려보낸다.
 */
export default function StudentSchedule({
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
    // 코치 "수강생 전용(강제)" 모드 — 시간 데드라인/주 1회/홀딩 제약 우회
    forceMode = false,
}) {
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
        if (user?.role === 'coach') return;

        async function loadStudentMakeupData() {
            try {
                // 지난 보강 자동 완료 처리 (active → completed)
                const activeAndCompleted = await getActiveMakeupRequests(user.username);
                for (const m of activeAndCompleted) {
                    if (m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0)) {
                        try {
                            await completeMakeupRequest(m.id);
                            m.status = 'completed';
                        } catch (err) {
                            console.error('수강생 보강 자동 완료 실패:', m.id, err);
                        }
                    }
                }

                const { start, end } = getThisWeekRange();
                const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
                setMyWeekMakeupHistory(thisWeekMakeups);
                await reloadMyWaitlists();
            } catch (error) {
                console.error('Failed to load student makeup data:', error);
            }
        }
        loadStudentMakeupData();
    }, [user]);

    // ── 헬퍼 ──
    function isMyClass(day, periodId) {
        return studentSchedule.some(s => s.day === day && s.period === periodId);
    }

    async function reloadStudentMakeups() {
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
        setMyWeekMakeupHistory(thisWeekMakeups);
    }

    // ── 핸들러 ──
    function handleAvailableSeatClick(day, periodId, date) {
        if (user?.role === 'coach') return;

        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // 본인이 이 날짜 홀딩 중이면 보강 관련 클릭 전부 차단 (강제 모드에선 우회)
        if (!forceMode && isMyHoldingDate?.(date)) {
            alert('홀딩 기간 중에는 보강 신청을 할 수 없습니다.\n홀딩이 끝난 뒤 신청해주세요.');
            return;
        }

        // 주 수강 횟수만큼 당주 보강 신청 가능 (취소 내역도 소진으로 간주)
        if (!forceMode && myWeekMakeupHistory.length >= makeupWeeklyLimit) {
            alert(`보강은 주 ${makeupWeeklyLimit}회까지 신청 가능합니다.\n이번 주 보강 신청 내역(취소 포함)이 있어 추가 신청이 불가합니다.`);
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

        if (isMyClass(day, periodId)) {
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
        setSelectedMakeupSlot({ day, period: periodId, periodName: period.name, date });
        setShowMakeupModal(true);
    }

    async function handleMakeupSubmit() {
        if (!selectedOriginalClass || !selectedMakeupSlot) return;

        if (selectedOriginalClass.day === selectedMakeupSlot.day &&
            selectedOriginalClass.period === selectedMakeupSlot.period &&
            selectedOriginalClass.date === selectedMakeupSlot.date) {
            alert('같은 수업으로 보강 신청할 수 없습니다.\n다른 시간을 선택해주세요.');
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
    }

    async function handleMakeupCancel(makeupId) {
        if (!makeupId) return;
        const makeup = activeMakeupRequests.find(m => m.id === makeupId);
        if (!forceMode && makeup && isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 60)) {
            alert('보강 수업 시작 1시간 전부터는 보강 취소가 불가합니다.');
            return;
        }
        if (!confirm('이 보강 신청을 취소하시겠습니까?')) return;
        try {
            await cancelMakeupRequest(makeupId);

            // 보강 취소로 빠진 자리 → 대기자 알림
            if (makeup) {
                try {
                    await onSeatFreed(makeup.makeupClass.date, makeup.makeupClass.day, makeup.makeupClass.period);
                } catch (e) {
                    console.error('보강 대기 알림 트리거 실패:', e);
                }
            }

            alert('보강 신청이 취소되었습니다.');
            await reloadStudentMakeups();
            await loadWeeklyData();
        } catch (error) {
            alert(`보강 신청 취소 실패: ${error.message}`);
        }
    }

    // ── 보강 대기 핸들러 ──
    function openWaitlistRequest(day, periodId, date) {
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
        if (isMyClass(day, periodId)) {
            alert('본인의 정규 수업 시간에는 대기 신청을 할 수 없습니다.');
            return;
        }
        const period = PERIODS.find(p => p.id === periodId);
        if (!confirm(`이 시간은 현재 만석입니다.\n${day}요일 ${period?.name}에 보강 대기를 신청하시겠습니까?\n자리가 나면 선착순으로 문자 안내를 드립니다.`)) return;
        setWaitlistSlot({ day, period: periodId, periodName: period?.name || '', date });
        setWaitlistOriginalClass(null);
        setShowWaitlistRequest(true);
    }

    async function handleWaitlistRequestSubmit() {
        if (!waitlistOriginalClass || !waitlistSlot) return;
        setIsSubmittingWaitlist(true);
        try {
            const phone = String(getStudentField(studentData, '핸드폰') || '').trim();
            await createMakeupWaitlist(user.username, phone, waitlistSlot, waitlistOriginalClass);
            alert(`보강 대기 신청 완료!\n자리가 나면 문자로 안내드립니다 (선착순).`);
            setShowWaitlistRequest(false);
            setWaitlistSlot(null);
            setWaitlistOriginalClass(null);
            await reloadMyWaitlists();
        } catch (error) {
            alert(`대기 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    function handleWaitlistChipClick(entry) {
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
        const entry = respondingWaitlist;
        if (!entry) return;
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
            await reloadMyWaitlists();
            await reloadStudentMakeups();
            await loadWeeklyData();
        } catch (error) {
            alert(`수락 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    async function handleWaitlistDecline() {
        const entry = respondingWaitlist;
        if (!entry) return;
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

        const myClass = isMyClass(day, periodObj.id);
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
            return <div className="schedule-cell cell-free">자율 운동</div>;
        }
        return renderStudentCell(day, periodObj);
    }

    // ── Render ──
    const isRealStudent = user?.role !== 'coach';

    return (
        <>
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
                            · <strong>취소 시 이번 주 보강은 사용한 것으로 간주</strong>되어 재신청이 불가합니다
                        </div>
                    </div>
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
                                {!held && makeup.status === 'active' && (forceMode || !isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 30)) && (
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
            {respondingWaitlist && isRealStudent && (
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
