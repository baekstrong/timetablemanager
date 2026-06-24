import { useState, useEffect, useRef, useCallback } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { createPost, getPostsPage, updatePost, getActiveWaitlistRequests, cancelWaitlistRequest, acceptWaitlistRequest, getPendingContractForStudent, getMakeupRequestsByWeek, getHolidays, getMonthlyPRUpdaters, getTierMap, refreshStudentTier, backfillTiersForMonth, getGradeMap, backfillGradesForStudents, refreshStudentXP, consumePRCelebration } from '../services/firebaseService';
import { parseSheetDate, findStudentAcrossSheets, processScheduleTransfer } from '../services/googleSheetsService';
import { buildUpdatedSchedule } from '../utils/scheduleUtils';
import { POST_LIMITS } from '../data/boardConstants';
import PostList from './board/PostList';
import PostDetail from './board/PostDetail';
import PostForm from './board/PostForm';
import TierBadge from './TierBadge';
import TierChangeModal from './TierChangeModal';
import GradeHero from './GradeHero';
import './board/Board.css';
import './Dashboard.css';

const formatPRSummary = (pr) => {
    const i = pr.intensity || {};
    const r = pr.reps || {};
    switch (pr.prType) {
        case 'oneRM': return `${i.value}${i.unit || 'kg'}`;
        case 'weightThenReps': return `${i.value}${i.unit || 'kg'} × ${r.value}회`;
        case 'timeHold': return `${r.value}초`;
        case 'bodyweightReps': return `${r.value}회`;
        default: return '';
    }
};

