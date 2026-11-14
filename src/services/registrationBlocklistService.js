import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { addBlockEntry, blocklistIndex, removeBlockEntry } from '../utils/registrationBlocklist';

// 코치만 읽고 쓴다(규칙). 비로그인 신청 화면은 이 문서를 읽지 않는다.
const ref = () => {
    if (!db) throw new Error('차단 명단에 연결할 수 없습니다.');
    return doc(db, 'registrationBlocklist', 'main');
};

export async function getRegistrationBlocklist() {
    const snap = await getDocFromServer(ref());
    return snap.exists() ? (snap.data().entries || []) : [];
}

async function mutate(change) {
    const target = ref();
    let next = [];
    await runTransaction(db, async tx => {
        const snap = await tx.get(target);
        next = change(snap.exists() ? (snap.data().entries || []) : []);
        tx.set(target, { entries: next, ...blocklistIndex(next), updatedAt: serverTimestamp() });
    });
    return next;
}

export const addRegistrationBlock = entry => mutate(entries => addBlockEntry(entries, entry));
export const removeRegistrationBlock = id => mutate(entries => removeBlockEntry(entries, id));
