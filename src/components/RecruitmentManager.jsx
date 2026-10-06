import { useEffect, useState } from 'react';
import { getRecruitmentMonths, saveRecruitmentMonth } from '../services/recruitmentService';
import { getSmsSettings } from '../services/smsService';
import { monthLabel, shiftMonth, RECRUITMENT_STATUSES } from '../utils/recruitment';
import './Recruitment.css';
import useKoreanMonth from '../hooks/useKoreanMonth';

function MonthForm({ month, config, defaultPhone, entrancesLoading, onSaved, past }) {
    const [status, setStatus] = useState(config?.status || 'inquiry');
    const [notice, setNotice] = useState(config?.notice || '');
    const [phone, setPhone] = useState(config?.inquiryPhone || defaultPhone);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const save = async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true); setError(''); setMessage('');
        try {
            await saveRecruitmentMonth(month, { status, notice, inquiryPhone: phone });
            onSaved({ month, status, notice: notice.trim(), inquiryPhone: phone.replace(/\D/g, '') });
            setMessage(`${monthLabel(month)} 모집 상태를 ${RECRUITMENT_STATUSES[status]}로 저장했습니다.`);
        } catch (err) { setError(err.message); }
        finally { setSaving(false); }
    };

    return <form className="recruitment-management-form" onSubmit={save}>
        <h3>{monthLabel(month)} 모집 설정</h3>
        <p className="recruitment-muted">{config ? `현재 공개 상태: ${RECRUITMENT_STATUSES[config.status]}` : past ? '저장된 모집 설정이 없습니다.' : '아직 설정하지 않은 달은 문의만 받습니다.'}</p>
        {past && <p className="recruitment-muted">지난달 모집 기록입니다.</p>}
        <fieldset disabled={saving || entrancesLoading || past}>
            <legend>모집 상태</legend>
            <div className="recruitment-state-options">{Object.entries(RECRUITMENT_STATUSES).map(([value, label]) =>
                <label key={value} className={`recruitment-state-option ${status === value ? 'selected' : ''}`}>
                    <input type="radio" name={`recruitment-${month}`} value={value} checked={status === value} onChange={() => setStatus(value)} />{label}
                </label>)}</div>
            <p className="recruitment-muted">접수중이면 신청할 수 있고, 문의만 가능·마감이면 신청을 받지 않습니다. 마감된 달도 신청페이지에 표시됩니다.</p>
            <label className="recruitment-field">문자 문의번호
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000" autoComplete="tel" />
            </label>
            <label className="recruitment-field">신청페이지 안내 (선택)
                <textarea value={notice} onChange={e => setNotice(e.target.value)} maxLength={300} rows={3} placeholder="예: 11월 입학반은 11월 7일에 진행합니다." />
            </label>
            <button type="submit" className="cns-add-btn recruitment-full">{saving ? '저장중...' : '모집 상태 저장'}</button>
        </fieldset>
        {error && <p className="recruitment-error" role="alert">{error}</p>}
        {message && <p className="recruitment-success" role="status">{message}</p>}
    </form>;
}

export default function RecruitmentManager({ entrances, entrancesLoading, onAddEntrance, renderEntrance }) {
    const current = useKoreanMonth();
    const [selectedMonth, setMonth] = useState(null);
    const month = selectedMonth || current;
    const [configs, setConfigs] = useState([]);
    const [defaultPhone, setDefaultPhone] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [copyMessage, setCopyMessage] = useState('');
    useEffect(() => {
        let active = true;
        Promise.all([getRecruitmentMonths({ includePast: true }), getSmsSettings()]).then(([data, settings]) => {
            if (!active) return;
            setConfigs(data); setDefaultPhone(settings?.coachPhone || ''); setError('');
        }).catch(() => { if (active) setError('모집 설정을 불러오지 못했습니다. 다시 확인해주세요.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [reload, current]);
    const copyLink = async () => {
        const url = new URL(import.meta.env.BASE_URL, window.location.origin);
        url.searchParams.set('register', 'true');
        try { await navigator.clipboard.writeText(url.href); setCopyMessage('신규 신청 링크를 복사했습니다.'); }
        catch { setCopyMessage(`신청 링크: ${url.href}`); }
    };
    const selectableMonths = [...new Set([month, ...Array.from({ length: 25 }, (_, offset) => shiftMonth(current, offset - 12)), ...configs.map(c => c.month)])].sort();
    const months = [...new Set([current, shiftMonth(current), month, ...configs.filter(c => c.month >= current).map(c => c.month)])].sort();
    const config = configs.find(c => c.month === month);
    const monthEntrances = entrances.filter(ec => ec.date?.startsWith(`${month}-`))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
    return <section className="recruitment-management" aria-label="월별 모집·입학반 관리">
        <div className="recruitment-management-header"><h2>월별 모집·입학반 관리</h2><button className="recruitment-text-button" onClick={copyLink}>신청 링크 복사</button></div>
        <p className="recruitment-muted">모집월은 입학반을 듣는 달입니다. 정규 수업은 입학반 이후 시작합니다.</p>
        <div className="recruitment-field">
            <label htmlFor="recruitment-month-select">관리할 모집월</label>
            <div className="recruitment-month-selector">
                <button type="button" className="recruitment-month-arrow" aria-label="이전 모집월" disabled={month === '0001-01'} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
                <select id="recruitment-month-select" value={month} onChange={e => setMonth(e.target.value)}>
                    {selectableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <button type="button" className="recruitment-month-arrow" aria-label="다음 모집월" disabled={month >= shiftMonth(current, 12)} onClick={() => setMonth(shiftMonth(month))}>›</button>
            </div>
        </div>
        <div className="recruitment-months">{months.map(m => <button key={m} className={`recruitment-month ${month === m ? 'selected' : ''}`} aria-pressed={month === m} onClick={() => setMonth(m)}>
            <strong>{monthLabel(m)}</strong><span className={`recruitment-status ${configs.find(c => c.month === m)?.status || 'inquiry'}`}>{RECRUITMENT_STATUSES[configs.find(c => c.month === m)?.status || 'inquiry']}</span>
        </button>)}</div>
        {copyMessage && <p role="status" className="recruitment-muted">{copyMessage}</p>}
        {loading ? <p role="status">모집 설정을 불러오고 있습니다.</p> : error ? <div role="alert" className="recruitment-error"><p>{error}</p><button onClick={() => { setLoading(true); setReload(v => v + 1); }}>다시 확인</button></div>
            : <MonthForm key={month} month={month} config={config} defaultPhone={defaultPhone} entrancesLoading={entrancesLoading}
                past={month < current} onSaved={next => setConfigs(previous => [...previous.filter(c => c.month !== next.month), next])} />}
        <section className="recruitment-entrances" aria-label={`${monthLabel(month)} 입학반`}>
            <div className="recruitment-management-header">
                <h3>{monthLabel(month)} 입학반</h3>
                <button type="button" className="cns-add-btn" disabled={entrancesLoading || month < current} onClick={() => onAddEntrance(month)}>+ 입학반 추가</button>
            </div>
            {entrancesLoading ? <p role="status">입학반을 불러오고 있습니다.</p>
                : monthEntrances.length ? <div className="cns-entrance-list">{monthEntrances.map(renderEntrance)}</div>
                    : <p className="recruitment-muted">{monthLabel(month)}에 등록된 입학반이 없습니다.</p>}
        </section>
    </section>;
}
