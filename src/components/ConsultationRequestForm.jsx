import { useRef, useState } from 'react';
import { submitConsultation, validateConsultation } from '../services/consultationService';

export default function ConsultationRequestForm({ recruitmentMonth, selected, onSelectionChange, onSubmitted, onBusyChange }) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState('');
    const [wantsFourTimes, setWantsFourTimes] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const requestId = useRef(null);
    const busy = useRef(false);
    const data = { recruitmentMonth, name, phone, message, wantsFourTimes };
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

    return <div className={`reg-consult-request ${selected ? 'selected' : ''}`}>
        <label className="reg-consult-check">
            <input type="checkbox" checked={selected} disabled={submitting} onChange={e => onSelectionChange(e.target.checked)} />
            <span><strong>상담 신청하기</strong><small>수강 횟수가 고민되거나, 주4회 수강을 원하시면 먼저 상담을 신청해주세요.</small></span>
        </label>
        {selected && <form onSubmit={submit} className="reg-consult-fields">
            <p className="reg-description">수업 횟수와 시간표는 상담 후 정합니다.<br />연락받을 정보를 남겨주세요.</p>
            <fieldset disabled={submitting}>
                <label className="reg-consult-check reg-four-times-check"><input type="checkbox" checked={wantsFourTimes} onChange={e => setWantsFourTimes(e.target.checked)} /><span>주4회 등록을 원합니다</span></label>
                <div className="reg-field"><label htmlFor="consult-name">이름 <span className="required">*</span></label><input id="consult-name" className="reg-input" value={name} onChange={e => setName(e.target.value)} maxLength={50} autoComplete="name" required placeholder="이름을 입력하세요" /></div>
                <div className="reg-field"><label htmlFor="consult-phone">연락처 <span className="required">*</span></label><input id="consult-phone" type="tel" className="reg-input" value={phone} onChange={e => setPhone(e.target.value)} maxLength={13} autoComplete="tel" required placeholder="010-0000-0000" /></div>
                <div className="reg-field"><label htmlFor="consult-message">상담 내용 (선택)</label><textarea id="consult-message" className="reg-input reg-textarea" value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={1000} placeholder="예: 주4회 등록을 원합니다." /></div>
            </fieldset>
            {error && <p className="recruitment-error" role="alert">{error}</p>}
            <button type="submit" className="reg-btn reg-btn-primary" disabled={!valid || submitting}>{submitting ? '상담 신청 중...' : '상담 신청하기'}</button>
        </form>}
    </div>;
}
