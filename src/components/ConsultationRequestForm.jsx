import { useRef, useState } from 'react';
import { submitConsultation, validateConsultation } from '../services/consultationService';

export default function ConsultationRequestForm({ recruitmentMonth, requestedSlots, scheduleString, onBack, onSubmitted, onBusyChange }) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const requestId = useRef(null);
    const busy = useRef(false);
    const data = { recruitmentMonth, name, phone, message, wantsFourTimes: true, requestedSlots };
    let valid = false;
    try { validateConsultation(data); valid = true; } catch { /* 입력 중에는 전송 비활성화 */ }

    const submit = async event => {
        event.preventDefault();
        if (busy.current || !valid) return;
        busy.current = true;
        setSubmitting(true); onBusyChange?.(true); setError('');
        requestId.current ||= crypto.randomUUID();
        try {
            await submitConsultation(data, requestId.current);
            onSubmitted();
        } catch (err) {
            setError('상담 신청에 실패했습니다: ' + err.message);
        } finally {
            busy.current = false; setSubmitting(false); onBusyChange?.(false);
        }
    };

    return <form onSubmit={submit} className="reg-consult-fields">
            <p className="reg-description">주4회 상담 신청에 필요한 정보를 입력해주세요.</p>
            <p className="reg-consult-selected-times">희망 시간: <strong>{scheduleString}</strong><br />자리와 수강은 상담 후 확정됩니다.</p>
            <fieldset disabled={submitting}>
                <div className="reg-field"><label htmlFor="consult-name">이름 <span className="required">*</span></label><input id="consult-name" className="reg-input" value={name} onChange={e => setName(e.target.value)} maxLength={50} autoComplete="name" required placeholder="이름을 입력하세요" /></div>
                <div className="reg-field"><label htmlFor="consult-phone">연락처 <span className="required">*</span></label><input id="consult-phone" type="tel" className="reg-input" value={phone} onChange={e => setPhone(e.target.value)} maxLength={13} autoComplete="tel" required placeholder="010-0000-0000" /></div>
                <div className="reg-field"><label htmlFor="consult-message">상담 내용 (선택)</label><textarea id="consult-message" className="reg-input reg-textarea" value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={1000} placeholder="예: 주4회 등록을 원합니다." /></div>
            </fieldset>
            {error && <p className="recruitment-error" role="alert">{error}</p>}
            <div className="reg-consult-actions">
                <button type="button" className="reg-btn reg-btn-secondary" disabled={submitting} onClick={onBack}>이전</button>
                <button type="submit" className="reg-btn reg-btn-primary" disabled={!valid || submitting}>{submitting ? '상담 신청 중...' : '상담 신청하기'}</button>
            </div>
        </form>;
}
