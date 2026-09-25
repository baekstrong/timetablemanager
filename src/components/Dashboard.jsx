import { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { createPost, getPostsPage, updatePost, getActiveWaitlistRequests, cancelWaitlistRequest, acceptWaitlistRequest, getPendingContractForStudent, getMakeupRequestsByWeek, getHolidays, getTierMap, backfillTiersForMonth, getGradeMap, consumePRCelebration, syncStudentFrequencies, syncStudentSchedules, syncUnpaidStudents } from '../services/firebaseService';
import { parseSheetDate, findStudentAcrossSheets, processScheduleTransfer } from '../services/googleSheetsService';
import { initPush, isPushAvailable, getPushPermission, pushNotice } from '../services/pushService';
import { resolvePushState } from '../utils/pushStatus';
import { resolveInstallState } from '../utils/installState';
import { shouldShowInCoachStudentList } from '../utils/studentList';
import { buildUpdatedSchedule } from '../utils/scheduleUtils';
import { POST_LIMITS } from '../data/boardConstants';
import PostList from './board/PostList';
import PostDetail from './board/PostDetail';
import PostForm from './board/PostForm';
import MonthlyPRBanner from './MonthlyPRBanner';
import './board/Board.css';
import './Dashboard.css';

// 알림 상태 줄 문구. 예전 배너는 권한이 'default'일 때만 떠서, 차단당했거나 토큰 등록에 실패한
// 사람에겐 아무것도 안 보였다(= "알림 켜기 버튼이 없어요"의 원인). 4상태를 전부 안내한다.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const PUSH_ROW = {
    off: { color: '#329BE7', text: '공지·보강 자리 알림을 푸시로 받아보세요.', action: '알림 켜기' },
    denied: {
        color: '#E94E58',
        text: isIOS
            ? '알림이 차단돼 있어요. 아이폰 설정 → 알림 → 근력학교에서 허용으로 바꿔주세요.'
            : '알림이 차단돼 있어요. 주소창 왼쪽 자물쇠 → 사이트 설정 → 알림 → 허용으로 바꿔주세요.',
    },
    unsupported: {
        color: '#EDBC40',
        text: isIOS
            ? '아이폰은 홈 화면에 추가해야 알림을 받을 수 있어요. 공유 버튼 → 홈 화면에 추가.'
            : '이 브라우저에선 알림을 켤 수 없어요. 카톡·인스타 안에서 열었다면 크롬으로 다시 열어주세요.',
    },
};

// 홈 화면 추가 안내 줄. 홈 화면에서 열면(standalone) 저절로 사라지므로 '닫기'가 없다.
const INSTALL_ROW = {
    android: { text: '홈 화면에 추가하면 앱처럼 바로 열리고 알림도 받을 수 있어요.', action: '홈 화면에 추가' },
    'ios-safari': { text: '홈 화면에 추가하면 앱처럼 바로 열리고 알림도 받을 수 있어요. 아래 공유 버튼 → "홈 화면에 추가".' },
    'ios-other': { text: '홈 화면에 추가하려면 사파리로 열어주세요. 사파리에서 공유 버튼 → "홈 화면에 추가".' },
};

