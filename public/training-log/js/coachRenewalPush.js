import { state } from './state.js';

let coachName = null;
let stopListening = null;

export function stopCoachRenewalPush() {
    stopListening?.();
    stopListening = null;
    coachName = null;
}

// Training log has no reminder popup or polling. A push that focuses this
// document can still take the authenticated coach to the main app's Today page.
export function syncCoachRenewalPush() {
    const authenticatedCoach = state.isCoach && state.currentUser ? state.currentUser : null;
    if (authenticatedCoach === coachName) return;
    stopCoachRenewalPush();
    if (!authenticatedCoach) return;
    const auth = window.firebase?.auth();
    const signedInUser = auth?.currentUser;
    const serviceWorker = window.navigator?.serviceWorker;
    if (!signedInUser || !serviceWorker) return;
    coachName = authenticatedCoach;

    let disposed = false;
    let unsubscribeAuth = () => {};
    const onPushMessage = async event => {
        if (event.data?.type !== 'notificationClick' || event.data.page !== 'today') return;
        try {
            const user = auth.currentUser;
            if (disposed || user !== signedInUser) return;
            const identity = await user.getIdTokenResult();
            if (!disposed && user === auth.currentUser && state.isCoach && state.currentUser === authenticatedCoach
                && identity?.claims?.isCoach === true && identity.claims.name === authenticatedCoach) {
                window.bottomNavNavigate('today');
            }
        } catch { /* Only an authenticated coach may open the private task list. */ }
    };
    serviceWorker.addEventListener('message', onPushMessage);
    stopListening = () => {
        disposed = true;
        unsubscribeAuth();
        serviceWorker.removeEventListener('message', onPushMessage);
    };
    // Other tabs share Firebase Auth. No token read is needed until a push click.
    unsubscribeAuth = auth.onIdTokenChanged(user => {
        if (!disposed && (user !== signedInUser || user !== auth.currentUser)) stopCoachRenewalPush();
    });
    if (disposed) unsubscribeAuth();
}
