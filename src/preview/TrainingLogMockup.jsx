import { useRef, useState } from 'react';
import ReviewModal from '../features/today/ReviewModal';
import ExerciseSearchMockup from './ExerciseSearchMockup';
import TrainingCalendarMockup from './TrainingCalendarMockup';
import { exercises, historicalDays, historyText } from './trainingLogMockupData';
import { TODAY, dateLabel } from './studentClassMockupModel';
import './training-log-mockup.css';

const blankDraft = () => ({ sets: Array.from({ length: 3 }, () => ({ weight: '', reps: '' })), memo: '', pain: false });

export default function TrainingLogMockup() {
    const exerciseInput = useRef(null);
    const root = useRef(null);
    const [view, setView] = useState('calendar');
    const [calendarRevision, setCalendarRevision] = useState(0);
    const [exercise, setExercise] = useState('스쿼트');
    const [recentExercises, setRecentExercises] = useState(['스쿼트', '데드리프트', '푸시업']);
    const [drafts, setDrafts] = useState({});
    const [references, setReferences] = useState({});
    const [showHistory, setShowHistory] = useState(false);
    const [showMemo, setShowMemo] = useState(false);
    const [confirmCopy, setConfirmCopy] = useState(false);
    const [records, setRecords] = useState({});
    const [feedback, setFeedback] = useState('');
    const pendingExercises = Object.keys(drafts).filter(name => {
        const item = drafts[name];
        const touched = item.sets.some(set => set.weight !== '' || set.reps !== '') || item.memo || item.pain;
        return (touched || Boolean(records[name])) && JSON.stringify(records[name]?.draft) !== JSON.stringify(item);
    });
    const todayRecords = Object.entries(records).map(([name, record]) => ({
        exercise: name,
        summary: historyText(record, exercises[name]),
        memo: [record.draft.memo, record.draft.pain ? '운동 중 통증 표시 있음' : ''].filter(Boolean).join(' · '),
    }));
    const calendarDays = [...historicalDays, ...(todayRecords.length ? [{ date: TODAY, records: todayRecords }] : [])];
    const switchView = next => { setConfirmCopy(false); setView(next); root.current?.closest('.scm-phone')?.scrollIntoView({ block: 'start' }); };
    const startWriting = () => {
        if (pendingExercises.length && !pendingExercises.includes(exercise)) changeExercise(pendingExercises[0]);
        switchView('write');
    };
    const config = exercises[exercise];
    const history = config.history.filter(item => item.date < TODAY).toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    const reference = history.find(item => item.date === references[exercise]) || history[0];
    const draft = drafts[exercise] || blankDraft();
    const hasInput = draft.sets.some(set => set.weight !== '' || set.reps !== '');
    const completed = records[exercise];
    const isSaved = completed && JSON.stringify(completed.draft) === JSON.stringify(draft);
    const activeSets = draft.sets.filter(set => set.weight !== '' || set.reps !== '');
    const valid = activeSets.length > 0 && activeSets.every(set =>
        (config.unit === '맨몸' || (set.weight !== '' && Number.isFinite(Number(set.weight)) && Number(set.weight) >= 0)) &&
        set.reps !== '' && Number.isFinite(Number(set.reps)) && Number(set.reps) > 0 && (config.repeat === '초' || Number.isInteger(Number(set.reps))),
    );
    const updateDraft = update => {
        setDrafts(current => ({ ...current, [exercise]: update(current[exercise] || blankDraft()) }));
        setFeedback('');
    };
    const changeExercise = name => {
        setExercise(name); setFeedback(''); setShowHistory(false); setConfirmCopy(false);
        setRecentExercises(current => [name, ...current.filter(item => item !== name)].slice(0, 5));
    };
    const copyReference = () => {
        if (!reference) return;
        updateDraft(current => ({ ...current, sets: reference.sets.map(([weight, reps]) => ({ weight: String(weight), reps: String(reps) })) }));
        setConfirmCopy(false);
        setFeedback(`${dateLabel(reference.date)} 값을 채웠어요. 오늘 한 만큼 수정해주세요.`);
    };
    const save = () => {
        if (!valid) return;
        setRecords(current => ({ ...current, [exercise]: { date: TODAY, sets: activeSets.map(set => [config.unit === '맨몸' ? '' : Number(set.weight), Number(set.reps)]), draft: structuredClone(draft) } }));
        setFeedback(`${exercise} ${activeSets.length}세트를 오늘 기록에 저장했어요.`);
    };
    return <div className="tlm" ref={root}>
        <div hidden={view !== 'calendar'}>
            <TrainingCalendarMockup key={calendarRevision} today={TODAY} days={calendarDays} onStart={startWriting} hasDraft={pendingExercises.length > 0} hasTodayRecords={todayRecords.length > 0} />
        </div>
        <div hidden={view !== 'write'}>
        <button type="button" className="tlm-calendar-back" onClick={() => switchView('calendar')}><span aria-hidden="true">‹</span> 달력으로 돌아가기</button>
        <div className="tlm-date-line"><span>오늘 기록 <strong>{dateLabel(TODAY)}</strong></span><span className={`tlm-save-state ${isSaved ? 'is-saved' : ''}`}>{isSaved ? '저장됨' : hasInput || pendingExercises.includes(exercise) ? '작성 중' : '새 기록'}</span></div>
        <div className="tlm-form-card">
        <ExerciseSearchMockup value={exercise} names={Object.keys(exercises)} recentNames={recentExercises} onChange={changeExercise} inputRef={exerciseInput} />
        <div className="tlm-reference-header"><div><span className="tlm-reference-label">{exercise} · {reference ? '지난 기록' : '첫 기록이에요'}</span>{reference && <strong>{dateLabel(reference.date)}</strong>}</div>{history.length > 1 && <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>최근 3회 <span aria-hidden="true">{showHistory ? '−' : '+'}</span></button>}</div>
        {showHistory && <div className="tlm-history-choices" aria-label="참고할 기록 선택">{history.map(item => <button type="button" key={item.date} aria-pressed={reference.date === item.date} onClick={() => setReferences(current => ({ ...current, [exercise]: item.date }))}><span><strong>{dateLabel(item.date)}</strong><small>{historyText(item, config)}</small></span><span aria-hidden="true">{reference.date === item.date ? '✓' : '○'}</span></button>)}</div>}
        {!reference && <p className="tlm-hint">오늘 한 운동부터 남겨보세요. 다음에는 이 기록을 보며 쓸 수 있어요.</p>}
        <div className="tlm-set-labels" aria-hidden="true"><span>세트</span><span>지난번</span><span>오늘 입력</span><span /></div>
        <div className="tlm-sets" aria-label="오늘 세트 입력">{draft.sets.map((set, index) => <div className="tlm-set" key={index}>
            <span className="tlm-set-number">{index + 1}</span>
            <div className="tlm-previous" aria-label={`${index + 1}세트 지난 기록`}>{reference?.sets[index] ? <><strong>{config.unit === '맨몸' ? '맨몸' : `${reference.sets[index][0]}${config.unit}`}</strong><span>× {reference.sets[index][1]}{config.repeat}</span></> : <span>—</span>}</div>
            <div className="tlm-inputs">{config.unit === '맨몸' ? <span className="tlm-bodyweight">맨몸</span> : <label><span className="tlm-sr-only">{index + 1}세트 중량</span><input type="number" min="0" step="0.5" inputMode="decimal" value={set.weight} placeholder="—" onChange={event => updateDraft(current => ({ ...current, sets: current.sets.map((item, i) => i === index ? { ...item, weight: event.target.value } : item) }))} /><span className="tlm-unit">kg</span></label>}<label><span className="tlm-sr-only">{index + 1}세트 {config.repeat === '초' ? '시간' : '횟수'}</span><input type="number" min="1" step={config.repeat === '초' ? 'any' : '1'} inputMode="numeric" value={set.reps} placeholder="—" onChange={event => updateDraft(current => ({ ...current, sets: current.sets.map((item, i) => i === index ? { ...item, reps: event.target.value } : item) }))} /><span className="tlm-unit">{config.repeat}</span></label></div>
            <button type="button" className="tlm-remove" aria-label={`${index + 1}세트 삭제`} disabled={draft.sets.length === 1} onClick={() => updateDraft(current => ({ ...current, sets: current.sets.filter((_, i) => i !== index) }))}>×</button>
        </div>)}</div>
        <div className="tlm-tools"><button type="button" disabled={!reference} onClick={() => hasInput ? setConfirmCopy(true) : copyReference()}>지난 값으로 채우기</button><button type="button" disabled={draft.sets.length >= 20} onClick={() => updateDraft(current => ({ ...current, sets: [...current.sets, { weight: '', reps: '' }] }))}>+ 세트 추가</button></div>
        <p className="tlm-hint">지난 기록은 참고용이에요. 오늘 한 중량·횟수를 입력해주세요.</p>
        <button type="button" className="tlm-memo-toggle" aria-expanded={showMemo} onClick={() => setShowMemo(value => !value)}>운동 메모·통증 {draft.memo || draft.pain ? '· 작성됨' : ''}<span aria-hidden="true">{showMemo ? '−' : '+'}</span></button>
        {showMemo && <div className="tlm-memo"><label>운동 메모<textarea rows="2" placeholder="오늘 운동하며 기억할 점" value={draft.memo} onChange={event => updateDraft(current => ({ ...current, memo: event.target.value }))} /></label><label className="tlm-pain"><input type="checkbox" checked={draft.pain} onChange={event => updateDraft(current => ({ ...current, pain: event.target.checked }))} /> 운동 중 통증이 있었어요</label></div>}
        {feedback && <p className="tlm-feedback" role="status">{feedback}</p>}
        <button type="button" className="tlm-submit" disabled={!valid || isSaved} onClick={save}>{isSaved ? '기록 완료' : completed ? '변경사항 저장' : '운동 완료 · 기록 저장'}</button>
        {isSaved && <div className="tlm-after-save"><button type="button" onClick={() => { exerciseInput.current?.scrollIntoView({ block: 'center' }); exerciseInput.current?.focus({ preventScroll: true }); }}>다른 운동 검색</button><button type="button" onClick={() => { setCalendarRevision(value => value + 1); switchView('calendar'); }}>달력에서 확인</button></div>}
        </div>
        {Object.keys(records).length > 0 && <section className="tlm-today-records"><h2>오늘 남긴 기록 <span>{Object.keys(records).length}</span></h2>{Object.entries(records).map(([name, record]) => <div key={name}><div><strong>{name}</strong><p>{historyText(record, exercises[name])}</p>{record.draft.memo && <p>{record.draft.memo}</p>}{record.draft.pain && <small>통증 표시 있음</small>}</div><button type="button" onClick={() => { changeExercise(name); setFeedback('입력칸에서 수정한 뒤 변경사항을 저장해주세요.'); exerciseInput.current?.scrollIntoView({ block: 'center' }); exerciseInput.current?.focus({ preventScroll: true }); }}>확인·수정</button></div>)}</section>}
        </div>
        {confirmCopy && <ReviewModal title="오늘 입력값을 바꿀까요?" onClose={() => setConfirmCopy(false)}><div className="tlm-copy-dialog"><p>{exercise}의 {dateLabel(reference.date)} 기록 <strong>{reference.sets.length}세트</strong>로 오늘 입력값을 바꿉니다.</p><p className="tlm-hint">작성 날짜와 운동 메모·통증 표시는 유지돼요.</p><div><button type="button" onClick={() => setConfirmCopy(false)}>입력 유지</button><button type="button" onClick={copyReference}>지난 값으로 바꾸기</button></div></div></ReviewModal>}
    </div>;
}
