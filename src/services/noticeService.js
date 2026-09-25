import { collection, doc, FieldPath, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getNoticeRevision, isNoticeUnread } from '../utils/noticeState';

function requireDatabase() {
    if (!db) throw new Error('공지 정보를 불러올 수 없습니다.');
}

function noticeReadsFrom(data) {
    const reads = data?.noticeReads;
    if (!reads || typeof reads !== 'object' || Array.isArray(reads)) return {};
    return Object.fromEntries(Object.entries(reads).filter(([, revision]) => Number.isFinite(revision) && revision >= 0));
}

export async function getNoticeSummaries() {
    requireDatabase();
    // Match the board's category query; no additional composite index is needed.
    const snapshot = await getDocs(query(collection(db, 'posts'), where('category', '==', 'notice')));
    return snapshot.docs
        .map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
        .filter(post => post.category === 'notice' && post.pinned === true && !post.deleted)
        .sort((a, b) => getNoticeRevision({ createdAt: b.createdAt }) - getNoticeRevision({ createdAt: a.createdAt })
            || a.id.localeCompare(b.id))
        .map(({ id, title, createdAt, updatedAt, pinned }) => ({ id, title, createdAt, updatedAt, pinned: Boolean(pinned) }));
}

export async function getNoticeReads(username) {
    if (!username) return {};
    requireDatabase();
    const snapshot = await getDoc(doc(db, 'users', username));
    return snapshot.exists() ? noticeReadsFrom(snapshot.data()) : {};
}

// Call only after the actual detail has loaded. Keep this user's other read
// markers and any newer revision accepted by another tab/device intact.
export async function markNoticeRead(username, post) {
    if (!username || !post?.id || post.category !== 'notice' || post.deleted) return false;
    requireDatabase();
    const reference = doc(db, 'users', username);
    const revision = getNoticeRevision(post);
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error('공지 확인 상태를 저장할 사용자 정보를 찾지 못했습니다.');
        if (!isNoticeUnread(post, noticeReadsFrom(snapshot.data()))) return false;
        // A FieldPath treats dots in an ID as part of the ID, not nested fields.
        transaction.update(reference, new FieldPath('noticeReads', post.id), revision);
        return true;
    });
}
