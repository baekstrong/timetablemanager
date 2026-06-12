import { useState } from 'react';
import { updateUserPassword } from '../services/firebaseService';

const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    border: '1px solid var(--hairline)', borderRadius: '8px',
    fontSize: '0.92rem', marginBottom: '8px',
};

/** 내 정보 하단 비밀번호 변경 카드. 성공 시 localStorage 자격증명도 함께 갱신. */
export default function PasswordChangeCard({ userName }) {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState(null); // { ok: boolean, text: string }

    function syncLocalPassword(newPassword) {
        try {
            const cred = JSON.parse(localStorage.getItem('login_credentials') || 'null');
            if (cred && cred.username === userName) {
                localStorage.setItem('login_credentials', JSON.stringify({ ...cred, password: newPassword }));
            }
        } catch { /* 손상된 값은 무시 */ }
        try {
            const saved = JSON.parse(localStorage.getItem('savedUser') || 'null');
            if (saved && saved.name === userName) {
                localStorage.setItem('savedUser', JSON.stringify({ ...saved, password: newPassword }));
            }
        } catch { /* 손상된 값은 무시 */ }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setFeedback(null);
        if (!currentPw || !newPw || !confirmPw) {
            setFeedback({ ok: false, text: '모든 칸을 입력해주세요.' });
            return;
        }
        if (newPw.length < 4) {
            setFeedback({ ok: false, text: '새 비밀번호는 4자 이상이어야 합니다.' });
            return;
        }
        if (newPw !== confirmPw) {
            setFeedback({ ok: false, text: '새 비밀번호 확인이 일치하지 않습니다.' });
            return;
        }
        if (newPw === currentPw) {
            setFeedback({ ok: false, text: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' });
            return;
        }
        setSubmitting(true);
        try {
            await updateUserPassword(userName, currentPw, newPw);
            syncLocalPassword(newPw);
            setFeedback({ ok: true, text: '비밀번호가 변경되었습니다.' });
            setCurrentPw(''); setNewPw(''); setConfirmPw('');
        } catch (err) {
            setFeedback({ ok: false, text: err.message || '비밀번호 변경에 실패했습니다.' });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={{
            background: 'white', borderRadius: '16px', padding: '1.25rem',
            marginTop: '1rem', border: '1px solid var(--hairline)',
        }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 12px' }}>비밀번호 변경</h2>
            <form onSubmit={handleSubmit}>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                    placeholder="현재 비밀번호" autoComplete="current-password" style={inputStyle} />
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                    placeholder="새 비밀번호 (4자 이상)" autoComplete="new-password" style={inputStyle} />
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="새 비밀번호 확인" autoComplete="new-password" style={inputStyle} />
                {feedback && (
                    <div style={{
                        padding: '8px 10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '8px',
                        background: feedback.ok ? '#31A5521A' : '#E94E581A',
                        border: `1px solid ${feedback.ok ? '#31A5524D' : '#E94E584D'}`,
                        color: feedback.ok ? '#31A552' : '#E94E58',
                    }}>
                        {feedback.text}
                    </div>
                )}
                <button type="submit" disabled={submitting} style={{
                    width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none',
                    background: 'var(--accent)', color: '#fff', fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
                }}>
                    {submitting ? '변경 중...' : '비밀번호 변경'}
                </button>
            </form>
        </div>
    );
}
