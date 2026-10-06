import { useCallback, useEffect, useRef, useState } from 'react';
import { getRecruitmentOverview, assertRecruitmentOpen } from '../services/recruitmentService';
import { getSmsSettings } from '../services/smsService';
import { recruitmentOptions, monthLabel, RECRUITMENT_STATUSES, inquirySmsLink, inquiryMessage, recruitmentInquiryRoute } from '../utils/recruitment';
import './Recruitment.css';

export default function RegistrationMonthPicker({ onStart }) {
    const [options, setOptions] = useState([]);
    const [selected, setSelected] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [starting, setStarting] = useState(false);
    const [copyMessage, setCopyMessage] = useState('');
    const request = useRef({ id: 0 });

    const load = useCallback(async () => {
        const id = ++request.current.id;
        setLoading(true);
        setError('');
        try {
            const overview = await getRecruitmentOverview();
            if (id !== request.current.id) return;
            const next = recruitmentOptions(overview.configs, overview.entrances);
            setOptions(next);
            setSelected(previous => next.some(o => o.month === previous) ? previous
                : (next.find(o => o.canApply) || next[0])?.month || '');
        } catch {
            if (id === request.current.id) setError('모집 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.');
        } finally {
            if (id === request.current.id) setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const requests = request.current;
        let active = true;
        getSmsSettings().then(settings => { if (active) setPhone(settings?.coachPhone || ''); }).catch(() => {});
        const onVisible = () => { if (document.visibilityState === 'visible') load(); };
        window.addEventListener('focus', load);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            active = false;
            requests.id++;
            window.removeEventListener('focus', load);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [load]);

    const choice = options.find(o => o.month === selected);
    const { inquiry, showInquiry, nextOpen } = recruitmentInquiryRoute(choice, options, phone);
    const inquiryPhone = inquiry?.inquiryPhone || phone;
    const smsLink = inquiry ? inquirySmsLink(inquiryPhone, inquiry.month, navigator.userAgent) : '';
    const start = async () => {
        if (!choice?.canApply || starting || loading) return;
        setStarting(true);
        try {
            await assertRecruitmentOpen(choice.month);
            onStart(choice.month);
        } catch (err) {
            await load();
            setError(err.message);
        } finally { setStarting(false); }
    };
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(inquiryMessage(inquiry.month));
            setCopyMessage('문의 내용을 복사했습니다. 문자에 붙여넣어주세요.');
        } catch { setCopyMessage('문자 앱에서 이름과 희망 요일·시간을 적어 문의해주세요.'); }
    };

    return <div className="reg-wizard"><main className="reg-wizard-inner recruitment-picker">
        <header className="reg-header"><div className="recruitment-brand">근력학교</div><h1 className="reg-title">신규 수강 신청</h1></header>
        <div className="reg-body">
            <p>입학을 희망하는 달을 선택해주세요.</p>
            {loading && <p className="recruitment-muted" role="status">모집 정보를 확인하고 있습니다.</p>}
            {error && <div className="recruitment-error" role="alert"><p>{error}</p><button className="reg-btn reg-btn-secondary" onClick={load} disabled={loading}>다시 확인</button></div>}
            {!loading && !error && choice && <>
                <div className="recruitment-months" aria-label="희망 입학 월">
                    {options.map(o => <button key={o.month} className={`recruitment-month ${o.month === selected ? 'selected' : ''}`}
                        aria-pressed={o.month === selected} onClick={() => { setSelected(o.month); setCopyMessage(''); }} disabled={starting}>
                        <strong>{monthLabel(o.month)}</strong><span className={`recruitment-status ${o.status}`}>{RECRUITMENT_STATUSES[o.status]}</span>
                    </button>)}
                </div>
                <section className="recruitment-notice" aria-live="polite">
                    <h2>{monthLabel(selected)} {choice.status === 'closed' ? '신규 모집 마감' : choice.status === 'open' ? '신규 수강 모집중' : '입학 문의'}</h2>
                    <p>{choice.status === 'closed' ? '신청해주셔서 감사합니다. 이 달에는 신규 신청을 더 받지 않습니다.'
                        : choice.status === 'open' ? '선택한 달의 입학반과 희망 수업 시간을 선택해 신청해주세요.' : '아직 신청을 받고 있지 않습니다. 입학 일정과 신청 가능 여부는 문자로 문의해주세요.'}</p>
                    {choice.notice && <p className="recruitment-custom-notice">{choice.notice}</p>}
                    {choice.entrances.length > 0 && <p className="recruitment-muted">입학반 {choice.entrances.map(ec => `${Number(ec.date.slice(5, 7))}/${Number(ec.date.slice(8))} ${ec.time || ''}`).join(' · ')}</p>}
                    {choice.status === 'open' && !choice.canApply && <p>현재 신청 가능한 입학반이 없습니다. 입학반이 추가되면 신청할 수 있습니다.</p>}
                </section>
                {choice.status !== 'inquiry' && <button className="reg-btn reg-btn-primary recruitment-full" disabled={!choice.canApply || starting}
                    onClick={start}>{starting ? '모집 상태 확인중...' : choice.status === 'closed' ? `${Number(selected.slice(5))}월 신청 마감` : `${Number(selected.slice(5))}월 수강 신청하기`}</button>}
                {nextOpen && <button className="reg-btn reg-btn-secondary recruitment-full" onClick={() => setSelected(inquiry.month)}>{Number(inquiry.month.slice(5))}월 신규 모집 보기</button>}
                {showInquiry && <section className="recruitment-inquiry">
                    <h2>{inquiry.month === selected ? '입학 상담' : `${monthLabel(inquiry.month)} 입학 상담`}</h2>
                    <p className="recruitment-muted">희망 요일과 시간을 알려주시면 입학 일정과 신청 가능 여부를 안내드립니다.</p>
                    {smsLink ? <>
                        <a className="reg-btn reg-btn-secondary recruitment-full" href={smsLink}>{Number(inquiry.month.slice(5))}월 입학 문자로 문의하기</a>
                        <p className="recruitment-contact">문의번호 <a href={`sms:${inquiryPhone}`}>{inquiryPhone}</a></p>
                        <button className="recruitment-text-button" onClick={copy}>문자 문의 내용 복사</button>
                    </> : <p className="recruitment-muted">문자 문의 연락처를 준비중입니다. 잠시 후 다시 확인해주세요.</p>}
                    <p className="recruitment-footnote">문의는 예약이나 등록 확정이 아닙니다.</p>
                    {copyMessage && <p className="recruitment-footnote" role="status">{copyMessage}</p>}
                </section>}
            </>}
        </div>
    </main></div>;
}
