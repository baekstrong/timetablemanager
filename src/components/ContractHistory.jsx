import { useState, useEffect } from 'react';
import { getContractHistory, cancelContract } from '../services/firebaseService';
import './ContractHistory.css';

const formatYYMMDD = (yymmdd) => {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd || '-';
    return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
};

const formatTimestamp = (ts) => {
    if (!ts) return '-';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const STATUS_MAP = {
    pending: { label: '대기', className: 'pending' },
    agreed: { label: '완료', className: 'agreed' },
    cancelled: { label: '취소', className: 'cancelled' }
};

const ContractHistory = ({ studentName, isCoach, onClose }) => {
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getContractHistory(studentName);
                setContracts(data);
            } catch (err) {
                console.error('계약 이력 로드 실패:', err);
            }
            setLoading(false);
        };
        load();
    }, [studentName]);

    const handleCancel = async (contractId) => {
        if (!confirm('이 계약을 취소하시겠습니까?')) return;
        try {
            await cancelContract(contractId);
            setContracts(prev => prev.map(c =>
                c.id === contractId ? { ...c, status: 'cancelled' } : c
            ));
        } catch (err) {
            alert('취소 실패: ' + err.message);
        }
    };

    return (
        <div className="ch-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="ch-modal">
                <div className="ch-header">
                    <h2 className="ch-title">{studentName} - 계약 이력</h2>
                    <button className="ch-close-btn" onClick={onClose}>X</button>
                </div>

                <div className="ch-body">
                    {loading ? (
                        <div className="ch-loading">로딩 중...</div>
                    ) : contracts.length === 0 ? (
                        <div className="ch-empty">계약 이력이 없습니다.</div>
                    ) : (
                        contracts.map(c => {
                            const status = STATUS_MAP[c.status] || STATUS_MAP.pending;
                            const rd = c.registrationData || {};
                            const isExpanded = expandedId === c.id;

                            return (
                                <div key={c.id} className="ch-item">
                                    <div
                                        className="ch-item-header"
                                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                    >
                                        <span className={`ch-status-badge ${status.className}`}>
                                            {status.label}
                                        </span>
                                        <div className="ch-item-summary">
                                            <span className="ch-item-schedule">
                                                주{rd.주횟수}회 | {rd['요일 및 시간']}
                                            </span>
                                            <span className="ch-item-period">
                                                {formatYYMMDD(rd.시작날짜)} ~ {formatYYMMDD(rd.종료날짜)}
                                            </span>
                                        </div>
                                        <span className="ch-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                                    </div>

                                    {isExpanded && (
                                        <div className="ch-item-detail">
                                            <div className="ch-detail-row">
                                                <span>등록기간</span>
                                                <span>{rd.등록개월수 || '1'}개월</span>
                                            </div>
                                            <div className="ch-detail-row">
                                                <span>결제금액</span>
                                                <span>{rd.결제금액 ? `${Number(rd.결제금액).toLocaleString()}원` : '-'}</span>
                                            </div>
                                            <div className="ch-detail-row">
                                                <span>결제방식</span>
                                                <span>{rd.결제방식 || '-'}</span>
                                            </div>
                                            <div className="ch-detail-row">
                                                <span>생성일</span>
                                                <span>{formatTimestamp(c.createdAt)}</span>
                                            </div>
                                            {c.agreedAt && (
                                                <div className="ch-detail-row">
                                                    <span>동의일</span>
                                                    <span>{formatTimestamp(c.agreedAt)}</span>
                                                </div>
                                            )}
                                            {isCoach && c.status === 'pending' && (
                                                <button
                                                    className="ch-cancel-btn"
                                                    onClick={() => handleCancel(c.id)}
                                                >
                                                    계약 취소
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default ContractHistory;
