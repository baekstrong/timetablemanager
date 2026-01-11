import { useState } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import GoogleSheetsSync from './GoogleSheetsSync';
import './Dashboard.css';

const Dashboard = ({ user, onNavigate, onLogout }) => {
    const [notices] = useState([
        {
            id: 1,
            title: '무제한 수강권 안내',
            content: '무제한 수강권은 구매일로부터 30일간 사용 가능합니다. 홀딩 기능을 통해 기간을 연장할 수 있습니다.',
            date: '2026-01-09',
            important: true
        },
        {
            id: 2,
            title: '홀딩 신청 방법',
            content: '시간표에서 본인의 수업을 클릭하여 홀딩을 신청할 수 있습니다. 홀딩 시 해당 일수만큼 수강권 기간이 연장됩니다.',
            date: '2026-01-08',
            important: false
        },
        {
            id: 3,
            title: '보강 수업 신청',
            content: '다른 수강생의 홀딩으로 빈 자리가 생기면 임시로 수강 신청이 가능합니다.',
            date: '2026-01-07',
            important: false
        }
    ]);

    const menuItems = user.role === 'coach'
        ? [
            { id: 'schedule', title: '시간표 관리', icon: '📅', description: '수강생 출석 현황 및 시간표 확인' },
            { id: 'students', title: '수강생 관리', icon: '👥', description: '수강생 정보 및 수강권 현황' },
            { id: 'training', title: '훈련일지', icon: '📝', description: '수강생별 훈련 기록 관리' }
        ]
        : [
            { id: 'schedule', title: '시간표 조회', icon: '📅', description: '내 시간표 및 보강 신청' },
            { id: 'myinfo', title: '내 정보', icon: '👤', description: '수강권 현황 및 출석 기록' },
            { id: 'holding', title: '홀딩 신청', icon: '⏸️', description: '수업 홀딩 및 기간 연장' }
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
                {user.role === 'coach' && <GoogleSheetsSync />}

                {/* 공지사항 섹션 */}
                <section className="notices-section">
                    <h2 className="section-title">
                        <span className="title-icon">📢</span>
                        공지사항
                    </h2>
                    <div className="notices-grid">
                        {notices.map(notice => (
                            <div key={notice.id} className={`notice-card ${notice.important ? 'important' : ''}`}>
                                {notice.important && <span className="important-badge">중요</span>}
                                <h3 className="notice-title">{notice.title}</h3>
                                <p className="notice-content">{notice.content}</p>
                                <span className="notice-date">{notice.date}</span>
                            </div>
                        ))}
                    </div>
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
                                onClick={() => onNavigate(item.id)}
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
        </div>
    );
};

export default Dashboard;
