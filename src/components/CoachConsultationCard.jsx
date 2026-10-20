import { useState } from 'react';
import { completeConsultation, deleteConsultation } from '../services/consultationService';
import { monthLabel } from '../utils/recruitment';

export default function CoachConsultationCard({ request, onUpdated }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const act = async remove => {
        if (busy || (remove && !confirm(`"${request.name}" 상담 요청을 삭제하시겠습니까?`))) return;
        setBusy(true); setError('');
        try {
            if (remove) await deleteConsultation(request.id);
            else await completeConsultation(request.id);
            await onUpdated();
        } catch (err) { setError('상담 요청 처리에 실패했습니다: ' + err.message); }
        finally { setBusy(false); }
    };
    return <article className="cns-reg-card">
        <div className="cns-reg-card-header"><div className="cns-reg-main"><strong className="cns-reg-name">{request.name}</strong><span className="cns-badge consult">{request.status === 'completed' ? '상담 완료' : '상담 요청'}</span></div>
            <span className="cns-badge entrance">{monthLabel(request.recruitmentMonth)}</span></div>
        <div className="cns-reg-detail">
            {request.wantsFourTimes && <p className="cns-four-times-request">주4회 등록 원함</p>}
            <div className="cns-detail-grid"><div className="cns-detail-item"><span className="cns-detail-label">연락처</span><a className="cns-detail-value" href={`tel:${request.phone}`}>{request.phone}</a></div>
                {request.message && <div className="cns-detail-item full"><span className="cns-detail-label">상담 내용</span><span className="cns-detail-value cns-consult-message">{request.message}</span></div>}
            </div>
            {error && <p role="alert">{error}</p>}
            <div className="cns-action-row"><button className="cns-action-btn delete" disabled={busy} onClick={() => act(true)}>삭제</button>{request.status === 'pending' && <button className="cns-action-btn approve" disabled={busy} onClick={() => act(false)}>상담 완료</button>}</div>
        </div>
    </article>;
}
