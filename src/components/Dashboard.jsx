import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { createPost, subscribePosts, updatePost, deletePost, getActiveWaitlistRequests, cancelWaitlistRequest, acceptWaitlistRequest, getPendingContractForStudent, getMakeupRequestsByWeek, getHolidays } from '../services/firebaseService';
import { parseSheetDate, findStudentAcrossSheets, processScheduleTransfer } from '../services/googleSheetsService';
import { buildUpdatedSchedule } from '../utils/scheduleUtils';
import GoogleSheetsSync from './GoogleSheetsSync';
import { POST_LIMITS } from '../data/boardConstants';
import PostList from './board/PostList';
import PostDetail from './board/PostDetail';
import PostForm from './board/PostForm';
import './board/Board.css';
import './Dashboard.css';

const Dashboard = ({ user, onNavigate, onLogout }) => {
    const [sheetsExpanded, setSheetsExpanded] = useState(false);
    const [posts, setPosts] = useState([]);
    const [postsLoading, setPostsLoading] = useState(true);
    const [postsError, setPostsError] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [boardPage, setBoardPage] = useState(1);
    const [viewMode, setViewMode] = useState('list');
    const [selectedPostId, setSelectedPostId] = useState(null);
    const [showPostForm, setShowPostForm] = useState(false);
    const [editingPost, setEditingPost] = useState(null);

    const { students, isConnected, error: sheetsError, loading: sheetsLoading, refresh } = useGoogleSheets();

    // 수강생 대기 신청 목록
    const [studentWaitlist, setStudentWaitlist] = useState([]);
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

    // 실시간 게시글 구독
    useEffect(() => {
        setPostsLoading(true);
        setPostsError(null);
        const unsubscribe = subscribePosts(selectedCategory, POST_LIMITS.FETCH_LIMIT, (data) => {
            setPosts(data);
            setPostsLoading(false);
        });
        return () => unsubscribe();
    }, [selectedCategory]);

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
        const { currentSlot, desiredSlot } = waitlistItem;
        if (!confirm(
            `${desiredSlot.day}요일 ${desiredSlot.periodName}에 자리가 났습니다!\n\n` +
            `시간표를 변경하시겠습니까?\n` +
            `${currentSlot.day}요일 ${currentSlot.periodName} → ${desiredSlot.day}요일 ${desiredSlot.periodName}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        try {
            const studentEntry = students.find(s => s['이름'] === user.username && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const currentSchedule = studentEntry['요일 및 시간'];
            const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, desiredSlot);

            const firebaseHolidays = await getHolidays().catch(() => []);
            const result = await processScheduleTransfer(user.username, newSchedule, firebaseHolidays);
            await acceptWaitlistRequest(waitlistItem.id);

            alert(`시간표 변경 완료!\n${currentSchedule} → ${newSchedule}\n새 종료일: ${result.newEndDate}`);
            await refresh();
            const waitlist = await getActiveWaitlistRequests(user.username);
            setStudentWaitlist(waitlist);
        } catch (error) {
            alert(`시간표 변경 실패: ${error.message}`);
            console.error('시간표 변경 실패:', error);
        }
    };

    return (
        <div className="dashboard-container">
            <div className="dashboard-background">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
            </div>

            <div className="dashboard-content">
                <header className="dashboard-header">
                    <div className="header-left">
                        <h1 className="dashboard-title">환영합니다, {user.username}님</h1>
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
                        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                        border: '1px solid #f59e0b',
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
                        background: 'linear-gradient(135deg, #fee2e2, #fecaca)',
                        border: '1px solid #ef4444',
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

                {/* Google Sheets 연동 (접기/펴기) */}
                {user.role === 'coach' && (
                    <section style={{ marginBottom: '1rem' }}>
                        <div
                            onClick={() => setSheetsExpanded(!sheetsExpanded)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem 1rem',
                                background: 'rgba(255,255,255,0.8)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                userSelect: 'none',
                                border: '1px solid #e5e7eb'
                            }}
                        >
                            <span style={{ fontSize: '0.9rem' }}>{sheetsExpanded ? '▼' : '▶'}</span>
                            <span style={{ fontWeight: '600', fontSize: '1rem' }}>Google Sheets 연동</span>
                            {sheetsLoading ? (
                                <span style={{ fontSize: '0.85rem', color: '#666', marginLeft: '0.5rem' }}>동기화 중...</span>
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
                                        onClick={() => onNavigate('test')}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            transition: 'transform 0.2s'
                                        }}
                                        onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
                                        onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
                                    >
                                        🧪 Google Sheets 연동 테스트
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {/* 코치 전용: 휴일설정 버튼 */}
                {user.role === 'coach' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <button
                            onClick={() => onNavigate('holidays')}
                            style={{
                                width: '100%',
                                padding: '0.75rem 1rem',
                                background: 'rgba(255,255,255,0.8)',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: '#374151'
                            }}
                        >
                            <span>🗓️</span>
                            <span>휴일설정</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '16px', height: '16px', marginLeft: 'auto', color: '#9ca3af' }}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* 수강생 재등록 계약 배너 */}
                {user.role !== 'coach' && pendingContract && (
                    <div style={{
                        margin: '0 0 1rem 0',
                        padding: '14px 16px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                        border: '1.5px solid #f59e0b',
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
                                    {w.status === 'notified' && (
                                        <>
                                            <button
                                                onClick={() => handleWaitlistAccept(w)}
                                                style={{
                                                    padding: '4px 10px',
                                                    fontSize: '0.8rem',
                                                    backgroundColor: '#22c55e',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontWeight: 'bold'
                                                }}
                                            >승인</button>
                                            <button
                                                onClick={() => handleWaitlistCancel(w.id)}
                                                style={{
                                                    padding: '4px 8px',
                                                    fontSize: '0.8rem',
                                                    backgroundColor: '#fee2e2',
                                                    color: '#dc2626',
                                                    border: '1px solid #dc2626',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontWeight: 'bold'
                                                }}
                                            >거절</button>
                                        </>
                                    )}
                                    {w.status === 'waiting' && (
                                        <button
                                            onClick={() => handleWaitlistCancel(w.id)}
                                            style={{
                                                padding: '4px 8px',
                                                fontSize: '0.8rem',
                                                backgroundColor: 'transparent',
                                                color: '#b45309',
                                                border: '1px solid #d97706',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >취소</button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 게시판 섹션 */}
                {viewMode === 'list' ? (
                    <PostList
                        posts={posts}
                        loading={postsLoading}
                        error={postsError}
                        user={user}
                        selectedCategory={selectedCategory}
                        onCategoryChange={handleCategoryChange}
                        onPostClick={handlePostClick}
                        onWriteClick={() => { setEditingPost(null); setShowPostForm(true); }}
                        onRetry={() => loadPosts()}
                        currentPage={boardPage}
                        onPageChange={setBoardPage}
                    />
                ) : (
                    <PostDetail
                        postId={selectedPostId}
                        user={user}
                        onBack={handleBackToList}
                        onEdit={handleEditPost}
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
        </div>
    );
};

export default Dashboard;
