import { useState } from 'react';
import ReviewModal from '../../features/today/ReviewModal';
import { classLabel } from './studentClassModel';
import './MakeupSwapBoard.css';

/**
 * 이번 주 맞교환 현황판 (2026-11-11 사용자 결정, docs/makeup-swap-2026-11-11.md).
 * 보강 대기가 곧 교환 요청이다. 요청자가 원하는 칸에 내 정규 수업이 있으면 '바꾸기'로 즉시 확정.
 * 이름 공개, 이번 주만, 두 사람 모두 보강 1회, 확정 뒤 취소 불가.
 * @param {object[]} entries - swapBoardEntries 결과(이번 주 교환 요청)
 * @param {(entry) => { session: object|null, reason: string }} check - 내가 받아줄 수 있는지
 * @param {(entry, session) => Promise<boolean>} onAccept - 확정. 성공하면 true
 */
export default function MakeupSwapBoard({ entries = [], myName, check, onAccept, quotaUsed = 0, quotaLimit = 0, readOnly = false, disabledReason = '' }) {
    const [pending, setPending] = useState(null);
    const [busy, setBusy] = useState(false);
    const mine = entries.filter(e => e.studentName === myName);
    const others = entries.filter(e => e.studentName !== myName);

    async function confirm() {
        if (!pending || busy) return;
        setBusy(true);
        try {
            if (await onAccept(pending.entry, pending.session)) setPending(null);
        } finally {
            setBusy(false);
        }
    }

    return <section className="swap-board" aria-labelledby="swap-board-title">
        <div className="swap-board-head"><h2 id="swap-board-title">이번 주 맞교환</h2><span>{entries.length}건</span></div>
        <p className="swap-board-help">만석이라 옮기기 어려울 때 서로 자리를 바꿔요. 만석 칸에 대기를 걸면 여기에 올라가요. 교환하면 두 사람 모두 이번 주 보강 1회를 쓰고, 확정되면 바로 알림이 가요.</p>
        {mine.map(entry => <div className="swap-board-card is-mine" key={entry.id}>
            <span className="swap-board-chip">내 교환 요청</span>
            <div className="swap-board-move">{classLabel(entry.originalClass)}<span aria-hidden="true">→</span>{classLabel(entry)}</div>
            <p>그 시간 수강생이 받아주면 바로 바뀌고 알림이 와요. 내리려면 위 대기 카드에서 대기를 취소하세요.</p>
        </div>)}
        {others.map(entry => {
            const { session, reason } = check(entry);
            return <div className={`swap-board-card${session ? '' : ' is-muted'}`} key={entry.id}>
                <div className="swap-board-who"><strong>{entry.studentName}</strong>님</div>
                <div className="swap-board-move">{classLabel(entry.originalClass)}<span aria-hidden="true">→</span>{classLabel(entry)}</div>
                {!session ? <p>내 수업과 맞는 칸이 아니에요.</p>
                    : reason ? <p>{reason}</p>
                    : <button type="button" className="student-class-button primary" disabled={readOnly || Boolean(disabledReason)}
                        onClick={() => setPending({ entry, session })}>내 {classLabel(session)} ↔ {classLabel(entry.originalClass)} 바꾸기</button>}
            </div>;
        })}
        {!entries.length && <p className="swap-board-empty">이번 주 교환 요청이 없어요.</p>}
        {pending && <ReviewModal title="맞교환 확정" busy={busy} onClose={() => !busy && setPending(null)}>
            <div className="student-class-modal">
                <div className="student-class-route">
                    <div><span>바꾸기 전 (내 수업)</span><strong>{classLabel(pending.session)}</strong></div>
                    <span aria-hidden="true">↓</span>
                    <div><span>바꾼 뒤</span><strong>{classLabel(pending.entry.originalClass)}</strong></div>
                </div>
                <ul className="swap-board-facts">
                    <li>{pending.entry.studentName}님이 내 자리로, 나는 {pending.entry.studentName}님 자리로 가요.</li>
                    <li>이번 주 보강 1회를 써요 ({quotaUsed}/{quotaLimit}회 → {quotaUsed + 1}/{quotaLimit}회). {pending.entry.studentName}님도 1회 써요.</li>
                    <li>확정하면 {pending.entry.studentName}님에게 바로 알림이 가요. <strong>확정 뒤엔 취소할 수 없어요.</strong></li>
                </ul>
                <div className="student-class-actions">
                    <button type="button" className="student-class-button" disabled={busy} onClick={() => setPending(null)}>취소</button>
                    <button type="button" className="student-class-button primary" disabled={busy} onClick={confirm}>{busy ? '교환 중…' : '교환 확정'}</button>
                </div>
            </div>
        </ReviewModal>}
    </section>;
}
