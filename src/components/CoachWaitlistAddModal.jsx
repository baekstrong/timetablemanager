import { useEffect, useState } from 'react';
import { addCoachWaitlist, getRecruitmentMonths } from '../services/recruitmentService';
import { monthLabel, shiftMonth, RECRUITMENT_STATUSES } from '../utils/recruitment';
import { validateWaitlistEntry, assertWaitlistMonthStatus } from '../utils/newStudentWaitlist';
import { PERIODS, DAYS, MAX_CAPACITY } from '../data/mockData';
import useKoreanMonth from '../hooks/useKoreanMonth';

// 코치가 전화·DM으로 받은 신규 대기를 직접 추가한다. 문자는 보내지 않는다.
export default function CoachWaitlistAddModal({ occupancy = {}, disabledClasses = [], onClose, onSaved, save = addCoachWaitlist }) {
    const current = useKoreanMonth();
    const months = Array.from({ length: 7 }, (_, i) => shiftMonth(current, i));
    const [form, setForm] = useState({ name: '', phone: '', recruitmentMonth: shiftMonth(current), weeklyFrequency: 2, memo: '' });
    const [slots, setSlots] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // 마감된 달은 대기를 받지 않는다(다음 달로 받음). 조회 실패 시엔 저장 단계 서버 확인에 맡긴다.
    const [statuses, setStatuses] = useState({});
    useEffect(() => {
        let alive = true;
        getRecruitmentMonths().then(configs => { if (alive) setStatuses(Object.fromEntries(configs.map(c => [c.month, c.status]))); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    const statusOf = month => statuses[month] || 'inquiry';
    // 기본 선택(다음 달)이 마감이면 마감 아닌 첫 달을 쓴다
    const recruitmentMonth = statusOf(form.recruitmentMonth) !== 'closed' ? form.recruitmentMonth
        : months.find(m => statusOf(m) !== 'closed') || form.recruitmentMonth;
    const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
    const toggle = (day, period) => setSlots(prev => prev.some(s => s.day === day && s.period === period)
        ? prev.filter(s => !(s.day === day && s.period === period)) : [...prev, { day, period }]);

    const submit = async () => {
        if (saving) return;
        const data = { ...form, recruitmentMonth, name: form.name.trim(), phone: form.phone.replace(/\s/g, ''), requestedSlots: slots };
        try {
            validateWaitlistEntry(data, { coach: true });
            assertWaitlistMonthStatus(statusOf(data.recruitmentMonth), { coach: true });
        } catch (err) { setError(err.message); return; }
        setSaving(true); setError('');
        try {
            await save(data);
            onSaved();
        } catch (err) {
            setError('저장 실패: ' + err.message);
            setSaving(false);
        }
    };

    return <div className="cns-modal-overlay" onClick={() => { if (!saving) onClose(); }}>
        <div className="cns-modal cns-waitlist-add" onClick={e => e.stopPropagation()} role="dialog" aria-label="대기 직접 추가">
            <h3>대기 직접 추가</h3>
            <p className="cns-modal-sub">전화·DM으로 받은 대기를 등록합니다. 문자는 보내지 않습니다.</p>
            <div className="cns-waitlist-fields">
                <label>이름<input value={form.name} maxLength={50} onChange={e => set('name', e.target.value)} placeholder="홍길동" /></label>
                <label>연락처<input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="010-0000-0000" /></label>
                <label>희망 입학 월
                    <select value={recruitmentMonth} onChange={e => set('recruitmentMonth', e.target.value)}>
                        {months.map(m => <option key={m} value={m} disabled={statusOf(m) === 'closed'}>{monthLabel(m)} · {RECRUITMENT_STATUSES[statusOf(m)]}</option>)}
                    </select>
                </label>
                <div className="cns-waitlist-freq" role="group" aria-label="주 횟수">
                    <span>주 횟수</span>
                    <div>{[2, 3, 4].map(n => <button type="button" key={n} aria-pressed={form.weeklyFrequency === n}
                        className={form.weeklyFrequency === n ? 'selected' : ''} onClick={() => set('weeklyFrequency', n)}>주{n}회</button>)}</div>
                </div>
            </div>
            <p className="cns-waitlist-grid-label">가능한 시간 <span>({slots.length}개 선택 · 숫자는 지금 남은 자리)</span></p>
            <div className="cns-waitlist-grid">
                <div />
                {DAYS.map(d => <div key={d} className="cns-waitlist-day">{d}</div>)}
                {PERIODS.filter(p => p.type !== 'free').map(period => <div key={period.id} style={{ display: 'contents' }}>
                    <div className="cns-waitlist-period">{period.name}</div>
                    {DAYS.map(day => {
                        const key = `${day}-${period.id}`;
                        const disabled = disabledClasses.includes(key);
                        const remaining = MAX_CAPACITY - (occupancy[key] || 0);
                        const selected = slots.some(s => s.day === day && s.period === period.id);
                        return <button type="button" key={key} disabled={disabled} aria-pressed={selected}
                            aria-label={`${day} ${period.name} ${disabled ? '수업 없음' : remaining <= 0 ? '마감' : `${remaining}자리`}`}
                            className={`cns-waitlist-cell ${selected ? 'selected' : ''} ${remaining <= 0 ? 'full' : ''}`}
                            onClick={() => toggle(day, period.id)}>
                            {disabled ? '-' : selected ? '✓' : remaining <= 0 ? '마감' : remaining}
                        </button>;
                    })}
                </div>)}
            </div>
            <label className="cns-waitlist-memo">메모 (선택)
                <textarea rows={2} value={form.memo} maxLength={300} onChange={e => set('memo', e.target.value)} placeholder="예: 인스타 DM 문의, 저녁만 가능" />
            </label>
            {error && <p className="cns-waitlist-error" role="alert">{error}</p>}
            <div className="cns-modal-actions">
                <button className="cns-modal-btn cancel" onClick={onClose} disabled={saving}>취소</button>
                <button className="cns-modal-btn save" onClick={submit} disabled={saving}>{saving ? '저장 중...' : '대기 추가'}</button>
            </div>
        </div>
    </div>;
}
