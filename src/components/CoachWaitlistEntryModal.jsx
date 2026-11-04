import { useState } from 'react';
import { PERIODS, DAYS, MAX_CAPACITY, PRICING } from '../data/mockData';
import { koreanDate, shiftMonth, monthLabel } from '../utils/recruitment';
import { buildCoachWaitlistRegistration } from '../utils/coachWaitlistEntry';

const REFERRALS = ['인스타그램', '네이버', '지인추천', '직접방문', '기타'];
const FREQUENCIES = [2, 3, 4];

/**
 * 코치가 문의를 받고 신규 수강 대기를 직접 등록하는 모달 (신규 → 대기(만석) 탭).
 * onSubmit(data, { sendSms }) — 저장·문자는 부모가 한다.
 */
export default function CoachWaitlistEntryModal({ slotOccupancy, disabledClasses, existingNames, onSubmit, onClose }) {
    const thisMonth = koreanDate().slice(0, 7);
    const months = [0, 1, 2, 3].map(i => shiftMonth(thisMonth, i));
    const [form, setForm] = useState({ name: '', phone: '', gender: '', weeklyFrequency: 2, slots: [], recruitmentMonth: '', referralSource: '', coachMemo: '' });
    const [sendSms, setSendSms] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setError(''); };

    const toggleSlot = (day, period) => {
        const exists = form.slots.some(s => s.day === day && s.period === period);
        set('slots', exists ? form.slots.filter(s => !(s.day === day && s.period === period)) : [...form.slots, { day, period }]);
    };

    const handleSubmit = async () => {
        if (saving) return;
        const { data, error: err } = buildCoachWaitlistRegistration(form);
        if (err) { setError(err); return; }
        if (existingNames.has(data.name) && !confirm(`"${data.name}" 이름이 이미 수강생 명단이나 신청 목록에 있습니다.\n동명이인이면 승인 때 계정이 겹치니 이름을 구분해 주세요(예: 홍길동B).\n\n그래도 등록할까요?`)) return;
        setSaving(true);
        try {
            await onSubmit(data, { sendSms });
        } catch (e) {
            setError('등록 실패: ' + (e?.message || e));
            setSaving(false);
        }
    };

    const freq = form.weeklyFrequency;
    const price = PRICING.find(p => p.frequency === freq);
    const field = { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' };
    const label = { fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' };
    const input = { padding: '8px 12px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-chip)', fontSize: '0.95rem', fontFamily: 'inherit' };
    const chip = (active) => ({
        padding: '6px 12px', borderRadius: 'var(--r-chip)', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit',
        border: active ? '1px solid var(--accent)' : '1px solid var(--hairline)',
        background: active ? 'var(--accent)' : 'var(--canvas)', color: active ? '#fff' : 'var(--text)',
    });

    return (
        <div className="cns-modal-overlay" onClick={onClose}>
            <div className="cns-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
                <h3>대기 직접 등록</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                    문의 받은 사람을 대기(만석) 목록에 넣습니다. 희망 시간에 자리가 나면 수강생이 신청한 대기와 똑같이 안내·승인합니다.
                </p>

                <div style={field}>
                    <span style={label}>이름</span>
                    <input style={input} value={form.name} onChange={e => set('name', e.target.value)} placeholder="홍길동" />
                </div>
                <div style={field}>
                    <span style={label}>연락처</span>
                    <input style={input} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="010-0000-0000" inputMode="tel" />
                </div>
                <div style={field}>
                    <span style={label}>성별 (선택)</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {['남', '여'].map(g => <button key={g} type="button" style={chip(form.gender === g)} onClick={() => set('gender', form.gender === g ? '' : g)}>{g}</button>)}
                    </div>
                </div>
                <div style={field}>
                    <span style={label}>주횟수</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {FREQUENCIES.map(f => <button key={f} type="button" style={chip(freq === f)} onClick={() => set('weeklyFrequency', f)}>주{f}회</button>)}
                    </div>
                    {price && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>입학비 포함 {price.totalWithEntrance.toLocaleString()}원 (승인 때 다시 계산)</span>}
                </div>

                <div style={field}>
                    <span style={label}>희망 시간 ({form.slots.length}개 선택 · 주{freq}회라 {freq}개 이상)</span>
                    <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${DAYS.length}, 1fr)`, gap: '2px', fontSize: '0.75rem' }}>
                        <div></div>
                        {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontWeight: 700, padding: '4px' }}>{d}</div>)}
                        {PERIODS.filter(p => p.type !== 'free').map(period => (
                            <div key={period.id} style={{ display: 'contents' }}>
                                <div style={{ fontSize: '0.7rem', padding: '4px 2px', color: 'var(--text-secondary)' }}>{period.name}</div>
                                {DAYS.map(day => {
                                    const key = `${day}-${period.id}`;
                                    const isDisabled = disabledClasses.includes(key);
                                    const remaining = MAX_CAPACITY - (slotOccupancy[key] || 0);
                                    const isFull = remaining <= 0;
                                    const isSelected = form.slots.some(s => s.day === day && s.period === period.id);
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            disabled={isDisabled}
                                            onClick={() => toggleSlot(day, period.id)}
                                            aria-pressed={isSelected}
                                            aria-label={`${day}요일 ${period.name} ${isDisabled ? '휴무' : isFull ? '마감' : `${remaining}자리`}`}
                                            style={{
                                                padding: '6px 2px', textAlign: 'center', borderRadius: '4px', fontFamily: 'inherit', fontSize: '0.75rem',
                                                cursor: isDisabled ? 'default' : 'pointer',
                                                border: isSelected ? '2px solid var(--accent)' : '1px solid var(--hairline)',
                                                background: isDisabled ? 'var(--canvas-tint)' : isSelected ? 'var(--accent-10)' : isFull ? '#EDBC401A' : 'var(--canvas)',
                                                color: isDisabled ? 'var(--text-muted)' : isSelected ? 'var(--accent)' : isFull ? '#9a7a12' : 'var(--text)',
                                                fontWeight: isSelected ? 700 : 400,
                                            }}
                                        >
                                            {isDisabled ? '-' : isSelected ? '✓' : isFull ? '마감' : remaining}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>숫자 = 남은 자리. 마감된 시간도 고를 수 있어요.</span>
                </div>

                <div style={field}>
                    <span style={label}>입학 희망 달 (선택)</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {months.map(m => <button key={m} type="button" style={chip(form.recruitmentMonth === m)} onClick={() => set('recruitmentMonth', form.recruitmentMonth === m ? '' : m)}>{monthLabel(m)}</button>)}
                    </div>
                </div>
                <div style={field}>
                    <span style={label}>유입경로 (선택)</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {REFERRALS.map(r => <button key={r} type="button" style={chip(form.referralSource === r)} onClick={() => set('referralSource', form.referralSource === r ? '' : r)}>{r}</button>)}
                    </div>
                </div>
                <div style={field}>
                    <span style={label}>코치 메모 (선택, 수강생에게 안 보임)</span>
                    <textarea style={{ ...input, minHeight: '64px', resize: 'vertical' }} value={form.coachMemo} onChange={e => set('coachMemo', e.target.value)} placeholder="예: 11/4 인스타 DM, 저녁만 가능" maxLength={500} />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', marginBottom: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} />
                    대기 접수 안내 문자 보내기
                </label>

                {error && <div role="alert" style={{ color: 'var(--error)', fontSize: '0.85rem', margin: '4px 0 8px' }}>{error}</div>}

                <div className="cns-modal-actions" style={{ marginTop: '12px' }}>
                    <button className="cns-modal-btn cancel" onClick={onClose} disabled={saving}>취소</button>
                    <button className="cns-modal-btn save" onClick={handleSubmit} disabled={saving}>{saving ? '등록 중...' : '대기 등록'}</button>
                </div>
            </div>
        </div>
    );
}
