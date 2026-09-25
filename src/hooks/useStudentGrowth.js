import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { refreshStudentTier, refreshStudentXP } from '../services/firebaseService';
import { getStudentGrowth, acknowledgeStudentGrowth } from '../services/studentGrowthService';
import { createStudentGrowthController, growthChanges } from '../utils/studentGrowthState';

const SERVICES = { refreshStudentTier, refreshStudentXP, getStudentGrowth, acknowledgeStudentGrowth };

export function useStudentGrowth({ user, gender = '', ready = true, readOnly = false, month = '', services = SERVICES }) {
    const controller = useMemo(() => createStudentGrowthController(services), [services]);
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    const userName = user?.role === 'student' ? user.username : '';
    const key = userName ? JSON.stringify([userName, readOnly]) : '';
    const calculate = ready && !readOnly;
    const calculationGender = readOnly ? '' : gender;

    useEffect(() => {
        if (!userName) { controller.reset(); return; }
        void controller.load({ key, userName, gender: calculationGender, readOnly, calculate, month });
    }, [controller, key, userName, calculationGender, calculate, readOnly, month]);

    useEffect(() => {
        if (!userName) return;
        const refreshVisibleProfile = () => {
            if (document.visibilityState === 'visible') void controller.load({ key, userName, readOnly, calculate: false, month });
        };
        window.addEventListener('focus', refreshVisibleProfile);
        window.addEventListener('pageshow', refreshVisibleProfile);
        document.addEventListener('visibilitychange', refreshVisibleProfile);
        return () => {
            window.removeEventListener('focus', refreshVisibleProfile);
            window.removeEventListener('pageshow', refreshVisibleProfile);
            document.removeEventListener('visibilitychange', refreshVisibleProfile);
        };
    }, [controller, key, userName, readOnly, month]);

    const current = snapshot.key === key && userName ? snapshot : null;
    const changes = growthChanges(current?.profile);
    return {
        tier: current?.profile?.tier,
        xp: current?.profile?.xp,
        loading: !current || current.loading || (!ready && !readOnly),
        error: current?.error || '',
        ...changes,
        showNotice: ready && !readOnly && Boolean(changes.eventKey) && !current?.loading && !current?.error && current?.dismissedEvent !== changes.eventKey,
        busy: Boolean(current?.busy),
        confirmError: current?.confirmError || '',
        confirm: readOnly ? () => {} : controller.confirm,
        later: controller.later,
        retry: () => { if (userName) void controller.load({ key, userName, gender: calculationGender, readOnly, calculate, month, force: true }); },
    };
}
