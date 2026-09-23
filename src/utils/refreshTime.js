export function formatRefreshAge(refreshedAt, now = Date.now()) {
    const minutes = Math.max(0, Math.floor((now - refreshedAt) / 60_000));
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    return `${hours}시간${minutes % 60 ? ` ${minutes % 60}분` : ''} 전`;
}
