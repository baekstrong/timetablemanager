import { collection, doc, FieldPath, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getNoticeRevision, isNoticeUnread } from '../utils/noticeState';

export const NOTICE_SUMMARIES_TTL = 60_000;
export const NOTICE_READS_TTL = 1_500;
let summariesCache = null;
let summariesPending = null;
const readsCache = new Map();
const readsPending = new Map();

function requireDatabase() {
    if (!db) throw new Error('공지 정보를 불러올 수 없습니다.');
}

function noticeReadsFrom(data) {
    const reads = data?.noticeReads;
    if (!reads || typeof reads !== 'object' || Array.isArray(reads)) return {};
    return Object.fromEntries(Object.entries(reads).filter(([, revision]) => Number.isFinite(revision) && revision >= 0));
}

export async function getNoticeSummaries({ force = false } = {}) {
    if (summariesPending) return summariesPending;
    if (!force && summariesCache?.expiresAt > Date.now()) return summariesCache.value;
    summariesPending = (async () => {
        requireDatabase();
        // A single indexed equality reads pinned posts only. Keep every pinned
        // notice; filtering the category locally needs no new composite index.
        const snapshot = await getDocs(query(collection(db, 'posts'), where('pinned', '==', true)));
        const value = snapshot.docs
            .map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
            .filter(post => post.category === 'notice' && post.pinned === true && !post.deleted)
            .sort((a, b) => getNoticeRevision({ createdAt: b.createdAt }) - getNoticeRevision({ createdAt: a.createdAt })
                || a.id.localeCompare(b.id))
            .map(({ id, title, createdAt, updatedAt, pinned }) => ({ id, title, createdAt, updatedAt, pinned: Boolean(pinned) }));
        summariesCache = { value, expiresAt: Date.now() + NOTICE_SUMMARIES_TTL };
        return value;
    })().finally(() => { summariesPending = null; });
    return summariesPending;
}

function cacheNoticeReads(username, reads) {
    const revisions = new Map(Object.entries(readsCache.get(username)?.value || {}));
    for (const [id, revision] of Object.entries(reads)) revisions.set(id, Math.max(revisions.get(id) ?? 0, revision));
    const value = Object.fromEntries(revisions);
    readsCache.set(username, { value, expiresAt: Date.now() + NOTICE_READS_TTL });
    return value;
}

export async function getNoticeReads(username, { force = false } = {}) {
    if (!username) return {};
    if (readsPending.has(username)) return readsPending.get(username);
    const cached = readsCache.get(username);
    if (!force && cached?.expiresAt > Date.now()) return cached.value;
    const request = (async () => {
        requireDatabase();
        const snapshot = await getDoc(doc(db, 'users', username));
        // An earlier read may finish after a successful detail acknowledgement.
        // Merge revision maxima so that stale responses cannot bring N back.
        return cacheNoticeReads(username, snapshot.exists() ? noticeReadsFrom(snapshot.data()) : {});
    })().finally(() => { if (readsPending.get(username) === request) readsPending.delete(username); });
    readsPending.set(username, request);
    return request;
}

// Call only after the actual detail has loaded. Keep this user's other read
// markers and any newer revision accepted by another tab/device intact.
export async function markNoticeRead(username, post) {
    if (!username || !post?.id || post.category !== 'notice' || post.deleted) return false;
    requireDatabase();
    const reference = doc(db, 'users', username);
    const revision = getNoticeRevision(post);
    const result = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error('공지 확인 상태를 저장할 사용자 정보를 찾지 못했습니다.');
        const reads = noticeReadsFrom(snapshot.data());
        if (!isNoticeUnread(post, reads)) return { changed: false, reads };
        // A FieldPath treats dots in an ID as part of the ID, not nested fields.
        transaction.update(reference, new FieldPath('noticeReads', post.id), revision);
        return { changed: true, reads: { ...reads, [post.id]: revision } };
    });
    cacheNoticeReads(username, result.reads);
    return result.changed;
}
