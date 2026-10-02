import { useEffect, useState } from 'react';
import { DAYS, PERIODS, PRICING, ENTRANCE_FEE, MAX_CAPACITY } from '../data/mockData';
import { getHolidays, getDisabledClasses, getNewStudentRegistrations, updateNewStudentRegistration } from '../services/firebaseService';
import { buildNewRegistrationPlan } from '../utils/newRegistrationPlan';
import { formatEntranceDate } from '../utils/dateUtils';
import { getAllStudentsFromAllSheets, parseScheduleString } from '../services/googleSheetsService';
import { computeSlotOccupancy } from '../utils/slotOccupancy';
import { slotsOf } from '../utils/scheduleUtils';

export default function PendingRegistrationEditor({ reg, onClose, onSaved }) {
    const [frequency, setFrequency] = useState(PRICING.some(p => p.frequency === Number(reg.weeklyFrequency)) ? Number(reg.weeklyFrequency) : 2);
    const [slots, setSlots] = useState(() => [...slotsOf(reg)]);
    const [rules, setRules] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        let active = true;
        Promise.all([getHolidays(), getDisabledClasses(), getAllStudentsFromAllSheets(), getNewStudentRegistrations('pending')]).then(([holidays, disabled, students, pending]) => {
            if (active) setRules({ holidays, disabled, occupancy: computeSlotOccupancy(students, pending.filter(r => r.id !== reg.id), parseScheduleString) });
        }).catch(() => {
            if (active) setLoadError('빈자리와 공휴일 정보를 불러오지 못했습니다. 닫은 뒤 다시 시도해주세요.');
        });
        return () => { active = false; };
    }, [reg.id]);

    let plan = null, validation = '';
    if (rules) {
        try { plan = buildNewRegistrationPlan(reg, slots, frequency, rules.holidays, rules.disabled); }
        catch (err) { validation = err.message; }
    }
    const pricing = PRICING.find(p => p.frequency === frequency);
    const toggle = (day, period) => {
        setSaveError('');
        setSlots(current => {
            if (current.some(s => s.day === day && s.period === period)) {
                return current.filter(s => !(s.day === day && s.period === period));
            }
            // 같은 날 교시를 누르면 시간만 교체한다.
            if (current.some(s => s.day === day)) return [...current.filter(s => s.day !== day), { day, period }];
            if (current.length >= frequency) return current;
            return [...current, { day, period }];
        });
    };
    const save = async () => {
        if (saving || !plan || reg.status !== 'pending') return;
        setSaving(true);
        setSaveError('');
        try {
            // 저장 직전 최신 휴무 설정으로 다시 검증한다.
            const [holidays, disabled] = await Promise.all([getHolidays(), getDisabledClasses()]);
            const updated = buildNewRegistrationPlan(reg, slots, frequency, holidays, disabled);
            await updateNewStudentRegistration(reg.id, updated);
            onSaved(updated);
        } catch (err) {
            setSaveError('변경 저장 실패: ' + err.message);
        } finally { setSaving(false); }
    };

    return (
        <div className="cns-modal-overlay" onClick={() => !saving && onClose()}>
            <div className="cns-modal cns-registration-editor" role="dialog" aria-modal="true" aria-labelledby="registration-editor-title" onClick={e => e.stopPropagation()}>
                <h3 id="registration-editor-title">시간표·주 횟수 변경</h3>
                <p className="cns-editor-description">{reg.name} · 신규 1개월 등록</p>
                <div className="cns-form-field">
                    <label htmlFor="registration-frequency">주 횟수</label>
                    <select id="registration-frequency" className="cns-form-input" value={frequency} disabled={saving} onChange={e => { setFrequency(Number(e.target.value)); setSaveError(''); }}>
                        {[...PRICING].reverse().map(p => <option key={p.frequency} value={p.frequency}>{p.label}</option>)}
                    </select>
                </div>
                <p className="cns-editor-description">시간표 {slots.length}/{frequency}개 선택 · 같은 요일은 한 교시만 선택</p>
                <div className="cns-editor-grid">
                    <div />{DAYS.map(day => <div key={day} className="cns-editor-day">{day}</div>)}
                    {PERIODS.filter(p => p.type !== 'free').map(period => (
                        <div key={period.id} style={{ display: 'contents' }}>
                            <div className="cns-editor-period">{period.name}<small>{period.time}</small></div>
                            {DAYS.map(day => {
                                const key = `${day}-${period.id}`;
                                const selected = slots.some(s => s.day === day && s.period === period.id);
                                const unavailable = rules?.disabled.includes(key);
                                const remaining = Math.max(0, MAX_CAPACITY - (rules?.occupancy[key] || 0));
                                return <button type="button" key={key} className={`cns-editor-slot${selected ? ' selected' : ''}`} aria-label={`${day} ${period.name}, ${!rules ? '조회 중' : unavailable ? '휴무' : remaining ? `빈자리 ${remaining}석` : '마감'}`} aria-pressed={selected}
                                    disabled={saving || !rules || (unavailable && !selected) || (!selected && slots.length >= frequency && !slots.some(s => s.day === day))}
                                    onClick={() => toggle(day, period.id)}><span>{selected ? '✓' : ''}</span><small>{!rules ? '조회 중' : unavailable ? '휴무' : remaining ? `${remaining}석` : '마감'}</small></button>;
                            })}
                        </div>
                    ))}
                </div>
                <p className="cns-editor-description">현재 시간표와 다른 승인 대기 신청을 포함한 빈자리입니다. 이 신청은 제외합니다. 마감된 시간도 코치가 선택할 수 있습니다.</p>
                <dl className="cns-editor-summary">
                    <div><dt>시작일</dt><dd>{plan?.startDate ? formatEntranceDate(plan.startDate) : '입학반·시간표 확정 후 계산'}</dd></div>
                    <div><dt>종료일</dt><dd>{plan?.endDate ? formatEntranceDate(plan.endDate) : '입학반·시간표 확정 후 계산'}</dd></div>
                    <div><dt>수업 횟수</dt><dd>{frequency * 4}회 · 공휴일 제외</dd></div>
                    <div><dt>수업료</dt><dd>{pricing.baseCost.toLocaleString()}원</dd></div>
                    <div><dt>입학비</dt><dd>{ENTRANCE_FEE.toLocaleString()}원</dd></div>
                    <div><dt>결제 금액</dt><dd>{(pricing.baseCost + ENTRANCE_FEE).toLocaleString()}원</dd></div>
                </dl>
                {(loadError || saveError || validation) && <p className="cns-editor-error" role="alert">{loadError || saveError || validation}</p>}
                {!rules && !loadError && <p role="status">전체 시간표 빈자리·공휴일 확인 중...</p>}
                <div className="cns-modal-actions">
                    <button className="cns-modal-btn cancel" disabled={saving} onClick={onClose}>취소</button>
                    <button className="cns-modal-btn save" disabled={saving || !plan || Boolean(loadError)} onClick={save}>{saving ? '저장 중...' : '변경 저장'}</button>
                </div>
            </div>
        </div>
    );
}
