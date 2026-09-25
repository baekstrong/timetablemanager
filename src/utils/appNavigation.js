// Keep notification links and the standalone training-log return path compatible.
export function getLoginPage({ role, targetPage, hasPost = false }) {
    if (targetPage) return role !== 'coach' && targetPage === 'today' ? 'schedule' : targetPage;
    if (hasPost) return 'dashboard';
    return role === 'coach' ? 'today' : 'schedule';
}
