import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';
import { gradeRank } from '../utils/grades';

function userReference(userName) {
    const name = String(userName || '').trim();
    if (!name) throw new Error('성장 정보를 확인할 수강생 이름이 필요합니다.');
    if (!db) throw new Error('성장 정보를 불러올 수 없습니다.');
    return { name, reference: doc(db, 'users', name) };
}

function growthSnapshot(userName, data) {
    return {
        userName,
        xp: typeof data.xp === 'number' && Number.isFinite(data.xp) ? data.xp : null,
        grade: data.grade || null,
        gradeSeen: data.gradeSeen || null,
        tier: data.tier || null,
        tierMonth: data.tierMonth || null,
        prevTier: data.prevTier || null,
        tierIntroPending: data.tierIntroPending === true,
    };
}

// 저장된 본인 성장 정보만 조회한다. XP 시딩·티어 계산·확인 처리는 실행하지 않는다.
export async function getStudentGrowth(userName) {
    const { name, reference } = userReference(userName);
    const snapshot = await getDoc(reference);
    if (!snapshot.exists()) throw new Error('성장 정보를 불러올 사용자 정보를 찾지 못했습니다.');
    return growthSnapshot(name, snapshot.data() || {});
}

// UI에서 실제 확인한 이벤트만 전달한다. 이름은 화면을 연 당시의 소유자를 사용한다.
// 훈련일지와 동일하게 gradeSeen은 확인한 최고 학년이며 절대 내려가지 않는다.
export async function acknowledgeStudentGrowth({ userName, tier, grade } = {}) {
    const { name, reference } = userReference(userName);
    if (grade != null && gradeRank(grade) < 0) throw new Error('확인할 학년 정보가 올바르지 않습니다.');
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error('성장 정보를 확인할 사용자 정보를 찾지 못했습니다.');
        const data = snapshot.data() || {};
        const patch = {};
        const tierAcknowledged = Boolean(tier?.month && tier?.tier && data.tierMonth === tier.month && data.tier === tier.tier);
        if (tierAcknowledged && data.tierIntroPending) patch.tierIntroPending = false;
        if (grade != null && gradeRank(grade) > gradeRank(data.gradeSeen)) patch.gradeSeen = grade;
        const next = { ...data, ...patch };
        const updated = Object.keys(patch).length > 0;
        if (updated) transaction.update(reference, patch);
        return {
            ...growthSnapshot(name, next), updated, tierAcknowledged,
            gradeAcknowledged: grade != null && gradeRank(next.gradeSeen) >= gradeRank(grade),
        };
    });
}
