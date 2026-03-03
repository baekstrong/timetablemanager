import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, getActiveWaitlistRequests, cancelWaitlistRequest, acceptWaitlistRequest } from '../services/firebaseService';
import { parseSheetDate, findStudentAcrossSheets, writeSheetData } from '../services/googleSheetsService';
import GoogleSheetsSync from './GoogleSheetsSync';
import './Dashboard.css';

const parseScheduleString = (scheduleStr) => {
    if (!scheduleStr) return [];
    const result = [];
    const matches = scheduleStr.match(/([월화수목금토일])(\d)/g);
    if (matches) {
        matches.forEach(m => {
            result.push({ day: m[0], period: parseInt(m[1]) });
        });
    }
    return result;
};

const Dashboard = ({ user, onNavigate, onLogout }) => {
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sheetsExpanded, setSheetsExpanded] = useState(false);

    const { students, isConnected, error: sheetsError, loading: sheetsLoading, refresh } = useGoogleSheets();

    // 수강생 대기 신청 목록
    const [studentWaitlist, setStudentWaitlist] = useState([]);

    useEffect(() => {
        if (user.role === 'coach') return;
        const loadWaitlist = async () => {
            try {
                const waitlist = await getActiveWaitlistRequests(user.username);
                setStudentWaitlist(waitlist);
            } catch (err) {
                console.error('대기 목록 로드 실패:', err);
            }
        };
        loadWaitlist();
    }, [user]);

    // 수강생 모드: 본인의 종료날짜 확인
    const [isMyLastDay, setIsMyLastDay] = useState(false);

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
                            setIsMyLastDay(endDate.getTime() === today.getTime());
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to check last day:', err);
            }
        };
        checkMyLastDay();
    }, [user]);

    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [editingNotice, setEditingNotice] = useState(null);
    const [formData, setFormData] = useState({ title: '', content: '', important: false });
    const [submitting, setSubmitting] = useState(false);

    // Load announcements on mount
    useEffect(() => {
        loadAnnouncements();
    }, []);

    const loadAnnouncements = async () => {
        try {
            setLoading(true);
            const data = await getAnnouncements();
            setNotices(data);
        } catch (error) {
            console.error('Failed to load announcements:', error);
        } finally {
            setLoading(false);
        }
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

            const sheetName = studentEntry._foundSheetName;
            const rowIndex = studentEntry._rowIndex;
            const actualRow = rowIndex + 3;
            const currentSchedule = studentEntry['요일 및 시간'];

            const parsed = parseScheduleString(currentSchedule);
            const updated = parsed.map(s => {
                if (s.day === currentSlot.day && s.period === currentSlot.period) {
                    return { day: desiredSlot.day, period: desiredSlot.period };
                }
                return s;
            });
            const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
            updated.sort((a, b) => (dayOrder[a.day] || 0) - (dayOrder[b.day] || 0) || a.period - b.period);
            const newSchedule = updated.map(s => `${s.day}${s.period}`).join('');

            const range = `${sheetName}!D${actualRow}`;
            await writeSheetData(range, [[newSchedule]]);
            await acceptWaitlistRequest(waitlistItem.id);

            alert(`시간표 변경 완료!\n${currentSchedule} → ${newSchedule}`);
            await refresh();
            const waitlist = await getActiveWaitlistRequests(user.username);
            setStudentWaitlist(waitlist);
        } catch (error) {
            alert(`시간표 변경 실패: ${error.message}`);
            console.error('시간표 변경 실패:', error);
        }
    };

    // Open create modal
    const handleCreate = () => {
        setEditingNotice(null);
        setFormData({ title: '', content: '', important: false });
        setShowModal(true);
    };

    // Open edit modal
    const handleEdit = (notice) => {
        setEditingNotice(notice);
        setFormData({
            title: notice.title,
            content: notice.content,
            important: notice.important
        });
        setShowModal(true);
    };

    // Delete announcement
    const handleDelete = async (notice) => {
        if (!confirm(`"${notice.title}" 공지를 삭제하시겠습니까?`)) return;

        try {
            await deleteAnnouncement(notice.id);
            await loadAnnouncements();
        } catch (error) {
            alert('삭제 실패: ' + error.message);
        }
    };

    // Submit form
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.title.trim() || !formData.content.trim()) {
            alert('제목과 내용을 입력해주세요.');
            return;
        }

        setSubmitting(true);
        try {
            if (editingNotice) {
                await updateAnnouncement(editingNotice.id, formData);
            } else {
                await createAnnouncement(formData.title, formData.content, formData.important);
            }
            setShowModal(false);
            await loadAnnouncements();
        } catch (error) {
            alert('저장 실패: ' + error.message);
        } finally {
            setSubmitting(false);
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
                        <p className="dashboard-subtitle">
                            {user.role === 'coach' ? '코치 대시보드' : '수강생 대시보드'}
                        </p>
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

                {/* 공지사항 섹션 */}
                <section className="notices-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 className="section-title" style={{ marginBottom: 0 }}>
                            <span className="title-icon">📢</span>
                            공지사항
                        </h2>
                        {user.role === 'coach' && (
                            <button
                                onClick={handleCreate}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem'
                                }}
                            >
                                ➕ 공지 작성
                            </button>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                            공지사항을 불러오는 중...
                        </div>
                    ) : notices.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                            등록된 공지사항이 없습니다.
                        </div>
                    ) : (
                        <div className="notices-grid">
                            {notices.map(notice => (
                                <div key={notice.id} className={`notice-card ${notice.important ? 'important' : ''}`}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1 }}>
                                            {notice.important && <span className="important-badge">중요</span>}
                                            <h3 className="notice-title">{notice.title}</h3>
                                        </div>
                                        {user.role === 'coach' && (
                                            <div style={{ display: 'flex', gap: '0.3rem', marginLeft: '0.5rem' }}>
                                                <button
                                                    onClick={() => handleEdit(notice)}
                                                    style={{
                                                        padding: '0.3rem 0.5rem',
                                                        background: '#f0f0f0',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem'
                                                    }}
                                                    title="수정"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(notice)}
                                                    style={{
                                                        padding: '0.3rem 0.5rem',
                                                        background: '#fee2e2',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem'
                                                    }}
                                                    title="삭제"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <p className="notice-content">{notice.content}</p>
                                    <span className="notice-date">{notice.date}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

            </div>

            {/* 공지사항 작성/수정 모달 */}
            {showModal && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 1000
                    }}
                >
                    <div
                        style={{
                            background: 'white',
                            borderRadius: '12px',
                            padding: '1.5rem',
                            width: '90%',
                            maxWidth: '500px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>
                            📢 {editingNotice ? '공지사항 수정' : '공지사항 작성'}
                        </h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600' }}>
                                    제목
                                </label>
                                <input
                                    type="text"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid #ddd',
                                        borderRadius: '8px',
                                        fontSize: '1rem',
                                        boxSizing: 'border-box'
                                    }}
                                    placeholder="공지사항 제목"
                                />
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: '600' }}>
                                    내용
                                </label>
                                <textarea
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid #ddd',
                                        borderRadius: '8px',
                                        fontSize: '1rem',
                                        minHeight: '120px',
                                        resize: 'vertical',
                                        boxSizing: 'border-box'
                                    }}
                                    placeholder="공지사항 내용을 입력하세요"
                                />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.important}
                                        onChange={(e) => setFormData({ ...formData, important: e.target.checked })}
                                        style={{ width: '18px', height: '18px' }}
                                    />
                                    <span style={{ fontWeight: '600', color: '#dc2626' }}>중요 공지사항으로 설정</span>
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#f0f0f0',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '1rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    취소
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        cursor: submitting ? 'not-allowed' : 'pointer',
                                        opacity: submitting ? 0.7 : 1
                                    }}
                                >
                                    {submitting ? '저장 중...' : (editingNotice ? '수정하기' : '작성하기')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
