import { useEffect, useRef, useState } from 'react';
import { DAYS, PERIODS, PRICING } from '../data/mockData';
import { getStudentField as field, parseScheduleString } from '../services/googleSheetsService';
import { getContractChangeDependencies } from '../services/firebaseService';
import { loadContractRegistrations, buildContractChangePlan, saveContractChange, contractSnapshot, isoDay } from '../services/contractChangeService';
import './ResumeStudentModal.css';
import './ContractChangeModal.css';

export default function ContractChangeModal({ student, onClose, onSaved }) {
    const dialog = useRef(null), savingRef = useRef(false);
    const [info, setInfo] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
    const [frequency, setFrequency] = useState(Number(field(student, '주횟수')));
    const [slots, setSlots] = useState(() => parseScheduleString(field(student, '요일 및 시간')));
    const [amount, setAmount] = useState(''), [paymentDate, setPaymentDate] = useState(isoDay(new Date()));
    const [method, setMethod] = useState('카드'), [paid, setPaid] = useState(true);
    const [id] = useState(() => crypto.randomUUID());
    const [attempt, setAttempt] = useState(0);
    const [clock, setClock] = useState(() => new Date());
    useEffect(() => {
        const element = dialog.current; element.showModal();
        const timer = setInterval(() => setClock(new Date()), 15000);
        return () => { element.close(); clearInterval(timer); };
    }, []);
    useEffect(() => {
        let cancelled = false;
        Promise.all([loadContractRegistrations(student['이름']), getContractChangeDependencies(student['이름'])]).then(([entries, dependencies]) => {
            if (cancelled) return;
            const entry = entries.find(e => e.sheetName === student._foundSheetName && e.rowIndex === student._rowIndex + 2);
            if (!entry) throw new Error('현재 등록을 찾지 못했습니다. 수강생 목록을 새로고침해주세요.');
            setInfo({ name: student['이름'], entries, entry, snapshot: contractSnapshot(entries), ...dependencies });
            setError('');
        }).catch(err => { if (!cancelled) setError(err.message); });
        return () => { cancelled = true; };
    }, [student, attempt]);
    const schedule = [...slots].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)).map(s => `${s.day}${s.period}`).join('');
    const options = { frequency, schedule, amount: amount === '' ? undefined : Number(amount), paymentDate, paymentMethod: method, paid, id, now: clock };
    let plan = null, validation = '';
    if (info) {
        try {
            plan = buildContractChangePlan({ ...info, ...options });
            if (slots.some(s => info.disabled.includes(`${s.day}-${s.period}`))) throw new Error('휴무인 수업이 선택되어 있습니다. 다른 시간을 선택해주세요.');
        } catch (err) { validation = err.message; plan = null; }
    }
    const toggle = (day, period) => setSlots(current => {
        if (current.some(s => s.day === day && s.period === period)) return current.filter(s => s.day !== day);
        if (current.some(s => s.day === day)) return [...current.filter(s => s.day !== day), { day, period }];
        return current.length < frequency ? [...current, { day, period }] : current;
    });
    const save = async event => {
        event.preventDefault();
        if (savingRef.current || !plan || !info) return;
        savingRef.current = true; setSaving(true); setError('');
        try {
            const dependencies = await getContractChangeDependencies(info.name);
            if (slots.some(s => dependencies.disabled.includes(`${s.day}-${s.period}`))) throw new Error('휴무 설정이 변경됐습니다.');
            await saveContractChange(info, { ...options, ...dependencies, now: new Date() }, plan);
        } catch (err) {
            setInfo(null); setError(`${err.message} 최신 정보를 다시 불러와 반영 여부를 확인해주세요.`);
            savingRef.current = false; setSaving(false); return;
        }
        onSaved();
    };
    return <dialog ref={dialog} className="resume-modal adjustment-dialog contract-change-dialog" aria-labelledby="contract-change-title"
        onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
        <form onSubmit={save}>
            <div className="resume-modal-heading"><div><h2 id="contract-change-title">계약변경</h2><p>{student['이름']} · 현재 주{field(student, '주횟수')}회 {field(student, '요일 및 시간')}</p></div></div>
            {!info && !error && <p role="status">등록·홀딩·보강을 확인하고 있습니다…</p>}
            {info && <fieldset disabled={saving} className="contract-change-fields">
                <div className="resume-form-field"><label htmlFor="contract-frequency">변경 후 주 횟수</label>
                    <select id="contract-frequency" value={frequency} onChange={e => { const value = Number(e.target.value); setFrequency(value); setSlots(s => s.slice(0, value)); }}>
                        {[...PRICING].reverse().map(p => <option key={p.frequency} value={p.frequency}>{p.label}</option>)}
                    </select></div>
                <p>요일·시간 선택 {slots.length}/{frequency}개</p>
                <div className="resume-schedule-grid">
                    <div className="resume-schedule-header"><span />{DAYS.map(day => <span key={day}>{day}</span>)}</div>
                    {PERIODS.filter(p => p.type !== 'free').map(period => <div className="resume-schedule-row" key={period.id}>
                        <span>{period.name}<small>{period.time}</small></span>
                        {DAYS.map(day => { const selected = slots.some(s => s.day === day && s.period === period.id); return <button type="button" key={day}
                            className={selected ? 'selected' : ''} aria-label={`${day} ${period.name}`} aria-pressed={selected}
                            disabled={info.disabled.includes(`${day}-${period.id}`)} onClick={() => toggle(day, period.id)}>{selected ? '✓' : ''}</button>; })}
                    </div>)}
                </div>
                <div className="contract-change-payment">
                    <div className="resume-form-field"><label htmlFor="contract-amount">추가 결제액 (만원)</label><input id="contract-amount" type="number" min="0" step="0.0001" value={amount} placeholder={String(plan?.amount ?? '')} onChange={e => setAmount(e.target.value)} /><small>비워두면 주 횟수·등록 개월 기준 차액 자동 계산</small></div>
                    <div className="resume-form-field"><label htmlFor="contract-payment-date">결제일</label><input id="contract-payment-date" type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></div>
                    <div className="resume-form-field"><label htmlFor="contract-method">결제방식</label><select id="contract-method" value={method} onChange={e => setMethod(e.target.value)}>{['카드', '계좌', '제로페이', '네이버'].map(m => <option key={m}>{m}</option>)}</select></div>
                    <label><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> 결제 완료</label>
                </div>
                {plan && <div className="resume-calculation-note" aria-live="polite">
                    총 <strong>{plan.total}회</strong> · 소진 <strong>{plan.consumed}회</strong> · 잔여 <strong>{plan.remaining}회</strong>
                    {plan.reserved > 0 && <p>기예약 보강 {plan.reserved}회 포함</p>}
                    <p>새 시간표 적용: {plan.from}부터 · 종료일: <strong>{plan.endDate}</strong></p>
                    <p>추가 결제: <strong>{plan.amount}만원</strong></p>
                </div>}
                <p className="contract-change-help">소진은 수업 일정과 종료 시각·공휴일·홀딩·보강 기준으로 자동 계산합니다. 이전 계약의 결제·시작일·종료일은 보존하고 시간표를 새 계약으로 옮깁니다. 사용한 홀딩도 이어집니다.</p>
            </fieldset>}
            {(error || validation) && <p className="resume-field-error" role="alert">{error || validation}</p>}
            {!info && error && <button type="button" onClick={() => { setError(''); setAttempt(a => a + 1); }}>최신 정보 다시 불러오기</button>}
            <div className="resume-modal-actions"><button type="button" className="resume-cancel-button" onClick={onClose} disabled={saving}>취소</button>
                <button type="submit" className="resume-submit-button" disabled={!plan || saving}>{saving ? '저장 중…' : '계약변경 저장'}</button></div>
        </form>
    </dialog>;
}
