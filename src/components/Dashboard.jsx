import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../services/firebaseService';
import GoogleSheetsSync from './GoogleSheetsSync';
import './Dashboard.css';

const Dashboard = ({ user, onNavigate, onLogout }) => {
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);

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

    const menuItems = user.role === 'coach'
        ? [
            { id: 'schedule', title: '시간표 관리', icon: '📅', description: '수강생 출석 현황 및 시간표 확인' },
            { id: 'students', title: '수강생 관리', icon: '👥', description: '수강생 정보 및 수강권 현황' },
            { id: 'holidays', title: '휴일 설정', icon: '🗓️', description: '휴가, 휴무일 설정 (종료일 반영)' },
            { id: 'training', title: '훈련일지', icon: '📝', description: '수강생별 훈련 기록 관리' }
        ]
        : [
            { id: 'schedule', title: '시간표 조회', icon: '📅', description: '내 시간표 및 보강 신청' },
            { id: 'myinfo', title: '내 정보', icon: '👤', description: '수강권 현황 및 출석 기록' },
            { id: 'holding', title: '홀딩 및 결석 신청', icon: '⏸️', description: '수업 홀딩 및 결석 신청' },
            { id: 'training', title: '훈련일지', icon: '📝', description: '나의 운동 기록 관리' }
        ];

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

                {/* Google Sheets 연동 */}
                {user.role === 'coach' && (
                    <>
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
                    </>
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

                {/* 메뉴 섹션 */}
                <section className="menu-section">
                    <h2 className="section-title">
                        <span className="title-icon">🎯</span>
                        주요 기능
                    </h2>
                    <div className="menu-grid">
                        {menuItems.map(item => (
                            <div
                                key={item.id}
                                className="menu-card"
                                onClick={() => {
                                    if (item.id === 'training') {
                                        // Navigate to internal training log (integrated in public folder)
                                        // Same domain allows sharing localStorage automatically
                                        // Use relative path to work with GitHub Pages base URL
                                        window.location.href = './training-log/index.html';
                                    } else {
                                        onNavigate(item.id);
                                    }
                                }}
                            >
                                <div className="menu-icon">{item.icon}</div>
                                <h3 className="menu-title">{item.title}</h3>
                                <p className="menu-description">{item.description}</p>
                                <div className="menu-arrow">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                    </svg>
                                </div>
                            </div>
                        ))}
                    </div>
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
                    onClick={() => setShowModal(false)}
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
