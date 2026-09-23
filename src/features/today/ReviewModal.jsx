import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import './TodayViews.css';

export default function ReviewModal({ title, children, onClose, busy = false, wide = false }) {
    const ref = useRef(null);
    const titleId = useId();
    useEffect(() => {
        const dialog = ref.current;
        const previousFocus = document.activeElement;
        const scrollY = window.scrollY;
        const original = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow };
        Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
        dialog.showModal();
        return () => {
            dialog.close();
            Object.assign(document.body.style, original);
            window.scrollTo(0, scrollY);
            previousFocus?.focus?.();
        };
    }, []);
    return createPortal(<dialog ref={ref} className={`today-modal${wide ? ' today-modal-wide' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <header><h2 id={titleId}>{title}</h2><button type="button" aria-label="모달 닫기" disabled={busy} onClick={onClose}>×</button></header>
        <div className="today-modal-content">{children}</div>
    </dialog>, document.body);
}