const Dashboard = ({ user, onNavigate, onLogout }) => {
    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(true);
    const [postsError, setPostsError] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [boardPage, setBoardPage] = useState(1);
    const [boardHasNextPage, setBoardHasNextPage] = useState(false);
    const boardCursorsRef = useRef({ 1: null });
    const boardRequestIdRef = useRef(0);
    const [viewMode, setViewMode] = useState('list');
    const [selectedPostId, setSelectedPostId] = useState(null);
    const [showPostForm, setShowPostForm] = useState(false);
    const [editingPost, setEditingPost] = useState(null);

    const { students, refresh } = useGoogleSheets();

    // 티어(출석 등급) — 게시판 뱃지용 이름→티어 맵 + 승급/강등 팝업
    const [tierMap, setTierMap] = useState({});
    const [tierChange, setTierChange] = useState(null);
    // 학년(XP) — 인사말 GradeHero용 + 게시판/댓글 학년 뱃지용
    const [gradeMap, setGradeMap] = useState({});
    const [myXp, setMyXp] = useState(0);
    // PR 축하 팝업 (코치 대리 입력 후 학생 첫 접속 시 1회)
    const [prCelebration, setPrCelebration] = useState(null);

    useEffect(() => {
        let cancel = false;
        getTierMap().then(map => { if (!cancel) setTierMap(map); });
        return () => { cancel = true; };
    }, []);

    // 코치 진입 시: 이번 달 미계산 학생 전원 티어 일괄 계산 → 게시판 뱃지가 전원 표시되도록.
    // 이미 전원 계산됐으면 users 1회 읽고 끝(저렴). 학생 본인 인트로 팝업은 보존됨.
    useEffect(() => {
        if (!user || user.role !== 'coach' || !students || students.length === 0) return;
        let cancel = false;
        backfillTiersForMonth(students).then(map => { if (!cancel && map) setTierMap(map); });
        backfillGradesForStudents(students).then(map => { if (!cancel && map) setGradeMap(map); });
        return () => { cancel = true; };
    }, [user, students]);

    // 새 달 첫 접속 시 지난달 활동으로 티어 재계산 → 변동 있으면 팝업.
    // 같은 달엔 changed:false라 재실행돼도 중복 팝업 없음.
    useEffect(() => {
        if (!user || user.role === 'coach') return;
        let cancel = false;
        refreshStudentTier({ userName: user.username }).then(change => {
            if (cancel || !change) return;
            if (change.tier) setTierMap(prev => ({ ...prev, [user.username]: change.tier }));
            if (change.changed) setTierChange(change);
        });
        const myGender = (students.find(s => (s['이름'] || '').trim() === user.username)?.['성별'] || '').trim();
        refreshStudentXP({ userName: user.username, gender: myGender }).then(res => {
            if (!cancel && res) setMyXp(res.xp);
        });
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
    // 이달의 PR 갱신자 미리보기
    const [recentPRs, setRecentPRs] = useState([]);

    // 이달의 PR 미리보기 (코치/학생 공통) — 전체 목록을 받아 배너에서 슬라이드 회전
    useEffect(() => {
        (async () => {
            try {
                const data = await getMonthlyPRUpdaters(30);
                setRecentPRs(data);
            } catch (err) {
                console.error('이달의 PR 로드 실패:', err);
            }
        })();
    }, [user]);

    // 이달의 PR 배너: 3명씩 보여주며 위로 한 칸씩 슬라이드 (뉴스 티커 스타일)
    const PR_VISIBLE = 3;
    const PR_LINE_HEIGHT = 22; // px
    const [prBannerIndex, setPrBannerIndex] = useState(0);
    const [prBannerAnimate, setPrBannerAnimate] = useState(true);

    useEffect(() => {
        if (recentPRs.length <= PR_VISIBLE) { setPrBannerIndex(0); return; }
        const id = setInterval(() => {
            setPrBannerIndex((i) => i + 1);
        }, 2500);
        return () => clearInterval(id);
    }, [recentPRs.length]);

    // 끝(원본 길이 만큼 진행)에 도달하면 transition 끄고 0으로 점프 → 무한 루프 효과
    useEffect(() => {
        if (recentPRs.length <= PR_VISIBLE) return;
        if (prBannerIndex !== recentPRs.length) return;
        const t = setTimeout(() => {
            setPrBannerAnimate(false);
            setPrBannerIndex(0);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setPrBannerAnimate(true));
            });
        }, 550);
        return () => clearTimeout(t);
    }, [prBannerIndex, recentPRs.length]);

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
                const result = await findStudentAcrossSheets(user.username);
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
                await createPost(formData);
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
                <header className="dashboard-header">
                    <div className="header-left">
                        <h1 className="dashboard-title">
                            환영합니다, {user.role !== 'coach' && <TierBadge tier={tierMap[user.username]} style={{ height: '20px', fontSize: '0.75rem' }} />}{user.username}님
                        </h1>
                        {user.role !== 'coach' && <GradeHero xp={myXp} onClick={() => onNavigate('ranking', 'graph')} />}
                    </div>
                    <button onClick={onLogout} className="logout-button">
                        <span>로그아웃</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                </header>

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

                {/* 이달의 PR 카드 (랭킹 진입점) */}
                <div
                    onClick={() => onNavigate('ranking')}
                    style={{
                        marginBottom: '1rem',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: '#329BE71A',
                        border: '1px solid var(--hairline)',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: recentPRs.length ? '8px' : 0 }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent-hover)', fontSize: '0.95rem' }}>🏆 이달의 PR</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--accent-hover)' }}>랭킹 보기 ›</span>
                    </div>
                    {recentPRs.length === 0 ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>최근 30일 갱신된 PR이 없습니다.</div>
                    ) : (() => {
                        const visibleCount = Math.min(PR_VISIBLE, recentPRs.length);
                        const trackItems = recentPRs.length > PR_VISIBLE
                            ? [...recentPRs, ...recentPRs.slice(0, PR_VISIBLE)]
                            : recentPRs;
                        return (
                            <div style={{ overflow: 'hidden', height: `${visibleCount * PR_LINE_HEIGHT}px` }}>
                                <div
                                    style={{
                                        transform: `translateY(-${prBannerIndex * PR_LINE_HEIGHT}px)`,
                                        transition: prBannerAnimate ? 'transform 0.5s ease' : 'none'
                                    }}
                                >
                                    {trackItems.map((p, idx) => (
                                        <div
                                            key={`${p.id}-${idx}`}
                                            style={{
                                                height: `${PR_LINE_HEIGHT}px`,
                                                lineHeight: `${PR_LINE_HEIGHT}px`,
                                                fontSize: '0.85rem',
                                                color: 'var(--text)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}
                                        >
                                            <TierBadge tier={tierMap[p.userName]} /><strong>{p.userName}</strong> — {p.exercise} {formatPRSummary(p)} <span style={{ color: 'var(--text-muted)' }}>{p.date}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>

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

            <TierChangeModal change={tierChange} onClose={() => setTierChange(null)} />

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
