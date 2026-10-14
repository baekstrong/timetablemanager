import ScheduleTransferPanel from './schedule/ScheduleTransferPanel';
import CoachHome from '../features/today/CoachHome';
import PageLoading from './PageLoading';
import RefreshStatus from './RefreshStatus';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
    getDisabledClasses,
    getLockedSlots,
    getNewStudentRegistrations,
    createWaitlistRequest,
    cancelWaitlistRequest,
    checkWaitlistAvailability,
    updateWaitlistAvailability,
    getActiveMakeupWaitlists,
    removeFreeWorkout,
    addFreeWorkoutRosterMember,
    removeFreeWorkoutRosterMember,
} from '../services/firebaseService';
import { processScheduleTransfer } from '../services/googleSheetsService';
import { getHolidays } from '../services/firebaseService';
import { PERIODS, MAX_CAPACITY } from '../data/mockData';
import GoogleSheetsSync from './GoogleSheetsSync';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import FreeWorkoutModal from './schedule/FreeWorkoutModal';
import CoachSchedule from './schedule/CoachSchedule';
import StudentSchedule from './schedule/StudentSchedule';
import NoticeTicker from './board/NoticeTicker';
import StudentGrowthHeader from './StudentGrowthHeader';
import MonthlyPRBanner from './MonthlyPRBanner';
import { useScheduleCore } from './schedule/useScheduleCore';
import { buildUpdatedSchedule, parseSheetDate, weekDateToISO } from '../utils/scheduleUtils';
import { syncMakeupWaitlists, normalizeWaitlistEntry } from '../services/makeupWaitlistService';
import './WeeklySchedule.css';

