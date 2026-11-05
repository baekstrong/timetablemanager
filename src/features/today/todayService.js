import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { readSheetData, writeSheetData } from '../../services/googleSheetsService';

export async function confirmStudentPayment(student, date, method) {
    const sheet = student._foundSheetName;
    const row = student._rowIndex + 3;
    const parsedDate = new Date(`${date}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
    if (!sheet || !Number.isInteger(student._rowIndex) || student._rowIndex < 0 || !validDate || !['카드', '네이버', '제로페이', '계좌'].includes(method)) {
        throw new Error('등록 위치 또는 결제 정보를 확인할 수 없습니다. 새로고침해주세요.');
    }
    const [fresh] = await readSheetData(`${sheet}!B${row}:L${row}`);
    if (!fresh || fresh[0] !== student['이름'] || String(fresh[9] || '').trim().toUpperCase() !== 'X'
        || String(fresh[5] || '') !== String(student['시작날짜'] || '')
        || String(fresh[6] || '') !== String(student['종료날짜'] || '')) {
        throw new Error('등록 정보가 변경되었습니다. 새로고침 후 다시 확인해주세요.');
    }
    // Only J/K/L of the selected registration; never rewrite another month's row.
    await writeSheetData(`${sheet}!J${row}:L${row}`, [[date.slice(2).replaceAll('-', ''), 'O', method]]);
}

// 수강생 체크리스트(coachPinnedMemos/{이름}) — 코치 첫 화면 표시용. 이름당 문서 1개 읽기.
export async function readCoachChecklists(names) {
    const entries = await Promise.all([...new Set(names)].map(async name => {
        const snapshot = await getDoc(doc(db, 'coachPinnedMemos', name));
        return [name, snapshot.exists() ? snapshot.data().memos || [] : []];
    }));
    return Object.fromEntries(entries);
}

// 코치 첫 화면에서 체크리스트 완료/취소 — 훈련일지 수강생 체크와 같은 모양(done, doneAt). 지우지 않는다.
// 최신 문서를 트랜잭션으로 다시 읽어 그사이 수강생이 바꾼 다른 항목을 덮지 않는다. 예전 항목은 id가 없어 위치+문장으로 찾는다.
export async function setChecklistDone(name, item, done) {
    const ref = doc(db, 'coachPinnedMemos', name);
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const memos = snapshot.exists() ? [...(snapshot.data().memos || [])] : [];
        const at = item.id ? memos.findIndex(memo => String(memo.id) === String(item.id))
            : memos[item.index]?.memo === item.text ? item.index : memos.findIndex(memo => memo.memo === item.text && memo.exercise === item.exercise);
        if (at < 0) throw new Error('항목이 바뀌었습니다. 새로고침해주세요.');
        const next = { ...memos[at], done };
        if (done) next.doneAt = new Date().toISOString(); else delete next.doneAt;
        memos[at] = next;
        transaction.set(ref, { userName: name, memos, updatedAt: serverTimestamp() }, { merge: true });
        return memos;
    });
}
