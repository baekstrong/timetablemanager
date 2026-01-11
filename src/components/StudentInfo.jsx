import { useState } from 'react';
import { STUDENT_MEMBERSHIPS, calculateDaysRemaining, isExpiringSoon, isExpired } from '../data/mockData';
import './StudentInfo.css';

const StudentInfo = ({ user, onBack }) => {
    // Simulate current user's membership info
    const [membershipInfo] = useState({
        studentName: user.username,
        startDate: '2025-12-20',
        endDate: '2026-01-19',
        daysRemaining: 10,
        totalHoldingDays: 2,
        attendanceCount: 18,
        totalClasses: 24
    });

    const [attendanceHistory] = useState([
        { date: '2026-01-08', period: '4교시', type: '정규', status: '출석' },
        { date: '2026-01-07', period: '2교시', type: '정규', status: '출석' },
        { date: '2026-01-06', period: '4교시', type: '보강', status: '출석' },
        { date: '2026-01-05', period: '2교시', type: '정규', status: '홀딩' },
        { date: '2026-01-03', period: '4교시', type: '정규', status: '출석' },
    ]);

    const getStatusColor = (status) => {
        switch (status) {
            case '출석': return 'attended';
            case '홀딩': return 'holding';
            case '결석': return 'absent';
            default: return '';
        }
    };

    const attendanceRate = ((membershipInfo.attendanceCount / membershipInfo.totalClasses) * 100).toFixed(1);

    return (
        <div className="student-info-container">
            <div className="student-info-header">
                <button onClick={onBack} className="back-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="student-info-title">내 정보</h1>
            </div>

            <div className="student-info-content">
                {/* 수강권 정보 카드 */}
                <div className="membership-card">
                    <div className="card-header">
                        <h2>무제한 수강권</h2>
                        {isExpiringSoon(membershipInfo.daysRemaining) && (
                            <span className="warning-badge">⚠️ 만료 임박</span>
                        )}
                        {isExpired(membershipInfo.daysRemaining) && (
                            <span className="expired-badge">❌ 만료됨</span>
                        )}
                    </div>

                    <div className="membership-details">
                        <div className="detail-row">
                            <span className="detail-label">수강생</span>
                            <span className="detail-value">{membershipInfo.studentName}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">시작일</span>
                            <span className="detail-value">{membershipInfo.startDate}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">종료일</span>
                            <span className="detail-value highlight">{membershipInfo.endDate}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">남은 기간</span>
                            <span className={`detail-value ${isExpiringSoon(membershipInfo.daysRemaining) ? 'warning' : ''}`}>
                                {membershipInfo.daysRemaining}일
                            </span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">총 홀딩 일수</span>
                            <span className="detail-value">{membershipInfo.totalHoldingDays}일</span>
                        </div>
                    </div>

                    {/* 진행률 바 */}
                    <div className="progress-section">
                        <div className="progress-header">
                            <span>수강권 사용 기간</span>
                            <span>{membershipInfo.daysRemaining}일 남음</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${Math.max(0, Math.min(100, ((30 - membershipInfo.daysRemaining) / 30) * 100))}%`,
                                    background: isExpiringSoon(membershipInfo.daysRemaining)
                                        ? 'linear-gradient(90deg, #f093fb 0%, #f5576c 100%)'
                                        : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
                                }}
                            />
                        </div>
                    </div>

                    {isExpiringSoon(membershipInfo.daysRemaining) && (
                        <div className="alert-box warning">
                            <span className="alert-icon">⚠️</span>
                            <div className="alert-content">
                                <strong>수강권 만료 임박</strong>
                                <p>수강권이 {membershipInfo.daysRemaining}일 후 만료됩니다. 연장을 원하시면 문의해주세요.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* 출석 통계 카드 */}
                <div className="stats-card">
                    <h2>출석 통계</h2>
                    <div className="stats-grid">
                        <div className="stat-item">
                            <div className="stat-icon">📊</div>
                            <div className="stat-info">
                                <div className="stat-value">{attendanceRate}%</div>
                                <div className="stat-label">출석률</div>
                            </div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">✅</div>
                            <div className="stat-info">
                                <div className="stat-value">{membershipInfo.attendanceCount}</div>
                                <div className="stat-label">출석</div>
                            </div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">📚</div>
                            <div className="stat-info">
                                <div className="stat-value">{membershipInfo.totalClasses}</div>
                                <div className="stat-label">총 수업</div>
                            </div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">⏸️</div>
                            <div className="stat-info">
                                <div className="stat-value">{membershipInfo.totalHoldingDays}</div>
                                <div className="stat-label">홀딩</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 출석 내역 카드 */}
                <div className="attendance-card">
                    <h2>최근 출석 내역</h2>
                    <div className="attendance-list">
                        {attendanceHistory.map((record, index) => (
                            <div key={index} className="attendance-item">
                                <div className="attendance-date">{record.date}</div>
                                <div className="attendance-period">{record.period}</div>
                                <div className="attendance-type">{record.type}</div>
                                <div className={`attendance-status ${getStatusColor(record.status)}`}>
                                    {record.status}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StudentInfo;
