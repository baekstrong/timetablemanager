import { gradeRank } from './grades';
import { compareTiers, tierByKey } from './tiers';

export function growthChanges(profile) {
    if (!profile) return { tierChange: null, gradeChange: null, eventKey: '' };
    const tierChange = profile.tierIntroPending && profile.tierMonth && tierByKey(profile.tier)
        && (!profile.prevTier || profile.prevTier !== profile.tier)
        ? { changed: true, tier: profile.tier, prevTier: profile.prevTier, month: profile.tierMonth,
            isNew: !profile.prevTier, direction: profile.prevTier ? compareTiers(profile.prevTier, profile.tier) : 0 }
        : null;
    const gradeChange = gradeRank(profile.grade) >= 0 && gradeRank(profile.grade) > gradeRank(profile.gradeSeen)
        ? { from: profile.gradeSeen, to: profile.grade, isNew: !profile.gradeSeen } : null;
    const eventKey = tierChange || gradeChange
        ? JSON.stringify([profile.userName, tierChange?.month, tierChange?.prevTier, tierChange?.tier, gradeChange?.to]) : '';
    return { tierChange, gradeChange, eventKey };
}

const emptyState = key => ({ key, profile: null, loading: false, error: '', busy: false, readOnly: false, confirmError: '', dismissedEvent: '' });
const PROFILE_REFRESH_COOLDOWN_MS = 1500;

// App 수명에 보존한다. 탭 이탈은 미확인 이벤트를 소비하지 않고, 계정 변경은 이전 응답을 무시한다.
export function createStudentGrowthController(services) {
    let snapshot = emptyState('');
    let generation = 0;
    let inFlight = null;
    let pendingCalculation = null;
    let completedCalculation = '';
    let profileReadAt = null;
    const listeners = new Set();
    const publish = patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
    const reset = key => { generation++; inFlight = null; pendingCalculation = null; completedCalculation = ''; profileReadAt = null; snapshot = emptyState(key); listeners.forEach(listener => listener()); };

    async function load({ key, userName, gender = '', readOnly = false, calculate = true, month = '', force = false }) {
        if (snapshot.key !== key) reset(key);
        const shouldCalculate = !readOnly && calculate;
        const calculationSignature = JSON.stringify([key, gender, month]);
        if (snapshot.busy) {
            // 월·성별 변경은 확인 저장 뒤 최신 요청으로 한 번 계산한다.
            if (shouldCalculate) pendingCalculation = { key, userName, gender, readOnly, calculate, month, force };
            return;
        }
        const signature = JSON.stringify([key, shouldCalculate ? gender : '', readOnly, shouldCalculate, month]);
        // 화면 복귀의 단순 읽기가 진행 중인 계산을 무효화해 옛 값으로 되돌리지 않는다.
        if (inFlight?.key === key && !shouldCalculate) return inFlight.promise;
        if (inFlight?.signature === signature) return inFlight.promise;
        if (!force && !snapshot.error && snapshot.profile) {
            // 명단 refresh의 ready 재전환은 같은 월/성별을 다시 계산할 이유가 없다.
            if (shouldCalculate && completedCalculation === calculationSignature && (!inFlight || !inFlight.shouldCalculate)) return inFlight?.promise;
            // focus/pageshow/visibilitychange가 약간의 간격으로 연이어 와도 한 번만 읽는다.
            if (!shouldCalculate && profileReadAt !== null && Date.now() - profileReadAt < PROFILE_REFRESH_COOLDOWN_MS) return;
        }
        const request = ++generation;
        publish({ loading: true, error: '', readOnly });
        const promise = (async () => {
            try {
                if (shouldCalculate) await Promise.all([
                    services.refreshStudentTier({ userName, deferSeen: true }),
                    services.refreshStudentXP({ userName, gender, deferSeen: true }),
                ]);
                const profile = await services.getStudentGrowth(userName);
                if (request === generation) {
                    if (shouldCalculate) completedCalculation = calculationSignature;
                    profileReadAt = Date.now();
                    publish({ profile, loading: false, error: '' });
                }
            } catch {
                if (request === generation) publish({ loading: false, error: '성장 정보를 불러오지 못했어요.' });
            } finally {
                if (request === generation) inFlight = null;
            }
        })();
        inFlight = { key, signature, shouldCalculate, promise };
        return promise;
    }

    async function confirm() {
        if (snapshot.readOnly || snapshot.busy || snapshot.loading || snapshot.error || !snapshot.profile) return;
        const { tierChange, gradeChange, eventKey } = growthChanges(snapshot.profile);
        if (!eventKey) return;
        const request = generation;
        const profile = snapshot.profile;
        publish({ busy: true, confirmError: '' });
        try {
            const updated = await services.acknowledgeStudentGrowth({
                userName: profile.userName,
                tier: tierChange ? { month: tierChange.month, tier: tierChange.tier } : undefined,
                grade: gradeChange?.to,
            });
            if (request === generation) {
                profileReadAt = Date.now();
                publish({ profile: updated, busy: false, confirmError: '', dismissedEvent: '' });
            }
        } catch {
            if (request === generation) publish({ busy: false, confirmError: '확인을 저장하지 못했어요. 다시 눌러주세요.' });
        } finally {
            if (request === generation && pendingCalculation?.key === snapshot.key) {
                const next = pendingCalculation;
                pendingCalculation = null;
                await load(next);
            }
        }
    }

    return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        load, confirm,
        reset: () => reset(''),
        later: () => { if (!snapshot.busy) publish({ dismissedEvent: growthChanges(snapshot.profile).eventKey }); },
    };
}
