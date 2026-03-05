import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
// isExpiringSoon, isExpired 사용하지 않음 - 추후 필요시 복원
import { getActiveMakeupRequest, getHoldingHistory } from '../services/firebaseService';
import './StudentInfo.css';

const StudentInfo = ({ user, studentData, onBack }) => {
    const { calculateMembershipStats, generateAttendanceHistory } = useGoogleSheets();
    const [makeupRequest, setMakeupRequest] = useState(null);
    const [holdingHistory, setHoldingHistory] = useState([]);

    // Firebase에서 보강 신청 + 홀딩 이력 로드
    useEffect(() => {
        const loadData = async () => {
            if (!user) return;
            try {
                const [makeup, holdings] = await Promise.all([
                    getActiveMakeupRequest(user.username),
                    getHoldingHistory(user.username)
                ]);
                setMakeupRequest(makeup);
                setHoldingHistory(holdings.filter(h => h.status !== 'cancelled'));
            } catch (error) {
                console.error('데이터 조회 실패:', error);
            }
        };
        loadData();
    }, [user]);

    // 구글 시트 데이터로부터 수강권 정보 계산
    const membershipInfo = useMemo(() => {
        if (!studentData) {
            // 구글 시트 데이터가 없는 경우 목 데이터 사용 (폴백)
            return {
                studentName: user.username,
                startDate: '2025-12-20',
                endDate: '2026-01-19',
                weeklyFrequency: 2,
                totalSessions: 8,
                completedSessions: 0,
                remainingSessions: 8,
                remainingHolding: 1,
                totalHolding: 1,
                usedHolding: 0,
                registrationMonths: 1,
                attendanceCount: 0,
                totalClasses: 8
            };
        }

        return calculateMembershipStats(studentData);
    }, [studentData, user.username, calculateMembershipStats]);

    // 출석 내역 생성 (보강 데이터 반영)
    const attendanceHistory = useMemo(() => {
        if (!studentData) {
            // 폴백: 목 데이터
            return [
                { date: '2026-01-08', period: '4교시', type: '정규', status: '출석' },
                { date: '2026-01-07', period: '2교시', type: '정규', status: '출석' },
            ];
        }

        // 구글 시트에서 출석 내역 생성
        let history = generateAttendanceHistory(studentData);

        // 보강 신청이 있으면 출석 내역 수정
        if (makeupRequest && makeupRequest.status === 'active') {
            const originalDate = makeupRequest.originalClass.date;
            const makeupDate = makeupRequest.makeupClass.date;
            const makeupPeriod = `${makeupRequest.makeupClass.period}교시`;

            // 원래 수업일 찾아서 상태 변경
            history = history.map(record => {
                if (record.date === originalDate) {
                    return {
                        ...record,
                        status: '보강변경',
                        type: '정규→보강'
                    };
                }
                return record;
            });

            // 보강 날짜가 오늘 이전이면 출석 내역에 추가
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const makeupDateObj = new Date(makeupDate + 'T00:00:00');

            if (makeupDateObj <= today) {
                // 이미 같은 날짜의 보강 기록이 있는지 확인
                const existingMakeup = history.find(r => r.date === makeupDate && r.type === '보강');
                if (!existingMakeup) {
                    history.push({
                        date: makeupDate,
                        period: makeupPeriod,
                        type: '보강',
                        status: '출석'
                    });
                }
            }

            // 다시 날짜순 정렬 (최신순)
            history.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                return dateB - dateA;
            });

            // 상위 10개만 반환
            history = history.slice(0, 10);
        }

        return history;
    }, [studentData, generateAttendanceHistory, makeupRequest]);

    const getStatusColor = (status) => {
        switch (status) {
            case '출석': return 'attended';
            case '홀딩': return 'holding';
            case '결석': return 'absent';
            case '보강변경': return 'makeup-changed';
            default: return '';
        }
    };

    const attendanceRate = membershipInfo.totalClasses > 0
        ? Math.min(100, (membershipInfo.attendanceCount / membershipInfo.totalClasses) * 100).toFixed(1)
        : '0.0';

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
                        <h2>수강 정보</h2>
                        {membershipInfo.remainingSessions <= 2 && membershipInfo.remainingSessions > 0 && (
                            <span className="warning-badge">⚠️ 만료 임박</span>
                        )}
                        {membershipInfo.remainingSessions === 0 && membershipInfo.endDate && new Date(membershipInfo.endDate) < new Date() && (
                            <span className="expired-badge">❌ 만료됨</span>
                        )}
                    </div>

                    <div className="membership-details">
                        <div className="detail-row">
                            <span className="detail-label">수강생</span>
                            <span className="detail-value">{membershipInfo.studentName}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">주횟수</span>
                            <span className="detail-value">주 {membershipInfo.weeklyFrequency}회</span>
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
                            <span className="detail-label">남은 횟수</span>
                            <span className={`detail-value ${membershipInfo.remainingSessions <= 2 ? 'warning' : ''}`}>
                                {membershipInfo.remainingSessions}회
                            </span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">홀딩</span>
                            <span className="detail-value">
                                {membershipInfo.remainingHolding}회 남음
                                {membershipInfo.registrationMonths > 1 && (
                                    <span style={{ fontSize: '0.85em', color: '#6b7280', marginLeft: '8px' }}>
                                        ({membershipInfo.registrationMonths}개월 등록)
                                    </span>
                                )}
                            </span>
                        </div>
                        {/* 홀딩 사용 기간 표시 (Firebase 이력, 취소 제외) */}
                        {holdingHistory.length > 0 && (
                            <div className="holding-periods">
                                <span className="detail-label" style={{ marginBottom: '4px', display: 'block' }}>홀딩 사용 기간</span>
                                {holdingHistory.map((h, idx) => (
                                    <div key={h.id || idx} className="holding-period-item">
                                        <span className="holding-status-dot completed" />
                                        <span className="holding-period-dates">
                                            {h.startDate} ~ {h.endDate}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 진행률 바 */}
                    <div className="progress-section">
                        <div className="progress-header">
                            <span>수업 진행률</span>
                            <span>{membershipInfo.remainingSessions}회 남음</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${Math.max(0, Math.min(100, ((membershipInfo.totalSessions - membershipInfo.remainingSessions) / membershipInfo.totalSessions) * 100))}%`,
                                    background: membershipInfo.remainingSessions <= 2
                                        ? 'linear-gradient(90deg, #f093fb 0%, #f5576c 100%)'
                                        : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
                                }}
                            />
                        </div>
                    </div>

                    {membershipInfo.remainingSessions <= 2 && membershipInfo.remainingSessions > 0 && (
                        <div className="alert-box warning">
                            <span className="alert-icon">⚠️</span>
                            <div className="alert-content">
                                <strong>수강권 만료 임박</strong>
                                <p>수강권이 {membershipInfo.remainingSessions}회 남았습니다. 연장을 원하시면 문의해주세요.</p>
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
                                <div className="stat-value">{membershipInfo.remainingHolding}회</div>
                                <div className="stat-label">남은 홀딩</div>
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
                                <div className={`attendance-type ${record.type === '보강' ? 'makeup' : ''}`}>{record.type}</div>
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