const WeeklySchedule = ({ user, studentData, studentGrowth, pushReadOnly = false, isStudentDataLoading = false, onStudentDataRefresh, onNavigate, hasContractNotification = false, studentTransfers = null, onStudentTransferUpdate, view = 'schedule', hasNewPostNotification = false }) => {
    const [mode, setMode] = useState(user?.role === 'coach' ? 'coach' : 'student');
    // 시간표 탭의 선택은 보존하되 코치 홈은 항상 코치의 출석·여석 기준으로 계산한다.
    const activeMode = user?.role === 'coach' && view !== 'schedule' ? 'coach' : mode;
    const { students, isAuthenticated, isConnected, error: sheetsError, loading, refresh } = useGoogleSheets();

    // Pending new student registrations (선언 위치: useScheduleCore에 전달 필요)
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // 코치 "수강생 전용" 강제 모드: 코치가 특정 수강생으로 빙의해 보강 신청/취소를 데드라인 없이 처리
    const [forceModeStudent, setForceModeStudent] = useState('');

    // 강제 모드 후보(수강생) 목록: 시간표가 있는 등록행을 이름 기준으로 중복 제거
    const studentForceCandidates = useMemo(() => {
        if (!students || students.length === 0) return [];
        const seen = new Set();
        const list = [];
        for (const s of students) {
            const name = s['이름'];
            if (!name || !(s['요일 및 시간'] || '').trim()) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            list.push(name);
        }
        return list.sort((a, b) => a.localeCompare(b, 'ko'));
    }, [students]);

    // 빙의 대상 수강생의 등록행 — 오늘 날짜가 수강 기간 내인 행을 우선 선택
    const forceModeStudentData = useMemo(() => {
        if (activeMode !== 'studentForce' || !forceModeStudent || !students) return null;
        const matches = students.filter(s => s['이름'] === forceModeStudent && (s['요일 및 시간'] || '').trim());
        if (matches.length === 0) return null;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const active = matches.find(s => {
            const start = parseSheetDate(s['시작날짜']);
            const end = parseSheetDate(s['종료날짜']);
            if (!start || !end) return false;
            return start.getTime() <= now.getTime() && now.getTime() <= end.getTime();
        });
        return active || matches[0];
    }, [activeMode, forceModeStudent, students]);

    const isForceMode = activeMode === 'studentForce' && !!forceModeStudent && !!forceModeStudentData;

    // useScheduleCore에 넘길 effective user/studentData — 강제 모드일 때는 빙의 대상으로 치환
    const effectiveUser = useMemo(() => {
        if (isForceMode) return { username: forceModeStudent, role: 'student' };
        return user;
    }, [isForceMode, forceModeStudent, user]);
    const effectiveStudentData = isForceMode ? forceModeStudentData : studentData;
    // 개별 수강권 조회가 성공해도 전체 명단이 없으면 보강 여석을 판단할 수 없다.
    const studentRosterError = user?.role !== 'coach'
        ? sheetsError ? '최신 수강생 명단을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.'
            : !loading && !students?.length ? '수강생 명단을 확인할 수 없습니다. 새로고침 후 다시 확인해주세요.' : ''
        : '';

    // 코치/학생 공통 파생 데이터 + useWeeklyData 래핑
    const scheduleCore = useScheduleCore({ user: effectiveUser, students, mode: activeMode, studentData: effectiveStudentData, refresh, pendingRegistrations });
    const {
        weekAbsences,
        weekWaitlist, setWeekWaitlist,
        loadWeeklyData,
        studentSchedule, scheduleData, newStudentSlotOccupancy, weekDates,
        isMyHoldingDate,
        isMakeupHeld,
        delayedReregistrationStudents, lastClassByName,
        getCellData, getHolidayInfo,
        weekHoldings, weekHolidays, getEffectiveEndDate, unpaidStudentNames, weeklyDataLoaded, weeklyDataError, weekFreeWorkout, freeWorkoutRoster,
    } = scheduleCore;

    // App의 기존 학생 알림 조회 결과를 공유한다(화면 복귀·15분 간격).
    useEffect(() => {
        if (user?.role !== 'coach' && studentTransfers !== null) {
            setWeekWaitlist(studentTransfers);
        }
    }, [user?.role, studentTransfers, setWeekWaitlist]);

    const updateTransfer = (id, status) => {
        setWeekWaitlist(previous => ['waiting', 'notified'].includes(status)
            ? previous.map(item => item.id === id ? { ...item, status } : item)
            : previous.filter(item => item.id !== id));
        if (user?.role !== 'coach') onStudentTransferUpdate?.(id, status);
    };

    const homeLoaded = useRef(false);
    useEffect(() => { if (weeklyDataLoaded) homeLoaded.current = true; }, [weeklyDataLoaded]);

    // 자율운동 표시: 날짜(YYYY-MM-DD) → [{id, studentName, roster?}]
    // 날짜별 출석(weekFreeWorkout) + 요일 고정 명단(freeWorkoutRoster)을 머지(이름 중복 제거).
    const freeWorkoutByDate = useMemo(() => {
        const map = {};
        (weekFreeWorkout || []).forEach(e => {
            if (!map[e.date]) map[e.date] = [];
            map[e.date].push({ id: e.id, studentName: e.studentName });
        });
        // 고정 명단을 해당 요일의 이번 주 날짜 셀에 머지
        (freeWorkoutRoster || []).forEach(r => {
            const d = weekDates[r.day] ? weekDateToISO(weekDates[r.day]) : null;
            if (!d) return;
            if (!map[d]) map[d] = [];
            if (!map[d].some(a => a.studentName === r.studentName)) {
                map[d].push({ id: r.id, studentName: r.studentName, roster: true });
            }
        });
        return map;
    }, [weekFreeWorkout, freeWorkoutRoster, weekDates]);

    const [freeSlot, setFreeSlot] = useState(null);   // 자율운동 관리 대상 { day, date }
    const [freeProcessing, setFreeProcessing] = useState(false);
    const [sheetsExpanded, setSheetsExpanded] = useState(false); // 구글 시트 연동 섹션 펼침

    const handleFreeCellClick = (day) => {
        const date = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
        if (date) setFreeSlot({ day, date });
    };
    const handleAddFreeWorkout = async (name) => {
        if (!freeSlot || freeProcessing) return;
        setFreeProcessing(true);
        try {
            // 고정 명단(요일 기반)으로 추가 → 매주 자동 표시. 티어 활동일엔 미집계.
            await addFreeWorkoutRosterMember(name, freeSlot.day);
            await loadWeeklyData();
        } catch (e) {
            alert('추가 실패: ' + e.message);
        } finally {
            setFreeProcessing(false);
        }
    };
    const handleRemoveFreeWorkout = async (entry) => {
        if (freeProcessing) return;
        setFreeProcessing(true);
        try {
            // roster=고정 명단, 아니면 과거 날짜별 출석 기록
            if (entry.roster) await removeFreeWorkoutRosterMember(entry.id);
            else await removeFreeWorkout(entry.id);
            await loadWeeklyData();
        } catch (e) {
            alert('삭제 실패: ' + e.message);
        } finally {
            setFreeProcessing(false);
        }
    };

    // New student waitlist (coach only)
    const [newStudentWaitlist, setNewStudentWaitlist] = useState([]);
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);
    const [waitlistDesiredSlot, setWaitlistDesiredSlot] = useState(null);
    const [waitlistStudentName, setWaitlistStudentName] = useState('');
    const [waitlistStudentSearch, setWaitlistStudentSearch] = useState('');
    const [isDirectTransfer, setIsDirectTransfer] = useState(false);

    // Class disabled / locked state
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [disabledClassesLoading, setDisabledClassesLoading] = useState(true);
    const [lockedSlots, setLockedSlots] = useState([]);
    const [lockedSlotsLoading, setLockedSlotsLoading] = useState(true);

    // 만석 보강 대기 — 코치 시간표 표시용
    const [coachMakeupWaitlist, setCoachMakeupWaitlist] = useState([]);

    // Manual refresh state
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [personalRefreshKey, setPersonalRefreshKey] = useState(0);
    const refreshInFlight = useRef(false);
    const [refreshedAt, setRefreshedAt] = useState(null);
    useEffect(() => {
        if (!loading && !sheetsError && weeklyDataLoaded && !weeklyDataError && !refreshInFlight.current) {
            setRefreshedAt(previous => previous ?? Date.now());
        }
    }, [loading, sheetsError, weeklyDataLoaded, weeklyDataError]);
    const [refreshMsg, setRefreshMsg] = useState('');
    useEffect(() => {
        if (!refreshMsg.startsWith('✓')) return;
        const timer = setTimeout(() => setRefreshMsg(''), 2500);
        return () => clearTimeout(timer);
    }, [refreshMsg]);

    // 시간표 변경(직접 이동) 처리 중 플래그 — 화면 이탈 방지 + 로딩 UI
    const [isTransferring, setIsTransferring] = useState(false);
    const [disabledClassesError, setDisabledClassesError] = useState('');
    const [lockedSlotsError, setLockedSlotsError] = useState('');
    useEffect(() => {
        if (!isTransferring) return;
        const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isTransferring]);

    // ── Data loading effects ──

    async function loadDisabledClasses() {
        setDisabledClassesLoading(true);
        setDisabledClassesError('');
        try { setDisabledClasses(await getDisabledClasses({ strict: true })); }
        catch (error) {
            setDisabledClassesError('휴강 정보를 불러오지 못했어요. 다시 불러온 뒤 수업을 확인해주세요.');
            throw error;
        } finally { setDisabledClassesLoading(false); }
    }

    async function loadLockedSlots() {
        setLockedSlotsLoading(true);
        setLockedSlotsError('');
        try { setLockedSlots(await getLockedSlots({ strict: true })); setLockedSlotsError(''); }
        catch (error) {
            setLockedSlotsError('신청 제한 정보를 불러오지 못했어요. 다시 불러온 뒤 신청해주세요.');
            throw error;
        } finally { setLockedSlotsLoading(false); }
    }

    useEffect(() => {
        void loadDisabledClasses().catch(error => console.error('Failed to load disabled classes:', error));
        void loadLockedSlots().catch(error => console.error('Failed to load locked slots:', error));
    }, []);

    async function retryFailedSettings() {
        const results = await Promise.allSettled([
            disabledClassesError && !disabledClassesLoading ? loadDisabledClasses() : undefined,
            lockedSlotsError && !lockedSlotsLoading ? loadLockedSlots() : undefined,
        ]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
    }

    useEffect(() => {
        if (user?.role === 'coach') {
            Promise.all([
                getNewStudentRegistrations('pending').catch(() => []),
                getNewStudentRegistrations('waitlist').catch(() => [])
            ]).then(([pending, waitlist]) => {
                setPendingRegistrations(pending);
                setNewStudentWaitlist(waitlist);
            });
        }
    }, [user]);

    // 대기(만석) 건의 여석 자동 감지
    useEffect(() => {
        // 시트 로드 중/실패 상태에서 빈 점유율로 대기 건을 잘못 풀지 않는다.
        if (user?.role !== 'coach' || newStudentWaitlist.length === 0 || loading || sheetsError || disabledClassesLoading || disabledClassesError) return;

        const updates = checkWaitlistAvailability(
            newStudentWaitlist, newStudentSlotOccupancy, disabledClasses, MAX_CAPACITY
        );

        if (updates.length > 0) {
            updates.forEach(({ regId, hasAvailableSlots, availableSlots }) => {
                updateWaitlistAvailability(regId, { hasAvailableSlots, availableSlots }).catch(err => {
                    console.error('대기 여석 업데이트 실패:', err);
                });
            });
            // 로컬 상태에도 반영
            setNewStudentWaitlist(prev => prev.map(reg => {
                const update = updates.find(u => u.regId === reg.id);
                if (update) return { ...reg, hasAvailableSlots: update.hasAvailableSlots, availableSlots: update.availableSlots };
                return reg;
            }));
        }
    }, [user, newStudentWaitlist, newStudentSlotOccupancy, disabledClasses, loading, sheetsError, disabledClassesLoading, disabledClassesError]);

    // 만석 보강 대기 백스톱 — 코치 시간표 로드 시 실제 여석 기준으로 만료/승급 처리 + 표시용 로드
    useEffect(() => {
        // 주간 데이터(보강 인원 등) 로드 완료 전에는 여석을 과대 계산해 만석에도 오알림이 나가므로 대기.
        if (user?.role !== 'coach' || activeMode !== 'coach' || !scheduleData || !weeklyDataLoaded || loading || sheetsError || !students.length || disabledClassesLoading || lockedSlotsLoading || disabledClassesError || lockedSlotsError) return;
        let cancelled = false;
        (async () => {
            await syncMakeupWaitlists((date, day, period) => {
                // 이번 주 시간표 범위 밖이면 여석 판단 불가 → 건너뜀 (이벤트 트리거가 처리)
                const expectedDate = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
                if (expectedDate !== date) return null;
                const periodObj = PERIODS.find(p => p.id === period);
                if (!periodObj || periodObj.type === 'free') return null;
                return getCellData(day, periodObj).availableSeats;
            });
            const list = await getActiveMakeupWaitlists().catch(() => []);
            if (!cancelled) setCoachMakeupWaitlist(list.map(normalizeWaitlistEntry));
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, activeMode, scheduleData, weeklyDataLoaded, loading, sheetsError, students, disabledClassesLoading, lockedSlotsLoading, disabledClassesError, lockedSlotsError]);

    // ── Handlers ──

    async function handleManualRefresh() {
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;
        setIsRefreshing(true);
        setRefreshMsg('');
        setPersonalRefreshKey(value => value + 1);
        try {
            // 서로 독립적인 조회는 함께 시작한다. 신청과 자동 처리의 준비 조건은 유지한다.
            const results = await Promise.allSettled([refresh(), onStudentDataRefresh?.(), loadWeeklyData(), retryFailedSettings()]);
            // 일부 조회가 먼저 실패해도 나머지가 끝날 때까지 중복 갱신을 막는다.
            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;
            setRefreshedAt(Date.now());
            setRefreshMsg('✓ 최신 상태입니다');
        } catch (error) {
            console.error('Refresh failed:', error);
            setRefreshMsg('새로고침 실패 — 잠시 후 다시 시도해주세요');
        } finally {
            refreshInFlight.current = false;
            setIsRefreshing(false);
        }
    }

    // StudentSchedule에 내려줄 셀 상태 판정 (disabledClasses/lockedSlots는 여기서 소유)
    function isClassDisabled(day, periodId) {
        return disabledClasses.includes(`${day}-${periodId}`);
    }

    function isSlotLocked(day, periodId) {
        return lockedSlots.includes(`${day}-${periodId}`);
    }

    function closeWaitlistModal() {
        setShowWaitlistModal(false);
        setWaitlistDesiredSlot(null);
        setWaitlistStudentName('');
        setWaitlistStudentSearch('');
        setIsDirectTransfer(false);
    }

    async function handleDirectTransfer(studentName, currentSlot) {
        if (!waitlistDesiredSlot || isTransferring) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        if (!confirm(
            `시간표를 이동하시겠습니까?\n\n` +
            `${studentName}: ${currentSlot.day}요일 ${currentSlot.periodName} → ${waitlistDesiredSlot.day}요일 ${period?.name}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        setIsTransferring(true);
        try {
            const studentEntry = students.find(s => s['이름'] === studentName && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const currentSchedule = studentEntry['요일 및 시간'];
            const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, waitlistDesiredSlot);

            // D열(요일 및 시간) + H열(종료날짜) 동시 업데이트 — 스케줄 바뀌면 수업일 달라지므로 종료일 재계산 필요
            // 미래 등록 행이면 G열(시작날짜)도 자동 이동, 다음 등록(미리 등록)이 있으면 그쪽도 동일 적용
            const firebaseHolidays = await getHolidays().catch(() => []);
            const result = await processScheduleTransfer(studentName, newSchedule, firebaseHolidays, {
                preferredSheetName: studentEntry._foundSheetName,
                preferredRowIndex: studentEntry._rowIndex,
            });

            alert(`시간표 이동 완료!\n${studentName}: ${currentSchedule} → ${newSchedule}\n새 종료일: ${result.newEndDate}`);
            closeWaitlistModal();
            await refresh();
            await loadWeeklyData();
        } catch (error) {
            alert(`시간표 이동 실패: ${error.message}`);
            console.error('시간표 이동 실패:', error);
        } finally {
            setIsTransferring(false);
        }
    }

    async function handleWaitlistSubmit(studentName, currentSlot) {
        if (!waitlistDesiredSlot) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        try {
            await createWaitlistRequest(studentName, currentSlot, {
                day: waitlistDesiredSlot.day,
                period: waitlistDesiredSlot.period,
                periodName: period?.name || ''
            });
            alert(`대기 등록 완료!\n${studentName}: ${currentSlot.day} ${currentSlot.periodName} → ${waitlistDesiredSlot.day} ${period?.name}\n자리가 나면 수강생에게 알림이 갑니다.`);
            closeWaitlistModal();
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 등록 실패: ${error.message}`);
        }
    }

    async function handleWaitlistCancel(waitlistId) {
        if (!confirm('대기 신청을 취소하시겠습니까?')) return;
        try {
            await cancelWaitlistRequest(waitlistId);
            alert('대기 신청이 취소되었습니다.');
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 취소 실패: ${error.message}`);
        }
    }

    // 학생 뷰에서 코치가 셀 클릭: 대기/직접 이동 모달 오픈
    function handleCoachWaitlistCellClick(day, periodId, cellData) {
        setWaitlistDesiredSlot({ day, period: periodId });
        setIsDirectTransfer(!cellData.isFull);
        setShowWaitlistModal(true);
    }

    const pageTitle = mode === 'coach'
        ? '코치 시간표'
        : mode === 'studentForce'
            ? (forceModeStudent ? `수강생 전용 — ${forceModeStudent}` : '수강생 전용 시간표')
            : user?.role === 'coach' ? '수강생 시간표' : '내 수업';

    // ── Loading / not-authenticated states ──

    // 학생 화면은 즉시 마운트해 본인 조회를 병렬 시작한다. 본문·신청 게이트는 각각 유지한다.
    if (user?.role === 'coach' && (disabledClassesLoading || lockedSlotsLoading || ((loading || (view !== 'schedule' && !homeLoaded.current && !weeklyDataLoaded && !weeklyDataError)) && !isRefreshing))) {
        if (view !== 'schedule') return <main className="today-page today-coach">
            <header className="today-header"><h1 className="today-coach-title">근력학교 · {user.username}</h1></header>
            <section className="today-card"><h2>오늘 수업</h2><p className="today-empty" role="status">수업 정보를 불러오고 있어요.</p></section>
        </main>;
        return <PageLoading message="정보를 불러오는 중…" />;
    }

    if (!isAuthenticated) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    <h1 className="schedule-page-title">
                        {pageTitle}
                    </h1>
                </div>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h3>⚠️ Google Sheets에 연결되지 않았습니다</h3>
                    <p>대시보드에서 Google 계정을 연결해주세요.</p>
                </div>
            </div>
        );
    }

    if (user?.role === 'coach' && (disabledClassesError || lockedSlotsError)) {
        return <div className="today-page"><p role="alert">{disabledClassesError || lockedSlotsError}</p><button onClick={handleManualRefresh} disabled={isRefreshing}>다시 불러오기</button></div>;
    }

    if (view !== 'schedule' && user?.role === 'coach') {
        if (!homeLoaded.current && !weeklyDataLoaded && !weeklyDataError) return <p className="today-empty" role="status">오늘 정보를 불러오는 중…</p>;
        if (!homeLoaded.current && (weeklyDataError || sheetsError)) return <div className="today-page"><p role="alert">{weeklyDataError || sheetsError}</p><button onClick={handleManualRefresh}>다시 불러오기</button></div>;
        return <>
            {(weeklyDataError || sheetsError) && <p className="today-error" role="alert">{weeklyDataError || sheetsError} <button onClick={handleManualRefresh}>다시 불러오기</button></p>}
             <CoachHome user={user} hasNewPostNotification={hasNewPostNotification} core={scheduleCore} dataReady={weeklyDataLoaded && !loading && !sheetsError && !disabledClassesLoading && !lockedSlotsLoading} students={students} disabledClasses={disabledClasses} registrations={pendingRegistrations} scheduleTransfers={<ScheduleTransferPanel coach embedded entries={weekWaitlist} scheduleData={scheduleData} ready={weeklyDataLoaded && !sheetsError && !loading && Boolean(students.length)} onUpdate={updateTransfer} />} onNavigate={onNavigate} refresh={handleManualRefresh} refreshedAt={refreshedAt} refreshing={isRefreshing} refreshMessage={refreshMsg} />
        </>;
    }

    // ── Main render ──

    const containerModeClass = mode === 'studentForce' ? 'mode-student' : `mode-${mode}`;

    return (
        <div className={`schedule-container ${containerModeClass}${user?.role === 'student' && !isForceMode ? ' student-class-page' : ''}`}>
            {user?.role === 'student' && !isForceMode && studentGrowth && <StudentGrowthHeader pushReadOnly={pushReadOnly} user={user} {...studentGrowth} onRetry={studentGrowth.retry} onOpen={() => onNavigate?.('ranking', 'graph')} />}
            {user?.role === 'student' && !isForceMode && <NoticeTicker user={user} onOpen={postId => onNavigate?.('post', postId)} refreshKey={refreshedAt} />}
            {user?.role === 'student' && !isForceMode && <MonthlyPRBanner onOpen={() => onNavigate?.('ranking')} refreshKey={refreshedAt} />}
            {weeklyDataError && <p role="alert" style={{ color: 'var(--error)' }}>{weeklyDataError}</p>}
            {isTransferring && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        backgroundColor: '#fff', padding: '24px 32px', borderRadius: '12px',
                        textAlign: 'center', maxWidth: '320px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }}>
                        <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#111827', marginBottom: '8px' }}>
                            시간표를 변경하고 있습니다
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#6b7280', lineHeight: '1.5' }}>
                            처리가 끝날 때까지<br/>화면을 닫지 말고 잠시 기다려주세요.
                        </div>
                    </div>
                </div>
            )}
            <div className="schedule-page-header">
                <h1 className="schedule-page-title">
                    {pageTitle}
                </h1>
                {user?.role === 'coach' ? <RefreshStatus refreshedAt={refreshedAt} refreshing={isRefreshing} message={refreshMsg} onRefresh={handleManualRefresh} /> : <>
                {refreshMsg && (
                    <span style={{
                        marginLeft: 'auto',
                        fontSize: '0.8rem',
                        color: refreshMsg.startsWith('✓') ? 'var(--success)' : 'var(--error)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                    }}>
                        {refreshMsg}
                    </span>
                )}
                <button
                    onClick={handleManualRefresh}
                    disabled={isRefreshing}
                    style={{
                        marginLeft: refreshMsg ? '0.5rem' : 'auto',
                        padding: '4px 12px',
                        fontSize: '0.85rem',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        backgroundColor: isRefreshing ? '#f3f4f6' : '#fff',
                        cursor: isRefreshing ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                    }}
                >
                    {isRefreshing ? '새로고침 중...' : '🔄 새로고침'}
                </button>
                </>}

            </div>

            {user?.role !== 'coach' && hasContractNotification && (
                <div className="student-account-actions" aria-label="확인할 알림">
                    {hasContractNotification && <button onClick={() => onNavigate?.('contractView')}>재등록 계약서 확인 <span aria-hidden="true">→</span></button>}
                </div>
            )}

            {user?.role !== 'coach' && <ScheduleTransferPanel entries={weekWaitlist} studentName={user.username} studentData={studentData} ready={weeklyDataLoaded && !loading && !isStudentDataLoading && !studentRosterError && !disabledClassesLoading && !lockedSlotsLoading && !disabledClassesError && !lockedSlotsError && Boolean(studentData)} onUpdate={updateTransfer} onRefresh={handleManualRefresh} />}

            {/* Google Sheets 연동 상태 (코치 전용) — 모드 토글 위 */}
            {user?.role === 'coach' && (
                <section style={{ marginBottom: '1rem' }}>
                    <div
                        onClick={() => setSheetsExpanded(!sheetsExpanded)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.6rem 0.9rem', background: 'var(--canvas)',
                            borderRadius: '8px', cursor: 'pointer', userSelect: 'none',
                            border: '1px solid var(--hairline)',
                        }}
                    >
                        <span style={{ fontSize: '0.9rem' }}>{sheetsExpanded ? '▼' : '▶'}</span>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Google Sheets 연동</span>
                        {loading ? (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>동기화 중...</span>
                        ) : sheetsError ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#dc2626', marginLeft: '0.5rem' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#dc2626', display: 'inline-block' }}></span>
                                연동 실패
                            </span>
                        ) : isConnected ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#16a34a', marginLeft: '0.5rem' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#16a34a', display: 'inline-block' }}></span>
                                연동 중
                            </span>
                        ) : null}
                    </div>
                    {sheetsExpanded && (
                        <div style={{ marginTop: '0.5rem' }}>
                            <GoogleSheetsSync />
                            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                                <button
                                    onClick={() => onNavigate && onNavigate('test')}
                                    style={{
                                        padding: '0.6rem 1.2rem', background: 'var(--accent)', color: 'white',
                                        border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    🧪 Google Sheets 연동 테스트
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* Mode toggle (coach only) */}
            {user?.role === 'coach' && (
                <div className="controls">
                    <button
                        className={`mode-toggle ${mode === 'student' ? 'active' : ''}`}
                        onClick={() => { setMode('student'); setForceModeStudent(''); }}
                    >
                        신규 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                        onClick={() => { setMode('coach'); setForceModeStudent(''); }}
                    >
                        코치 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'studentForce' ? 'active' : ''}`}
                        onClick={() => setMode('studentForce')}
                    >
                        수강생 전용
                    </button>
                </div>
            )}

            {/* 수강생 전용 모드 — 수강생 선택 및 강제 모드 안내 */}
            {user?.role === 'coach' && mode === 'studentForce' && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    fontSize: '0.88rem',
                    color: '#7f1d1d',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>수강생 선택:</strong>
                        <select
                            value={forceModeStudent}
                            onChange={e => setForceModeStudent(e.target.value)}
                            style={{
                                padding: '4px 8px',
                                fontSize: '0.9rem',
                                border: '1px solid #fca5a5',
                                borderRadius: '4px',
                                backgroundColor: '#fff',
                                minWidth: '160px'
                            }}
                        >
                            <option value="">-- 선택 --</option>
                            {studentForceCandidates.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                        {forceModeStudent && (
                            <button
                                onClick={() => setForceModeStudent('')}
                                style={{
                                    padding: '4px 10px',
                                    fontSize: '0.8rem',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '4px',
                                    backgroundColor: '#fff',
                                    color: '#7f1d1d',
                                    cursor: 'pointer'
                                }}
                            >
                                선택 해제
                            </button>
                        )}
                    </div>
                    <div style={{ fontSize: '0.82rem', lineHeight: '1.5' }}>
                        ⚠️ <strong>강제 모드</strong> — 보강 신청/취소 시 시간 데드라인(2시간/1시간), 주 1회 제한, 홀딩 기간 제약을 무시합니다.<br />
                        수강생을 선택하면 해당 수강생의 시간표가 나타나고, 코치가 그 수강생을 대신해 보강을 처리할 수 있습니다.
                    </div>
                </div>
            )}

            {/* Coach mode (코치 전용 뷰) */}
            {mode === 'coach' && (
                <CoachSchedule
                    weekDates={weekDates}
                    weekWaitlist={weekWaitlist}
                    delayedReregistrationStudents={delayedReregistrationStudents}
                    lastClassByName={lastClassByName}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    newStudentWaitlist={newStudentWaitlist}
                    disabledClasses={disabledClasses}
                    setDisabledClasses={setDisabledClasses}
                    lockedSlots={lockedSlots}
                    setLockedSlots={setLockedSlots}
                    unpaidStudentNames={unpaidStudentNames}
                    makeupWaitlists={coachMakeupWaitlist}
                    freeWorkoutByDate={freeWorkoutByDate}
                    onFreeCellClick={handleFreeCellClick}
                />
            )}

            {/* Student mode (실제 학생 + 코치 신규 전용) */}
            {mode === 'student' && (
                <StudentSchedule
                    user={user}
                    mode={mode}
                    students={students}
                    weekDates={weekDates}
                    weekAbsences={weekAbsences}
                    weekWaitlist={weekWaitlist}
                    studentSchedule={studentSchedule}
                    studentData={effectiveStudentData}
                    isMyHoldingDate={isMyHoldingDate}
                    isMakeupHeld={isMakeupHeld}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    loadWeeklyData={loadWeeklyData}
                    refreshStudents={async () => { await Promise.all([refresh(), onStudentDataRefresh?.(), retryFailedSettings()]); }}
                    isClassDisabled={isClassDisabled}
                    isSlotLocked={isSlotLocked}
                    newStudentWaitlist={newStudentWaitlist}
                    onCoachCellClick={handleCoachWaitlistCellClick}
                    freeWorkoutByDate={freeWorkoutByDate}
                    onNavigate={onNavigate}
                    weekHolidays={weekHolidays}
                    weekHoldings={weekHoldings}
                    weeklyDataLoaded={weeklyDataLoaded && !isStudentDataLoading && !disabledClassesLoading && !disabledClassesError}
                    weeklyDataError={weeklyDataError || disabledClassesError}
                    studentDataLoading={isStudentDataLoading}
                    requestDataLoaded={weeklyDataLoaded && !loading && !isStudentDataLoading && !disabledClassesLoading && !lockedSlotsLoading && !studentRosterError && !disabledClassesError && !lockedSlotsError}
                    requestDataError={studentRosterError || weeklyDataError || disabledClassesError || lockedSlotsError}
                    personalRefreshKey={personalRefreshKey}
                    getEffectiveEndDate={getEffectiveEndDate}
                />
            )}

            {/* 수강생 전용(강제) 모드 — 코치가 빙의 대상 학생의 시간표를 렌더하고 데드라인 없이 보강 처리 */}
            {mode === 'studentForce' && !forceModeStudent && (
                <div style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#6b7280',
                    backgroundColor: '#fff',
                    border: '1px dashed #d1d5db',
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                }}>
                    위 드롭다운에서 수강생을 선택하면 시간표가 표시됩니다.
                </div>
            )}
            {mode === 'studentForce' && forceModeStudent && !isForceMode && (
                <div style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#991b1b',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                }}>
                    <strong>{forceModeStudent}</strong>님의 수강 정보를 찾을 수 없습니다.<br />
                    Google Sheets에서 시간표(요일 및 시간) 컬럼이 비어 있거나 등록행이 누락된 상태일 수 있습니다.
                </div>
            )}
            {mode === 'studentForce' && isForceMode && (
                <StudentSchedule
                    user={effectiveUser}
                    mode="student"
                    students={students}
                    weekDates={weekDates}
                    weekAbsences={weekAbsences}
                    weekWaitlist={weekWaitlist}
                    studentSchedule={studentSchedule}
                    studentData={effectiveStudentData}
                    isMyHoldingDate={isMyHoldingDate}
                    isMakeupHeld={isMakeupHeld}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    loadWeeklyData={loadWeeklyData}
                    refreshStudents={async () => { await Promise.all([refresh(), onStudentDataRefresh?.()]); }}
                    isClassDisabled={isClassDisabled}
                    isSlotLocked={isSlotLocked}
                    forceMode={true}
                    personalRefreshKey={personalRefreshKey}
                    freeWorkoutByDate={freeWorkoutByDate}
                    onNavigate={onNavigate}
                    weekHolidays={weekHolidays}
                    weekHoldings={weekHoldings}
                    weeklyDataLoaded={weeklyDataLoaded}
                    weeklyDataError={weeklyDataError}
                    getEffectiveEndDate={getEffectiveEndDate}
                />
            )}

            {/* Waitlist / Transfer Modal (코치가 신규 전용 뷰에서 셀 클릭 시) */}
            {showWaitlistModal && user?.role === 'coach' && waitlistDesiredSlot && (
                <CoachWaitlistModal
                    waitlistDesiredSlot={waitlistDesiredSlot}
                    isDirectTransfer={isDirectTransfer}
                    weekWaitlist={weekWaitlist}
                    students={students}
                    waitlistStudentName={waitlistStudentName}
                    setWaitlistStudentName={setWaitlistStudentName}
                    waitlistStudentSearch={waitlistStudentSearch}
                    setWaitlistStudentSearch={setWaitlistStudentSearch}
                    onDirectTransfer={handleDirectTransfer}
                    onWaitlistSubmit={handleWaitlistSubmit}
                    onWaitlistCancel={handleWaitlistCancel}
                    onClose={closeWaitlistModal}
                />
            )}

            {/* 자율운동 출석 관리 모달 (코치 전용 뷰에서 자율운동 셀 클릭 시) */}
            {freeSlot && user?.role === 'coach' && (
                <FreeWorkoutModal
                    dateLabel={`${weekDates[freeSlot.day]} (${freeSlot.day})`}
                    attendees={freeWorkoutByDate[freeSlot.date] || []}
                    students={students}
                    onAdd={handleAddFreeWorkout}
                    onRemove={handleRemoveFreeWorkout}
                    onClose={() => setFreeSlot(null)}
                    processing={freeProcessing}
                />
            )}
        </div>
    );
};

export default WeeklySchedule;
