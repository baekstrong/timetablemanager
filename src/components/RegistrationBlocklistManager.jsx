import { useEffect, useState } from 'react';
import { addRegistrationBlock, getRegistrationBlocklist, removeRegistrationBlock } from '../services/registrationBlocklistService';
import { formatBlockPhone, validateBlockEntry } from '../utils/registrationBlocklist';

// 신규 신청 차단 명단 (코치 전용, 2026-11-14). 이름 또는 번호가 같으면 공개 신청·상담 신청이 거부된다.
export default function RegistrationBlocklistManager() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', phone: '', memo: '' });
    const [busy, setBusy] = useState(false);

    const load = async () => {
        setLoading(true); setError('');
        try { setEntries(await getRegistrationBlocklist()); }
        catch (e) { setError('차단 명단을 불러오지 못했습니다: ' + e.message); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    let formValid = false;
    try { validateBlockEntry(form); formValid = true; } catch { /* 입력 중 */ }

    const add = async e => {
        e.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
            setEntries(await addRegistrationBlock(form));
            setForm({ name: '', phone: '', memo: '' });
        } catch (err) { setError(err.message); }
        finally { setBusy(false); }
    };

    const remove = async entry => {
        if (busy || !confirm(`${[entry.name, formatBlockPhone(entry.phone)].filter(Boolean).join(' · ')}\n차단을 해제할까요? 다시 신청할 수 있게 됩니다.`)) return;
        setBusy(true); setError('');
        try { setEntries(await removeRegistrationBlock(entry.id)); }
        catch (err) { setError('해제하지 못했습니다: ' + err.message); }
        finally { setBusy(false); }
    };

    return (
        <div className="cns-section">
            <div className="cns-section-header"><h2>신청 차단 명단</h2></div>
            <p className="cns-block-help">이름 <b>또는</b> 핸드폰 번호 중 하나라도 같으면 신규 수강·대기·상담 신청이 접수되지 않습니다. 신청자에게는 차단 사실 대신 “근력학교로 직접 문의해주세요”라고만 보입니다. 코치가 직접 등록하는 것은 막지 않습니다.</p>
            <form className="cns-block-form" onSubmit={add}>
                <input className="cns-form-input" placeholder="이름" value={form.name} maxLength={50}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                <input className="cns-form-input" placeholder="핸드폰 번호 (010-1234-5678)" inputMode="tel" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <input className="cns-form-input" placeholder="메모 (코치만 보임, 선택)" value={form.memo} maxLength={200}
                    onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
                <button type="submit" className="cns-add-btn" disabled={!formValid || busy}>{busy ? '저장 중…' : '차단 추가'}</button>
            </form>
            {error && <p className="cns-block-error" role="alert">{error}</p>}
            {loading ? <div className="cns-empty">불러오는 중…</div>
                : entries.length === 0 ? <div className="cns-empty">차단한 사람이 없습니다.</div>
                    : <div className="cns-faq-list">
                        {[...entries].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(entry => (
                            <div key={entry.id} className="cns-faq-card">
                                <div className="cns-faq-text">
                                    <div className="cns-faq-q">{entry.name || '(이름 없음)'}{entry.phone ? ` · ${formatBlockPhone(entry.phone)}` : ''}</div>
                                    <div className="cns-faq-a">
                                        {entry.memo ? `${entry.memo} · ` : ''}{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('ko-KR') + ' 추가' : ''}
                                    </div>
                                </div>
                                <div className="cns-faq-actions">
                                    <button type="button" className="cns-block-remove" disabled={busy} onClick={() => remove(entry)}>해제</button>
                                </div>
                            </div>
                        ))}
                    </div>}
        </div>
    );
}
