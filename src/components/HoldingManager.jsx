import { useState } from 'react';
import './HoldingManager.css';

const HoldingManager = ({ user, onBack }) => {
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedPeriod, setSelectedPeriod] = useState('');
    const [reason, setReason] = useState('');
    const [holdingHistory, setHoldingHistory] = useState([
        { date: '2026-01-05', period: '4교시', reason: '개인사정', status: '승인됨' },
        { date: '2026-01-03', period: '2교시', reason: '병원', status: '승인됨' }
    ]);

    const periods = [
        { id: 1, name: '1교시', time: '10:00 ~ 11:30' },
        { id: 2, name: '2교시', time: '12:00 ~ 13:30' },
        { id: 4, name: '4교시', time: '18:00 ~ 19:30' },
        { id: 5, name: '5교시', time: '19:50 ~ 21:20' },
        { id: 6, name: '6교시', time: '21:40 ~ 23:10' },
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        if (selectedDate && selectedPeriod && reason) {
            const newHolding = {
                date: selectedDate,
                period: selectedPeriod,
                reason: reason,
                status: '대기중'
            };
            setHoldingHistory([newHolding, ...holdingHistory]);
            alert('홀딩 신청이 완료되었습니다. 승인 후 수강권 기간이 연장됩니다.');
            setSelectedDate('');
            setSelectedPeriod('');
            setReason('');
        } else {
            alert('모든 항목을 입력해주세요.');
        }
    };

    return (
        <div className="holding-container">
            <div className="holding-header">
                <button onClick={onBack} className="back-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="holding-title">홀딩 신청</h1>
            </div>

            <div className="holding-content">
                {/* 홀딩 안내 */}
                <div className="info-card">
                    <div className="info-icon">ℹ️</div>
                    <div className="info-content">
                        <h3>홀딩 기능 안내</h3>
                        <ul>
                            <li>홀딩 신청 시 해당 일수만큼 수강권 기간이 자동으로 연장됩니다.</li>
                            <li>홀딩한 자리는 다른 수강생이 임시로 사용할 수 있습니다.</li>
                            <li>홀딩은 최소 1일 전에 신청해주세요.</li>
                        </ul>
                    </div>
                </div>

                {/* 홀딩 신청 폼 */}
                <div className="holding-form-card">
                    <h2 className="form-title">새 홀딩 신청</h2>
                    <form onSubmit={handleSubmit} className="holding-form">
                        <div className="form-group">
                            <label htmlFor="date">날짜</label>
                            <input
                                id="date"
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="form-input"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="period">수업 시간</label>
                            <select
                                id="period"
                                value={selectedPeriod}
                                onChange={(e) => setSelectedPeriod(e.target.value)}
                                className="form-select"
                            >
                                <option value="">선택하세요</option>
                                {periods.map(period => (
                                    <option key={period.id} value={period.name}>
                                        {period.name} ({period.time})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="reason">사유</label>
                            <textarea
                                id="reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="홀딩 사유를 입력하세요"
                                className="form-textarea"
                                rows="3"
                            />
                        </div>

                        <button type="submit" className="submit-button">
                            <span>홀딩 신청하기</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </button>
                    </form>
                </div>

                {/* 홀딩 내역 */}
                <div className="history-card">
                    <h2 className="form-title">홀딩 신청 내역</h2>
                    <div className="history-list">
                        {holdingHistory.length === 0 ? (
                            <p className="empty-message">홀딩 신청 내역이 없습니다.</p>
                        ) : (
                            holdingHistory.map((item, index) => (
                                <div key={index} className="history-item">
                                    <div className="history-info">
                                        <div className="history-date">{item.date}</div>
                                        <div className="history-period">{item.period}</div>
                                        <div className="history-reason">{item.reason}</div>
                                    </div>
                                    <div className={`history-status ${item.status === '승인됨' ? 'approved' : 'pending'}`}>
                                        {item.status}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HoldingManager;