const Dashboard = ({ user, onNavigate, onLogout, deepLinkPost, onDeepLinkDone }) => {
    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(true);
    const [postsError, setPostsError] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [boardPage, setBoardPage] = useState(1);
    const [boardHasNextPage, setBoardHasNextPage] = useState(false);
    const boardCursorsRef = useRef({ 1: null });
    const boardRequestIdRef = useRef(0);
    const [viewMode, setViewMode] = useState('list');
    // 알림 클릭으로 들어온 글 열기 — prop(앱이 떠 있던 경우) 또는 주소 ?post=(새로 열린 경우)
    useEffect(() => {
        const id = deepLinkPost || new URLSearchParams(window.location.search).get('post');
        if (!id) return;
        setSelectedPostId(id);
        setViewMode('detail');
        if (deepLinkPost) onDeepLinkDone?.();
        else window.history.replaceState({}, '', window.location.pathname);
    }, [deepLinkPost, onDeepLinkDone]);
    const [selectedPostId, setSelectedPostId] = useState(null);
    const [showPostForm, setShowPostForm] = useState(false);
    const [pushState, setPushState] = useState(null); // null=판정 전, 'on'|'off'|'denied'|'unsupported'
    const [installState, setInstallState] = useState(null); // 'installed'|'android'|'ios-safari'|'ios-other'|null
    const deferredPromptRef = useRef(null);
    const [editingPost, setEditingPost] = useState(null);

    const { students, refresh } = useGoogleSheets();

    // 게시판 작성자 배지만 조회한다. 본인 성장 정보와 안내는 App의 내 수업에서 관리한다.
    const [tierMap, setTierMap] = useState({});
    const [gradeMap, setGradeMap] = useState({});
    // PR 축하 팝업 (코치 대리 입력 후 학생 첫 접속 시 1회)
    const [prCelebration, setPrCelebration] = useState(null);

    useEffect(() => {
        let cancel = false;
        getTierMap().then(map => { if (!cancel) setTierMap(map); });
        return () => { cancel = true; };
    }, []);

    // 알림 상태 판정 + 이미 허용한 사람 토큰 갱신.
    // 갱신 결과(token)가 곧 '진짜 켜짐' 여부다 — 권한만 보면 getToken이 실패한 사람을 놓친다.
    // (아이폰은 requestPermission이 사용자 제스처 안에서만 통해서 자동으로 못 띄운다)
    useEffect(() => {
        if (!user?.username) return;
        let cancel = false;
        (async () => {
            const available = await isPushAvailable();
            const permission = getPushPermission();
            const token = available && permission === 'granted' ? await initPush(user.username) : null;
            if (!cancel) setPushState(resolvePushState({ available, permission, token }));
        })();
        return () => { cancel = true; };
    }, [user]);

    // 홈 화면 추가 안내. 안드로이드는 beforeinstallprompt를 붙잡아 뒀다가 버튼으로 띄우고,
    // 아이폰은 그 이벤트가 없으므로 공유 시트 문구만 바로 보여준다.
    useEffect(() => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        const decide = (canPrompt) => setInstallState(resolveInstallState({ standalone, ua: navigator.userAgent, canPrompt }));
        decide(false);
        const onBeforeInstall = (e) => {
            e.preventDefault(); // 크롬 기본 배너 대신 우리 줄에서 띄운다
            deferredPromptRef.current = e;
            decide(true);
        };
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    }, []);

    const installApp = async () => {
        const e = deferredPromptRef.current;
        if (!e) return;
        deferredPromptRef.current = null; // 이벤트는 한 번만 쓸 수 있다
        e.prompt();
        const { outcome } = await e.userChoice;
        setInstallState(outcome === 'accepted' ? 'installed' : null);
    };

    // 이미 granted인데 off로 잡힌 사람(토큰 등록 실패)도 이 버튼으로 재시도된다.
    const enablePush = async () => {
        const token = await initPush(user.username, true);
        setPushState(resolvePushState({ available: true, permission: getPushPermission(), token }));
    };

    // 코치 진입 시: 그 달 첫 1회만 전원 티어 백필(studentMeta/tierBackfill 잠금).
    // 앱을 안 여는 학생은 본인 갱신이 영영 안 돌아 뱃지가 두 달 전 값에 멈추므로 뒤를 받쳐준다.
    // 레벨(XP)은 증분 방식이라 백필 대상이 아니다 — 뱃지는 저장된 값만 읽는다.
    useEffect(() => {
        if (!user || user.role !== 'coach' || !students || students.length === 0) return;
        let cancel = false;
        backfillTiersForMonth()
            .then(res => { if (!cancel && res?.updated) getTierMap().then(m => { if (!cancel && m) setTierMap(m); }); })
            .catch(err => console.error('티어 백필 실패:', err));
        getTierMap().then(map => { if (!cancel && map) setTierMap(map); });
        getGradeMap().then(map => { if (!cancel && map) setGradeMap(map); });
        syncStudentFrequencies(students); // 훈련일지 도장 모달 자동추천용 주횟수 발행
        syncStudentSchedules(students); // 훈련일지 '지금 수업' 명단 계산용 시간표 발행
        syncUnpaidStudents(students); // 훈련일지 이름칩 '미결제' 표기용 (coachNotes/unpaid — 코치만 read)

        return () => { cancel = true; };
    }, [user, students]);

    // 게시판은 배지와 기존 PR 축하만 담당한다. 티어·학년 확인 상태는 여기서 소비하지 않는다.
    useEffect(() => {
        if (!user || user.role === 'coach') return;
        if (!students || students.length === 0) return;
        let cancel = false;
        getGradeMap().then(map => { if (!cancel && map) setGradeMap(map); });
        consumePRCelebration(user.username).then(p => {
            if (!cancel && p) setPrCelebration(p.kind === 'milestone'
                ? `🏆 ${p.exercise} 기준 통과! 다음 중량으로!`
                : `🎉 ${p.exercise} 신기록 축하합니다!`);
        });
        return () => { cancel = true; };
    }, [user, students]);

    // 수강생 대기 신청 목록
    const [studentWaitlist, setStudentWaitlist] = useState([]);
    // 시간표 변경 처리 중인 대기 ID (로딩 표시용)
    const [waitlistProcessingId, setWaitlistProcessingId] = useState(null);

    // 시간표 변경 처리 중 화면 이탈 방지 (탭 닫기/새로고침 경고)
    useEffect(() => {
        if (!waitlistProcessingId) return;
        const handler = (e) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [waitlistProcessingId]);
    // 수강생 재등록 계약
    const [pendingContract, setPendingContract] = useState(null);
    useEffect(() => {
        if (user.role === 'coach') return;
        const loadStudentData = async () => {
            try {
                const [waitlist, contract] = await Promise.all([
                    getActiveWaitlistRequests(user.username),
                    getPendingContractForStudent(user.username)
                ]);
                setStudentWaitlist(waitlist);
                setPendingContract(contract);
            } catch (err) {
                console.error('수강생 데이터 로드 실패:', err);
            }
        };
        loadStudentData();
    }, [user]);

    // 수강생 모드: 본인의 종료날짜 확인
    const [isMyLastDay, setIsMyLastDay] = useState(false);
    const [isCourseExpired, setIsCourseExpired] = useState(false);

    useEffect(() => {
        const checkMyLastDay = async () => {
            if (user.role === 'coach') return;
            try {
                // App.jsx의 STUDENT_LOOKUP과 같은 이유로 폴백을 끈다 (본인 등록 조회)
                const result = await findStudentAcrossSheets(user.username, { requireActive: false });
                if (result && result.student) {
                    const endDateStr = result.student['종료날짜'];
                    if (endDateStr) {
                        const endDate = parseSheetDate(endDateStr);
                        if (endDate) {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            endDate.setHours(0, 0, 0, 0);

                            // 보강으로 인한 effective end date 계산
                            let effectiveEnd = new Date(endDate);
                            try {
                                const endDateISO = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
                                // 종료일 전후 1주일 범위의 보강 조회
                                const weekBefore = new Date(endDate);
                                weekBefore.setDate(weekBefore.getDate() - 7);
                                const weekAfter = new Date(endDate);
                                weekAfter.setDate(weekAfter.getDate() + 14);
                                const wbStr = `${weekBefore.getFullYear()}-${String(weekBefore.getMonth() + 1).padStart(2, '0')}-${String(weekBefore.getDate()).padStart(2, '0')}`;
                                const waStr = `${weekAfter.getFullYear()}-${String(weekAfter.getMonth() + 1).padStart(2, '0')}-${String(weekAfter.getDate()).padStart(2, '0')}`;
                                const makeups = await getMakeupRequestsByWeek(wbStr, waStr);
                                const myMakeups = makeups.filter(m =>
                                    m.studentName === user.username &&
                                    (m.status === 'active' || m.status === 'completed') &&
                                    m.makeupClass.date > endDateISO
                                );
                                for (const m of myMakeups) {
                                    const makeupDate = new Date(m.makeupClass.date + 'T00:00:00');
                                    if (makeupDate > effectiveEnd) effectiveEnd = makeupDate;
                                }
                            } catch (makeupErr) {
                                console.warn('보강 데이터 조회 실패:', makeupErr);
                            }
                            effectiveEnd.setHours(0, 0, 0, 0);

                            setIsMyLastDay(effectiveEnd.getTime() === today.getTime());
                            setIsCourseExpired(today.getTime() > effectiveEnd.getTime());
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to check last day:', err);
            }
        };
        checkMyLastDay();
    }, [user]);

    const loadPosts = useCallback(async (targetPage = boardPage, { reset = false } = {}) => {
        const requestId = ++boardRequestIdRef.current;
        setPostsLoading(true);
        setPostsError(null);

        try {
            if (reset) {
                boardCursorsRef.current = { 1: null };
            }

            for (let page = 1; page < targetPage; page += 1) {
                if (boardCursorsRef.current[page + 1] !== undefined) continue;
                const preloaded = await getPostsPage(selectedCategory, POST_LIMITS.PAGE_SIZE, boardCursorsRef.current[page] || null);
                boardCursorsRef.current[page + 1] = preloaded.nextCursor;
            }

            const data = await getPostsPage(
                selectedCategory,
                POST_LIMITS.PAGE_SIZE,
                boardCursorsRef.current[targetPage] || null
            );
            boardCursorsRef.current[targetPage + 1] = data.nextCursor;

            if (requestId !== boardRequestIdRef.current) return;
            setPosts(data.posts);
            setBoardHasNextPage(data.hasNextPage);
            setPostsLoading(false);
        } catch (error) {
            if (requestId !== boardRequestIdRef.current) return;
            console.error('게시글 페이지 로드 실패:', error);
            setPosts([]);
            setPostsError('게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
            setPostsLoading(false);
        }
    }, [boardPage, selectedCategory]);

    // 게시글은 현재 페이지 분량만 읽는다. 페이지 이동 시 필요한 커서만 순차 확보.
    useEffect(() => {
        loadPosts(boardPage, { reset: boardPage === 1 });
    }, [boardPage, selectedCategory, loadPosts]);

    const handleCategoryChange = (category) => {
        setSelectedCategory(category);
        setBoardPage(1);
    };

    const handlePostClick = (postId) => {
        setSelectedPostId(postId);
        setViewMode('detail');
    };

    const handleBackToList = () => {
        setViewMode('list');
        setSelectedPostId(null);
    };

    const handlePostSubmit = async (formData) => {
        try {
            if (editingPost) {
                await updatePost(editingPost.id, {
                    title: formData.title,
                    content: formData.content,
                    pinned: formData.pinned || false,
                    images: formData.images || [],
                });
            } else {
                const { notify, ...postData } = formData;
                const created = await createPost(postData);
                if (notify) {
                    // 수강중 판정은 이미 시트를 들고 있는 여기서 — 서버는 받은 이름만 본다
                    const names = [...new Set(
                        students.filter(shouldShowInCoachStudentList).map(s => s['이름']).filter(Boolean)
                    )];
                    pushNotice(names, postData.title, postData.content, created?.id);
                }
            }
            setShowPostForm(false);
            setEditingPost(null);
            boardCursorsRef.current = { 1: null };
            setBoardPage(1);
            await loadPosts(1, { reset: true });
        } catch (error) {
            alert('저장 실패: ' + error.message);
        }
    };

    const handleEditPost = (post) => {
        setEditingPost(post);
        setShowPostForm(true);
        setViewMode('list');
    };

    // 대기 취소
    const handleWaitlistCancel = async (waitlistId) => {
        if (!confirm('대기 신청을 취소하시겠습니까?')) return;
        try {
            await cancelWaitlistRequest(waitlistId);
            alert('대기 신청이 취소되었습니다.');
            const waitlist = await getActiveWaitlistRequests(user.username);
            setStudentWaitlist(waitlist);
        } catch (error) {
            alert(`대기 취소 실패: ${error.message}`);
        }
    };

    // 대기 수락 (시간표 영구 변경)
    const handleWaitlistAccept = async (waitlistItem) => {
        if (waitlistProcessingId) return; // 중복 클릭 방지
        const { currentSlot, desiredSlot } = waitlistItem;
        if (!confirm(
            `${desiredSlot.day}요일 ${desiredSlot.periodName}에 자리가 났습니다!\n\n` +
            `시간표를 변경하시겠습니까?\n` +
            `${currentSlot.day}요일 ${currentSlot.periodName} → ${desiredSlot.day}요일 ${desiredSlot.periodName}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        setWaitlistProcessingId(waitlistItem.id);
        try {
            const studentEntry = students.find(s => s['이름'] === user.username && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const currentSchedule = studentEntry['요일 및 시간'];
            const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, desiredSlot);

            const firebaseHolidays = await getHolidays().catch(() => []);
            const result = await processScheduleTransfer(user.username, newSchedule, firebaseHolidays, {
                preferredSheetName: studentEntry._foundSheetName,
                preferredRowIndex: studentEntry._rowIndex,
            });
            await acceptWaitlistRequest(waitlistItem.id);

            alert(`시간표 변경 완료!\n${currentSchedule} → ${newSchedule}\n새 종료일: ${result.newEndDate}`);
            await refresh();
            const waitlist = await getActiveWaitlistRequests(user.username);
            setStudentWaitlist(waitlist);
        } catch (error) {
            alert(`시간표 변경 실패: ${error.message}`);
            console.error('시간표 변경 실패:', error);
        } finally {
            setWaitlistProcessingId(null);
        }
    };

    return (
        <div className="dashboard-container">
            {waitlistProcessingId && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <div style={{
                        backgroundColor: '#fff',
                        padding: '24px 32px',
                        borderRadius: '12px',
                        textAlign: 'center',
                        maxWidth: '320px',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }}>
                        <div style={{
                            display: 'inline-block',
                            width: '40px',
                            height: '40px',
                            border: '4px solid var(--hairline)',
                            borderTopColor: 'var(--success)',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                            marginBottom: '16px',
                        }} />
                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text)', marginBottom: '8px' }}>
                            시간표를 변경하고 있습니다
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                            처리가 끝날 때까지<br/>화면을 닫지 말고 잠시 기다려주세요.
                        </div>
                    </div>
                </div>
            )}
            <div className="dashboard-background">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
            </div>

            <div className="dashboard-content">
                <header className={`dashboard-header${user.role !== 'coach' ? ' student-board-header' : ''}`}>
                    <div className="header-left">
                        <h1 className="dashboard-title">
                            {user.role === 'coach' ? `환영합니다, ${user.username}님` : '게시판'}
                        </h1>
                    </div>
                    {user.role === 'coach' && <button onClick={onLogout} className="logout-button">
                        <span>로그아웃</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>}
                </header>

                {INSTALL_ROW[installState] && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: '#329BE71A',
                        border: '1px solid #329BE74D',
                        borderRadius: 'var(--r-md)', padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
                        fontSize: '0.85rem', lineHeight: 1.5,
                    }}>
                        <span style={{ flex: 1 }}>📲 {INSTALL_ROW[installState].text}</span>
                        {INSTALL_ROW[installState].action && (
                            <button
                                style={{ flexShrink: 0, padding: '6px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-chip)', fontWeight: 600, cursor: 'pointer' }}
                                onClick={installApp}
                            >
                                {INSTALL_ROW[installState].action}
                            </button>
                        )}
                    </div>
                )}

                {pushState === 'on' ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                        🔔 알림 켜짐
                    </div>
                ) : PUSH_ROW[pushState] ? (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        background: `${PUSH_ROW[pushState].color}1A`,
                        border: `1px solid ${PUSH_ROW[pushState].color}4D`,
                        borderRadius: 'var(--r-md)', padding: '0.6rem 0.8rem', marginBottom: '1rem',
                        fontSize: '0.85rem', lineHeight: 1.5,
                    }}>
                        <span style={{ flex: 1 }}>{PUSH_ROW[pushState].text}</span>
                        {PUSH_ROW[pushState].action && (
                            <button
                                style={{ flexShrink: 0, padding: '6px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-chip)', fontWeight: 600, cursor: 'pointer' }}
                                onClick={enablePush}
                            >
                                {PUSH_ROW[pushState].action}
                            </button>
                        )}
                    </div>
                ) : null}

                {/* 수강생 모드: 오늘이 종료일이면 메시지 표시 */}
                {user.role !== 'coach' && isMyLastDay && (
                    <div style={{
                        background: '#EDBC401A',
                        border: '1px solid #EDBC40',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: '#92400e',
                        fontSize: '0.95rem'
                    }}>
                        오늘은 마지막 수업일입니다
                    </div>
                )}

                {user.role !== 'coach' && isCourseExpired && (
                    <div style={{
                        background: '#E94E581A',
                        border: '1px solid #E94E58',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: '#991b1b',
                        fontSize: '0.95rem'
                    }}>
                        수강 기간이 만료되었습니다. 재등록을 원하시면 코치에게 문의해주세요.
                    </div>
                )}

                {/* 수강생 재등록 계약 배너 */}
                {user.role !== 'coach' && pendingContract && (
                    <div style={{
                        margin: '0 0 1rem 0',
                        padding: '14px 16px',
                        borderRadius: '10px',
                        background: '#EDBC401A',
                        border: '1.5px solid #EDBC40',
                        cursor: 'pointer'
                    }}
                    onClick={() => onNavigate('contractView')}
                    >
                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#92400e', marginBottom: '6px' }}>
                            재등록 계약서가 도착했습니다
                        </div>
                        <div style={{ fontSize: '0.88rem', color: '#78350f' }}>
                            주{pendingContract.registrationData?.주횟수}회 | {pendingContract.registrationData?.['요일 및 시간']}
                        </div>
                        <div style={{
                            marginTop: '10px',
                            padding: '7px 14px',
                            background: '#f59e0b',
                            color: 'white',
                            borderRadius: '6px',
                            textAlign: 'center',
                            fontWeight: '700',
                            fontSize: '0.9rem'
                        }}>
                            계약서 확인하기
                        </div>
                    </div>
                )}

                {/* 수강생 대기 신청 배너 */}
                {user.role !== 'coach' && studentWaitlist.length > 0 && (
                    <div style={{
                        margin: '0 0 1rem 0',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        backgroundColor: '#fffbeb',
                        border: '1px solid #f59e0b'
                    }}>
                        <div style={{ marginBottom: '8px', fontSize: '0.95rem', color: '#92400e', fontWeight: 'bold' }}>
                            대기 신청 ({studentWaitlist.length}건)
                        </div>
                        {studentWaitlist.map((w) => (
                            <div key={w.id} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 0',
                                borderBottom: '1px solid #fde68a'
                            }}>
                                <div style={{ fontSize: '0.9rem', color: '#78350f' }}>
                                    {w.currentSlot.day} {w.currentSlot.periodName} → {w.desiredSlot.day} {w.desiredSlot.periodName}
                                    {w.status === 'waiting' && (
                                        <span style={{
                                            marginLeft: '8px',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            backgroundColor: '#f59e0b',
                                            color: '#fff',
                                            fontSize: '0.8rem',
                                            fontWeight: 'bold'
                                        }}>대기중</span>
                                    )}
                                    {w.status === 'notified' && (
                                        <span style={{
                                            marginLeft: '8px',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            backgroundColor: '#22c55e',
                                            color: '#fff',
                                            fontSize: '0.8rem',
                                            fontWeight: 'bold'
                                        }}>코치 승인!</span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    {w.status === 'notified' && (() => {
                                        const isProcessing = waitlistProcessingId === w.id;
                                        const isAnyProcessing = waitlistProcessingId !== null;
                                        return (
                                            <>
                                                <button
                                                    onClick={() => handleWaitlistAccept(w)}
                                                    disabled={isAnyProcessing}
                                                    style={{
                                                        padding: '4px 10px',
                                                        fontSize: '0.8rem',
                                                        backgroundColor: isProcessing ? '#86efac' : (isAnyProcessing ? '#d1d5db' : '#22c55e'),
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: isAnyProcessing ? 'not-allowed' : 'pointer',
                                                        fontWeight: 'bold',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    {isProcessing && (
                                                        <span style={{
                                                            display: 'inline-block',
                                                            width: '10px',
                                                            height: '10px',
                                                            border: '2px solid #fff',
                                                            borderTopColor: 'transparent',
                                                            borderRadius: '50%',
                                                            animation: 'spin 0.8s linear infinite'
                                                        }} />
                                                    )}
                                                    {isProcessing ? '변경 중...' : '승인'}
                                                </button>
                                                <button
                                                    onClick={() => handleWaitlistCancel(w.id)}
                                                    disabled={isAnyProcessing}
                                                    style={{
                                                        padding: '4px 8px',
                                                        fontSize: '0.8rem',
                                                        backgroundColor: '#fee2e2',
                                                        color: isAnyProcessing ? '#9ca3af' : '#dc2626',
                                                        border: `1px solid ${isAnyProcessing ? '#d1d5db' : '#dc2626'}`,
                                                        borderRadius: '4px',
                                                        cursor: isAnyProcessing ? 'not-allowed' : 'pointer',
                                                        fontWeight: 'bold'
                                                    }}
                                                >거절</button>
                                            </>
                                        );
                                    })()}
                                    {w.status === 'waiting' && (
                                        <button
                                            onClick={() => handleWaitlistCancel(w.id)}
                                            disabled={waitlistProcessingId !== null}
                                            style={{
                                                padding: '4px 8px',
                                                fontSize: '0.8rem',
                                                backgroundColor: 'transparent',
                                                color: '#b45309',
                                                border: '1px solid #d97706',
                                                borderRadius: '4px',
                                                cursor: waitlistProcessingId !== null ? 'not-allowed' : 'pointer',
                                                opacity: waitlistProcessingId !== null ? 0.5 : 1
                                            }}
                                        >취소</button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 수강생 PR은 내 수업에서, 코치는 기존 게시판 위치에서 표시한다. */}
                {user.role === 'coach' && <MonthlyPRBanner onOpen={() => onNavigate('ranking')} />}

                {/* 게시판 섹션 */}
                {viewMode === 'list' ? (
                    <PostList
                        posts={posts}
                        loading={postsLoading}
                        error={postsError}
                        selectedCategory={selectedCategory}
                        onCategoryChange={handleCategoryChange}
                        onPostClick={handlePostClick}
                        onWriteClick={() => { setEditingPost(null); setShowPostForm(true); }}
                        onRetry={() => loadPosts(boardPage, { reset: true })}
                        currentPage={boardPage}
                        hasNextPage={boardHasNextPage}
                        onPageChange={setBoardPage}
                        tierMap={tierMap}
                        gradeMap={gradeMap}
                    />
                ) : (
                    <PostDetail
                        postId={selectedPostId}
                        user={user}
                        onBack={handleBackToList}
                        onEdit={handleEditPost}
                        tierMap={tierMap}
                        gradeMap={gradeMap}
                    />
                )}

                {showPostForm && (
                    <PostForm
                        user={user}
                        editingPost={editingPost}
                        onSubmit={handlePostSubmit}
                        onClose={() => { setShowPostForm(false); setEditingPost(null); }}
                    />
                )}

            </div>

            {prCelebration && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                }}>
                    <div style={{
                        backgroundColor: '#329BE7',
                        borderRadius: '20px',
                        padding: '40px 32px',
                        maxWidth: '320px',
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '16px',
                    }}>
                        <div style={{ fontSize: '3rem', lineHeight: 1 }}>
                            {prCelebration.startsWith('🏆') ? '🏆' : '🎉'}
                        </div>
                        <div style={{
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            color: '#fff',
                            textAlign: 'center',
                            lineHeight: 1.5,
                        }}>
                            {prCelebration.replace(/^[🏆🎉]\s*/u, '')}
                        </div>
                        <button
                            onClick={() => setPrCelebration(null)}
                            style={{
                                marginTop: '8px',
                                padding: '8px 24px',
                                borderRadius: '18px',
                                border: '1.5px solid rgba(255,255,255,0.6)',
                                backgroundColor: 'transparent',
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                cursor: 'pointer',
                            }}
                        >
                            확인
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
