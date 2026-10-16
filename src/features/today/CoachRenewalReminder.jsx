import { useEffect, useRef, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { createCoachReminderController, createCoachReminderLoader } from '../../../public/shared/coachRenewalReminder.js';
import ReviewModal from './ReviewModal';
import { ActionButton } from './TodayViews';

export default function CoachRenewalReminder({ user, students, onNavigate }) {
    const [reminder, setReminder] = useState(null);
    const controllerRef = useRef(null);
    const coachName = user?.role === 'coach' ? user.username : '';
    // A registration change must invalidate the server's short read cache.
    const registrationVersion = JSON.stringify((students || []).map(student => [
        student['이름'], student['시작날짜'], student['종료날짜'], student['요일 및 시간'], student._nextStartDate,
    ]));
    const previousVersion = useRef(registrationVersion);

    useEffect(() => {
        if (!coachName) return;
        let storage;
        try { storage = window.localStorage; } catch { /* In-memory ledger remains available. */ }
        const loadSnapshot = createCoachReminderLoader({
            functionsUrl: import.meta.env.VITE_FUNCTIONS_URL || (import.meta.env.PROD ? '/.netlify/functions' : 'http://localhost:5001'),
            getToken: async () => {
                const current = auth?.currentUser;
                const identity = await current?.getIdTokenResult();
                if (current !== auth?.currentUser || identity?.claims?.isCoach !== true || identity.claims.name !== coachName) return null;
                return identity.token;
            },
        });
        const controller = createCoachReminderController({ coachName, loadSnapshot, storage, onReminder: setReminder });
        controllerRef.current = controller;
        let alive = true;
        let identityRevision = 0;
        const unsubscribe = auth ? onIdTokenChanged(auth, async current => {
            const revision = ++identityRevision;
            try {
                const identity = await current?.getIdTokenResult();
                if (!alive || revision !== identityRevision || current !== auth.currentUser) return;
                if (identity?.claims?.isCoach === true && identity.claims.name === coachName) controller.start();
                else controller.stop();
            } catch { if (alive && revision === identityRevision) controller.stop(); }
        }) : () => {};
        return () => { alive = false; unsubscribe(); controllerRef.current = null; controller.stop(); };
    }, [coachName]);

    useEffect(() => {
        if (previousVersion.current === registrationVersion) return;
        previousVersion.current = registrationVersion;
        void controllerRef.current?.refresh({ force: true });
    }, [registrationVersion]);

    if (!coachName || !reminder) return null;
    const close = () => controllerRef.current?.dismiss(reminder.key);
    const time = `${String(Math.floor(reminder.startMinute / 60)).padStart(2, '0')}:${String(reminder.startMinute % 60).padStart(2, '0')}`;
    return <ReviewModal title={`${reminder.period}교시 · 재등록 확인`} onClose={close}>
        <p className="today-muted">{time} 수업 전에 안내해주세요.</p>
        {reminder.lastNames.length > 0 && <div className="coach-renewal-group"><h3>오늘 마지막 수업 <span>{reminder.lastNames.length}명</span></h3><p>{reminder.lastNames.join(', ')}</p></div>}
        {reminder.delayedNames.length > 0 && <div className="coach-renewal-group"><h3>수강 종료·미재등록 <span>{reminder.delayedNames.length}명</span></h3><p>{reminder.delayedNames.join(', ')}</p></div>}
        <div className="today-actions"><ActionButton onClick={close}>닫기</ActionButton><ActionButton primary onClick={() => { close(); onNavigate('today'); }}>할 일 보기</ActionButton></div>
    </ReviewModal>;
}
