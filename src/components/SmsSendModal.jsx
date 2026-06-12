import { useMemo, useState } from 'react';
import { sendManualSMS } from '../services/smsService';

/** EUC-KR 기준 바이트 수 (한글 등 비ASCII 2바이트) — SMS 90바이트 초과 시 LMS */
function getSmsByteLength(text) {
    let bytes = 0;
    for (const ch of text) bytes += ch.charCodeAt(0) > 127 ? 2 : 1;
    return bytes;
}

const overlayStyle = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
};
const modalStyle = {
    background: 'var(--canvas)', borderRadius: '20px', padding: '20px',
    width: '100%', maxWidth: '480px', maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
};

/**
 * 코치 수동 문자 발송 모달.
 * recipients: [{name, phone}] — phone 없으면 선택 불가 + 경고 표시.
 * 발송 후 같은 모달이 수신자별 성공/실패 결과 화면으로 전환된다.
 */
export default function SmsSendModal({ recipients, onClose }) {
    const selectable = useMemo(() => recipients.filter(r => r.phone), [recipients]);
    const [selected, setSelected] = useState(() => new Set());
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null); // null이면 작성 화면, 배열이면 결과 화면

    const byteLen = getSmsByteLength(message);
    const allChecked = selectable.length > 0 && selectable.every(r => selected.has(r.name));

    function toggleAll() {
        setSelected(allChecked ? new Set() : new Set(selectable.map(r => r.name)));
    }
    function toggleOne(name) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    }

    async function handleSend(targets) {
        if (!message.trim()) { alert('메시지를 입력해주세요.'); return; }
        if (targets.length === 0) { alert('받는 사람을 선택해주세요.'); return; }
        if (!confirm(`${targets.length}명에게 문자를 발송하시겠습니까?`)) return;
        setSending(true);
        try {
            const res = await sendManualSMS(targets, message.trim());
            setResults(res);
        } catch (err) {
            alert(`발송 처리 실패: ${err.message}`);
        } finally {
            setSending(false);
        }
    }

    // ── 결과 화면 ──
    if (results) {
        const failed = results.filter(r => !r.success);
        return (
            <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
                <div style={modalStyle}>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>발송 결과</h2>
                    <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        성공 {results.length - failed.length}건 · 실패 {failed.length}건
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                        {results.map(r => (
                            <div key={r.name} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px 10px', borderRadius: '8px',
                                background: r.success ? '#31A5521A' : '#E94E581A',
                                border: `1px solid ${r.success ? '#31A5524D' : '#E94E584D'}`,
                                fontSize: '0.88rem',
                            }}>
                                <span style={{ color: 'var(--text)' }}>{r.name} <span style={{ color: 'var(--text-muted)' }}>{r.phone}</span></span>
                                <span style={{ color: r.success ? '#31A552' : '#E94E58', fontWeight: 700 }}>
                                    {r.success ? '✓ 성공' : `✗ ${r.error || '실패'}`}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {failed.length > 0 && (
                            <button
                                onClick={() => handleSend(failed.map(f => ({ name: f.name, phone: f.phone })))}
                                disabled={sending}
                                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid #E94E584D', background: '#E94E581A', color: '#E94E58', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1 }}
                            >
                                {sending ? '재발송 중...' : `실패자만 재발송 (${failed.length}명)`}
                            </button>
                        )}
                        <button onClick={onClose} disabled={sending} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--cta-dark)', color: '#fff', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.6 : 1 }}>
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── 작성 화면 ──
    return (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
            <div style={modalStyle}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1.15rem' }}>문자 보내기</h2>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--hairline)' }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    전체 선택 ({selected.size}/{selectable.length})
                </label>
                <div style={{ maxHeight: '220px', overflowY: 'auto', margin: '4px 0 12px' }}>
                    {recipients.map(r => (
                        <label key={r.name} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '7px 4px', fontSize: '0.88rem',
                            opacity: r.phone ? 1 : 0.55,
                        }}>
                            <input
                                type="checkbox"
                                checked={selected.has(r.name)}
                                disabled={!r.phone}
                                onChange={() => toggleOne(r.name)}
                            />
                            <span style={{ color: 'var(--text)' }}>{r.name}</span>
                            {r.phone
                                ? <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{r.phone}</span>
                                : <span style={{ marginLeft: 'auto', color: '#E94E58', fontSize: '0.78rem', fontWeight: 700 }}>⚠ 번호 없음</span>}
                        </label>
                    ))}
                </div>

                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="보낼 내용을 입력하세요"
                    rows={5}
                    style={{
                        width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                        border: '1px solid var(--hairline)', borderRadius: '8px',
                        fontSize: '0.92rem', fontFamily: 'inherit', resize: 'vertical',
                    }}
                />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 14px' }}>
                    {byteLen}바이트 {byteLen > 90 ? '· 90바이트 초과 — LMS(장문)로 발송됩니다' : '· 90바이트 이하 SMS'}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={onClose} disabled={sending} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--hairline)', background: 'var(--canvas-tint)', color: 'var(--text)', cursor: 'pointer' }}>
                        취소
                    </button>
                    <button
                        onClick={() => handleSend(recipients.filter(r => selected.has(r.name) && r.phone))}
                        disabled={sending || selected.size === 0 || !message.trim()}
                        style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending || selected.size === 0 || !message.trim() ? 0.6 : 1 }}
                    >
                        {sending ? '발송 중...' : `발송 (${selected.size}명)`}
                    </button>
                </div>
            </div>
        </div>
    );
}
