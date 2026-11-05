import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { readSheetData, writeSheetData } from '../../services/googleSheetsService';

// Same protected document used by training-log. Never import/load this from student UI.
export async function readCoachNotes() {
    const snapshot = await getDoc(doc(db, 'coachNotes', 'notes'));
    return snapshot.exists() ? snapshot.data().map || {} : {};
}

export async function saveCoachNote(name, note) {
    if (!name) throw new Error('수강생을 선택해주세요.');
    await setDoc(doc(db, 'coachNotes', 'notes'), {
        map: { [name]: note.trim() }, updatedAt: serverTimestamp(),
    }, { merge: true });
}

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
