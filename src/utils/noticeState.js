function timestampMillis(value) {
    const number = typeof value?.toMillis === 'function' ? value.toMillis()
        : value instanceof Date ? value.getTime()
            : typeof value === 'number' ? value
                : typeof value === 'string' ? Date.parse(value)
                    : typeof value?.seconds === 'number' ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6
                        : 0;
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

// A newer edit is unread again; an older response must never lower this revision.
export function getNoticeRevision(post) {
    return Math.max(timestampMillis(post?.createdAt), timestampMillis(post?.updatedAt));
}

export function isNoticeUnread(post, reads = {}) {
    if (!post?.id || post.deleted || (post.category !== undefined && post.category !== 'notice')) return false;
    const revision = Object.hasOwn(reads || {}, post.id) ? reads[post.id] : undefined;
    return !Number.isFinite(revision) || revision < getNoticeRevision(post);
}
