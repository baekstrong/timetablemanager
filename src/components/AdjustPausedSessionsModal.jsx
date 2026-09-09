import { useEffect, useRef, useState } from 'react';
import { getPausedStudentAdjustmentInfo, adjustPausedStudentSessions } from '../services/googleSheetsService';
import { planPausedSessionAdjustment } from '../utils/pausedSessions';
import './ResumeStudentModal.css';

export default function AdjustPausedSessionsModal({ studentName, onClose, onSaved }) {
    const [info, setInfo] = useState(null);
    const [target, setTarget] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const dialog = useRef(null);
    const savingRef = useRef(false);
    const total = info?.registrations.reduce((sum, row) => sum + row.n, 0) || 0;
    let plan = [];
    let validation = '';
    if (info && target !== '') {
        try { plan = planPausedSessionAdjustment(info.registrations, target); }
        catch (err) { validation = err.message; }
    }
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    useEffect(() => {
        let cancelled = false;
        getPausedStudentAdjustmentInfo(studentName).then(value => {
            if (!cancelled) { setInfo(value); setError(''); }
        }).catch(err => { if (!cancelled) setError(err.message); });
        return () => { cancelled = true; };
    }, [studentName, attempt]);

    const save = async event => {
        event.preventDefault();
        if (savingRef.current || !plan.length || !reason.trim()) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            await adjustPausedStudentSessions(studentName, target, reason, info.snapshot);
        } catch (err) {
            // 응답 유실일 수 있으므로 재조회 전에는 다시 저장하지 않는다.
            setInfo(null);
            setTarget('');
            setError(`${err.message} 최신 정보를 다시 읽고 반영 여부를 확인해주세요.`);
            setSaving(false);
            savingRef.current = false;
            return;
        }
        onSaved();
    };

    return (
        <dialog ref={dialog} className="resume-modal adjustment-dialog" aria-labelledby="adjustment-title"
            onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
            <form onSubmit={save}>
                <div className="resume-modal-heading">
                    <div><h2 id="adjustment-title">잔여 횟수 조정</h2><p>{studentName} · 일시정지</p></div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="닫기">닫기</button>
                </div>
                {!info && !error && <p role="status">정지된 등록을 불러오는 중...</p>}
                {error && <p role="alert">{error}</p>}
                {!info && error && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>최신 정보 다시 읽기</button>}
                {info && <>
                    <p>현재 총 <strong>{total}회</strong> · 등록 {info.registrations.length}건</p>
                    <p>먼저 사용할 등록부터 차감합니다. 0회가 된 등록은 소진 완료로 처리하며 결제 이력은 보존합니다.</p>
                    <label className="adjustment-field">최종 잔여 횟수
                        <input type="number" min="0" max={total - 1} step="1" required value={target}
                            onChange={event => setTarget(event.target.value)} disabled={saving} />
                    </label>
                    {validation && <p role="alert">{validation}</p>}
                    <table className="adjustment-table"><caption>등록별 변경 미리보기</caption>
                        <thead><tr><th scope="col">등록</th><th scope="col">현재</th><th scope="col">변경 후</th></tr></thead>
                        <tbody>{info.registrations.map((row, index) => <tr key={`${row.sheetName}-${row.sheetRow}`}>
                            <th scope="row">{row.sheetName}<br />{row.sheetRow}행 · 사용 순서 {index + 1}</th>
                            <td>{row.n}회</td><td>{plan[index] ? `${plan[index].after}회${plan[index].after === 0 ? ' · 소진 완료' : ''}` : '—'}</td>
                        </tr>)}</tbody>
                    </table>
                    {plan.length > 0 && <p><strong>총 {total}회 → {Number(target)}회 ({total - Number(target)}회 차감)</strong></p>}
                    <label className="adjustment-field">조정 사유
                        <textarea required maxLength={300} rows={3} value={reason}
                            onChange={event => setReason(event.target.value)} disabled={saving} />
                    </label>
                    <p>{target === '0' ? '모든 잔여 수업이 소진되며 정지 목록에서 제외됩니다.' : '남은 수업은 일시정지를 유지합니다.'}</p>
                    <button type="submit" disabled={saving || !plan.length || !reason.trim()}>{saving ? '저장 중...' : '위 내용으로 차감 저장'}</button>
                </>}
            </form>
        </dialog>
    );
}
