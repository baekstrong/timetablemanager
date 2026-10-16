import { createCoachReminderController, createCoachReminderLoader } from '../../shared/coachRenewalReminder.js?v=20261016-renewal-reminder';
import { state } from './state.js';
import { FUNCTIONS_BASE } from './config.js';

// The dialog lives outside #app so changing the selected student or training
// date cannot dismiss it or make the class reminder appear a second time.
export function createCoachReminderDialog({ onDismiss, onOpenTasks, document: doc = document, window: win = window }) {
    let overlay = null;
    let currentItem = null;
    let previousFocus = null;
    let previousBodyStyle = null;
    let scrollY = 0;

    const element = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    function hide() {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        currentItem = null;
        doc.removeEventListener('keydown', onKeyDown, true);
        if (previousBodyStyle !== null) {
            if (previousBodyStyle) doc.body.setAttribute('style', previousBodyStyle);
            else doc.body.removeAttribute('style');
            win.scrollTo(0, scrollY);
        }
        previousBodyStyle = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        previousFocus = null;
    }

    function dismiss(openTasks = false) {
        const key = currentItem?.key;
        if (!key) return;
        hide();
        onDismiss(key);
        if (openTasks) onOpenTasks();
    }

    function onKeyDown(event) {
        if (!overlay) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            dismiss();
            return;
        }
        if (event.key !== 'Tab') return;
        const buttons = [...overlay.querySelectorAll('button')];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !overlay.contains(doc.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !overlay.contains(doc.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    }

    function show(item) {
        if (!item) { hide(); return true; }
        const isNew = !overlay;
        if (isNew && doc.querySelector('.modal.active, [aria-modal="true"], dialog[open]')) return false;
        currentItem = item;
        if (isNew) {
            previousFocus = doc.activeElement;
            previousBodyStyle = doc.body.getAttribute('style') || '';
            scrollY = win.scrollY;
            Object.assign(doc.body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
            overlay = element('div', 'coach-renewal-overlay');
            overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
            doc.body.appendChild(overlay);
            doc.addEventListener('keydown', onKeyDown, true);
        }

        const hadFocus = overlay.contains(doc.activeElement);
        overlay.replaceChildren();
        const dialog = element('section', 'coach-renewal-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'coachRenewalReminderTitle');
        dialog.setAttribute('aria-describedby', 'coachRenewalReminderDescription');

        const close = element('button', 'coach-renewal-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', '재등록 안내 닫기');
        close.addEventListener('click', () => dismiss());
        dialog.appendChild(close);

        const time = `${String(Math.floor(item.startMinute / 60)).padStart(2, '0')}:${String(item.startMinute % 60).padStart(2, '0')}`;
        dialog.appendChild(element('p', 'coach-renewal-time', `${item.period}교시 · ${time} 시작`));
        const title = element('h2', '', '수업 전 재등록 확인');
        title.id = 'coachRenewalReminderTitle';
        dialog.appendChild(title);
        const description = element('p', 'coach-renewal-description', '이번 수업에서 챙길 분들이에요.');
        description.id = 'coachRenewalReminderDescription';
        dialog.appendChild(description);

        const groups = element('div', 'coach-renewal-groups');
        for (const [label, names] of [['오늘 마지막 수업', item.lastNames], ['수강 종료·미재등록', item.delayedNames]]) {
            if (!names?.length) continue;
            const group = element('section', 'coach-renewal-group');
            group.appendChild(element('h3', '', `${label} · ${names.length}명`));
            const list = element('ul', '');
            names.forEach(name => list.appendChild(element('li', '', name)));
            group.appendChild(list);
            groups.appendChild(group);
        }
        dialog.appendChild(groups);
        dialog.appendChild(element('p', 'coach-renewal-hint', '닫아도 오늘 페이지의 할 일에는 계속 남아 있어요.'));

        const actions = element('div', 'coach-renewal-actions');
        const dismissButton = element('button', 'coach-renewal-dismiss', '닫기');
        dismissButton.type = 'button';
        dismissButton.addEventListener('click', () => dismiss());
        const tasksButton = element('button', 'coach-renewal-tasks', '할 일 보기');
        tasksButton.type = 'button';
        tasksButton.addEventListener('click', () => dismiss(true));
        actions.append(dismissButton, tasksButton);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        if (isNew || hadFocus) tasksButton.focus({ preventScroll: true });
        return true;
    }

    return { show, hide };
}

let coachName = null;
let stopReminder = null;

export function stopCoachRenewalReminder() {
    stopReminder?.();
    stopReminder = null;
    coachName = null;
}

// Called only by render(), after Auth has established the actual coach role.
// paintShell() uses saved display preferences and deliberately does not start it.
export function syncCoachRenewalReminder() {
    const authenticatedCoach = state.isCoach && state.currentUser ? state.currentUser : null;
    if (authenticatedCoach === coachName) return;
    stopCoachRenewalReminder();
    if (!authenticatedCoach) return;
    const auth = window.firebase?.auth();
    const signedInUser = auth?.currentUser;
    if (!signedInUser) return;
    coachName = authenticatedCoach;

    let storage = null;
    try { storage = window.localStorage; } catch { /* Continue with the shared memory ledger. */ }
    let disposed = false;
    let identityRevision = 0;
    let unsubscribeAuth = () => {};
    let controller;
    const getCoachToken = async () => {
        const user = auth.currentUser;
        const identity = await user?.getIdTokenResult();
        if (disposed || user !== signedInUser || user !== auth.currentUser
            || identity?.claims?.isCoach !== true || identity.claims.name !== authenticatedCoach) return null;
        return identity.token;
    };
    const dialog = createCoachReminderDialog({
        onDismiss: key => controller.dismiss(key),
        onOpenTasks: () => window.bottomNavNavigate('today'),
    });
    controller = createCoachReminderController({
        coachName,
        storage,
        loadSnapshot: createCoachReminderLoader({
            functionsUrl: FUNCTIONS_BASE,
            getToken: getCoachToken,
        }),
        onReminder: item => dialog.show(item),
        document,
        window,
    });
    const cleanup = controller.start();
    const serviceWorker = window.navigator?.serviceWorker;
    const onPushMessage = async event => {
        if (event.data?.type !== 'notificationClick' || event.data.page !== 'today') return;
        try {
            const token = await getCoachToken();
            if (token && !disposed && auth.currentUser === signedInUser) window.bottomNavNavigate('today');
        } catch { /* Only an authenticated coach may open the private task list. */ }
    };
    serviceWorker?.addEventListener('message', onPushMessage);
    stopReminder = () => {
        disposed = true;
        unsubscribeAuth();
        serviceWorker?.removeEventListener('message', onPushMessage);
        cleanup();
        dialog.hide();
    };
    // Firebase sessions are shared with the main app and other tabs. A role or
    // account change must also close a notice that is already on screen.
    unsubscribeAuth = auth.onIdTokenChanged(async user => {
        if (disposed) return;
        const revision = ++identityRevision;
        if (user !== signedInUser || auth.currentUser !== signedInUser) {
            stopCoachRenewalReminder();
            return;
        }
        try {
            const identity = await user.getIdTokenResult();
            if (disposed || revision !== identityRevision) return;
            if (user !== auth.currentUser || identity?.claims?.isCoach !== true || identity.claims.name !== authenticatedCoach) {
                stopCoachRenewalReminder();
            }
        } catch {
            // A failed identity read cannot leave an old registration notice
            // visible. The controller clears it and retries on the next return.
            if (!disposed && revision === identityRevision) void controller.refresh({ force: true });
        }
    });
    if (disposed) unsubscribeAuth();
}
