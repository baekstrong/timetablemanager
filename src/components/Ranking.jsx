import { useState, useEffect, useMemo } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
    getAllPersonalBests,
    getMonthlyPRUpdaters,
    getAttendanceRanking,
    getRecordsByUserSince
} from '../services/firebaseService';
import PRSubmitModal from './PRSubmitModal';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Scatter,
    ComposedChart
} from 'recharts';
import './Ranking.css';

// ============================================
// Helpers
// ============================================

const numVal = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
};

const formatPRValue = (pr) => {
    const i = pr.intensity || {};
    const r = pr.reps || {};
    switch (pr.prType) {
        case 'oneRM':
            return `${i.value}${i.unit || 'kg'}`;
        case 'weightThenReps':
            return `${i.value}${i.unit || 'kg'} × ${r.value}회`;
        case 'timeHold':
            return `${r.value}초`;
        case 'bodyweightReps':
            return `${r.value}회`;
        default:
            return '-';
    }
};

// 정렬용 단일 metric (랭킹 비교)
const prMetric = (pr) => {
    const i = pr.intensity || {};
    const r = pr.reps || {};
    switch (pr.prType) {
        case 'oneRM':
            return numVal(i.value);
        case 'weightThenReps':
            // 중량 우선, 같으면 reps. 1000배 가중으로 단일 숫자 정렬 가능
            return numVal(i.value) * 10000 + numVal(r.value);
        case 'timeHold':
        case 'bodyweightReps':
            return numVal(r.value);
        default:
            return 0;
    }
};

const formatDate = (s) => {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ============================================
// Main Component
// ============================================

const Ranking = ({ user, onBack }) => {
    const { students } = useGoogleSheets();
    const [tab, setTab] = useState('ranking'); // 'ranking' | 'mypr' | 'graph'
    const [allPRs, setAllPRs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showSubmitModal, setShowSubmitModal] = useState(false);

    const isCoach = user?.role === 'coach';

    // 이름 → 성별 맵
    const genderMap = useMemo(() => {
        const m = {};
        for (const s of (students || [])) {
            const name = s['이름'];
            const gender = s['성별'];
            if (name) m[name] = gender || '';
        }
        return m;
    }, [students]);

    const studentNames = useMemo(() => {
        const set = new Set();
        for (const s of (students || [])) {
            if (s['이름']) set.add(s['이름']);
        }
        return Array.from(set).sort();
    }, [students]);

    const loadAll = async () => {
        setLoading(true);
        try {
            const data = await getAllPersonalBests();
            setAllPRs(data);
        } catch (err) {
            console.error('PR 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    // 운동 제안 (PR 등록 폼 autocomplete용)
    const exerciseSuggestions = useMemo(() => {
        const set = new Set(allPRs.map(p => p.exercise).filter(Boolean));
        return Array.from(set).sort();
    }, [allPRs]);

    return (
        <div className="ranking-container">
            <header className="ranking-header">
                <button onClick={onBack} className="ranking-back-btn">← 뒤로</button>
                <h1 className="ranking-title">🏆 랭킹·PR</h1>
            </header>

            <nav className="ranking-tabs">
                <button
                    className={`ranking-tab ${tab === 'ranking' ? 'active' : ''}`}
                    onClick={() => setTab('ranking')}
                >랭킹</button>
                <button
                    className={`ranking-tab ${tab === 'mypr' ? 'active' : ''}`}
                    onClick={() => setTab('mypr')}
                >내 PR</button>
                <button
                    className={`ranking-tab ${tab === 'graph' ? 'active' : ''}`}
                    onClick={() => setTab('graph')}
                >그래프</button>
            </nav>

            {loading ? (
                <div className="ranking-loading">로딩 중...</div>
            ) : (
                <>
                    {tab === 'ranking' && (
                        <RankingTab allPRs={allPRs} genderMap={genderMap} />
                    )}
                    {tab === 'mypr' && (
                        <MyPRTab
                            user={user}
                            allPRs={allPRs}
                            studentNames={studentNames}
                            onAddClick={() => setShowSubmitModal(true)}
                            onRefresh={loadAll}
                        />
                    )}
                    {tab === 'graph' && (
                        <GraphTab user={user} allPRs={allPRs} studentNames={studentNames} />
                    )}
                </>
            )}

            {showSubmitModal && (
                <PRSubmitModal
                    user={user}
                    students={studentNames}
                    defaultStudent={isCoach ? '' : user.username}
                    exerciseSuggestions={exerciseSuggestions}
                    onClose={() => setShowSubmitModal(false)}
                    onSubmitted={() => {
                        setShowSubmitModal(false);
                        loadAll();
                    }}
                />
            )}
        </div>
    );
};

// ============================================
// 랭킹 탭
// ============================================

const RankingTab = ({ allPRs, genderMap }) => {
    const [subTab, setSubTab] = useState('topn'); // 'topn' | 'monthly' | 'attendance'
    const [genderFilter, setGenderFilter] = useState('all'); // 'all' | '남' | '여'
    const [selectedExercise, setSelectedExercise] = useState('');

    const exercises = useMemo(() => {
        const set = new Set(allPRs.map(p => p.exercise).filter(Boolean));
        return Array.from(set).sort();
    }, [allPRs]);

    const effectiveExercise = selectedExercise || exercises[0] || '';

    // 종목별 TOP-N: 같은 운동 내에서 prType 통일 가정. 다양한 중량 PR(weightThenReps)도 모두 정렬에 포함
    const topNData = useMemo(() => {
        const filtered = allPRs.filter(p =>
            p.exercise === effectiveExercise &&
            (genderFilter === 'all' || genderMap[p.userName] === genderFilter)
        );
        return filtered.map(p => ({ ...p, _metric: prMetric(p) }))
            .sort((a, b) => b._metric - a._metric)
            .slice(0, 10);
    }, [allPRs, effectiveExercise, genderFilter, genderMap]);

    return (
        <div className="ranking-content">
            <div className="ranking-subtabs">
                <button className={`ranking-subtab ${subTab === 'topn' ? 'active' : ''}`} onClick={() => setSubTab('topn')}>종목별 TOP-N</button>
                <button className={`ranking-subtab ${subTab === 'monthly' ? 'active' : ''}`} onClick={() => setSubTab('monthly')}>이달의 PR</button>
                <button className={`ranking-subtab ${subTab === 'attendance' ? 'active' : ''}`} onClick={() => setSubTab('attendance')}>출석·볼륨</button>
            </div>

            <div className="ranking-gender-filter">
                <button className={genderFilter === 'all' ? 'active' : ''} onClick={() => setGenderFilter('all')}>전체</button>
                <button className={genderFilter === '남' ? 'active' : ''} onClick={() => setGenderFilter('남')}>남</button>
                <button className={genderFilter === '여' ? 'active' : ''} onClick={() => setGenderFilter('여')}>여</button>
            </div>

            {subTab === 'topn' && (
                <>
                    {exercises.length === 0 ? (
                        <div className="ranking-empty">아직 등록된 PR이 없습니다.</div>
                    ) : (
                        <>
                            <select
                                className="ranking-exercise-select"
                                value={effectiveExercise}
                                onChange={(e) => setSelectedExercise(e.target.value)}
                            >
                                {exercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                            </select>
                            <ol className="ranking-list">
                                {topNData.length === 0 ? (
                                    <li className="ranking-empty-row">해당 조건의 기록이 없습니다.</li>
                                ) : topNData.map((p, i) => (
                                    <li key={p.id} className="ranking-row">
                                        <span className="ranking-rank">{i + 1}</span>
                                        <span className="ranking-name">{p.userName}</span>
                                        <span className="ranking-value">{formatPRValue(p)}</span>
                                        <span className="ranking-date">{formatDate(p.date)}</span>
                                    </li>
                                ))}
                            </ol>
                        </>
                    )}
                </>
            )}

            {subTab === 'monthly' && <MonthlyPRSection genderMap={genderMap} genderFilter={genderFilter} />}
            {subTab === 'attendance' && <AttendanceSection genderMap={genderMap} genderFilter={genderFilter} />}
        </div>
    );
};

const MonthlyPRSection = ({ genderMap, genderFilter }) => {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await getMonthlyPRUpdaters(30);
                setList(data);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const filtered = list.filter(p => genderFilter === 'all' || genderMap[p.userName] === genderFilter);

    if (loading) return <div className="ranking-loading">불러오는 중...</div>;
    if (filtered.length === 0) return <div className="ranking-empty">최근 30일간 갱신된 PR이 없습니다.</div>;

    return (
        <ul className="ranking-list">
            {filtered.map(p => (
                <li key={p.id} className="ranking-row">
                    <span className="ranking-name">{p.userName}</span>
                    <span className="ranking-exercise">{p.exercise}</span>
                    <span className="ranking-value">{formatPRValue(p)}</span>
                    <span className="ranking-date">{formatDate(p.date)}</span>
                </li>
            ))}
        </ul>
    );
};

const AttendanceSection = ({ genderMap, genderFilter }) => {
    const [list, setList] = useState([]);
    const [sortBy, setSortBy] = useState('days'); // 'days' | 'volume'
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await getAttendanceRanking(30);
                setList(data);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const filtered = list
        .filter(e => genderFilter === 'all' || genderMap[e.userName] === genderFilter)
        .sort((a, b) => sortBy === 'days' ? b.trainingDays - a.trainingDays : b.volume - a.volume);

    if (loading) return <div className="ranking-loading">불러오는 중...</div>;

    return (
        <>
            <div className="ranking-gender-filter" style={{ marginBottom: '0.5rem' }}>
                <button className={sortBy === 'days' ? 'active' : ''} onClick={() => setSortBy('days')}>훈련 일수</button>
                <button className={sortBy === 'volume' ? 'active' : ''} onClick={() => setSortBy('volume')}>총 볼륨</button>
            </div>
            {filtered.length === 0 ? (
                <div className="ranking-empty">최근 30일 훈련 기록이 없습니다.</div>
            ) : (
                <ol className="ranking-list">
                    {filtered.map((e, i) => (
                        <li key={e.userName} className="ranking-row">
                            <span className="ranking-rank">{i + 1}</span>
                            <span className="ranking-name">{e.userName}</span>
                            <span className="ranking-value">
                                {sortBy === 'days' ? `${e.trainingDays}일` : `${e.volume.toLocaleString()}kg`}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </>
    );
};

// ============================================
// 내 PR 탭
// ============================================

const MyPRTab = ({ user, allPRs, studentNames, onAddClick }) => {
    const isCoach = user?.role === 'coach';
    const [selectedStudent, setSelectedStudent] = useState(isCoach ? '' : user.username);
    const [historyModal, setHistoryModal] = useState(null);

    const targetName = isCoach ? selectedStudent : user.username;
    const myPRs = useMemo(() =>
        allPRs.filter(p => p.userName === targetName),
        [allPRs, targetName]
    );

    // weightThenReps는 같은 운동 내 여러 중량을 묶음
    const groupedByExercise = useMemo(() => {
        const groups = new Map();
        for (const p of myPRs) {
            const key = p.exercise;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(p);
        }
        // 각 그룹 정렬: weightThenReps는 중량 내림차순, 그 외는 metric 내림차순
        for (const arr of groups.values()) {
            arr.sort((a, b) => prMetric(b) - prMetric(a));
        }
        return Array.from(groups.entries());
    }, [myPRs]);

    return (
        <div className="ranking-content">
            <div className="mypr-header">
                {isCoach && (
                    <select
                        className="ranking-exercise-select"
                        value={selectedStudent}
                        onChange={(e) => setSelectedStudent(e.target.value)}
                    >
                        <option value="">학생을 선택하세요</option>
                        {studentNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                )}
                <button className="mypr-add-btn" onClick={onAddClick}>+ 공식 측정 등록</button>
            </div>

            {!targetName ? (
                <div className="ranking-empty">학생을 선택해주세요.</div>
            ) : groupedByExercise.length === 0 ? (
                <div className="ranking-empty">등록된 PR이 없습니다.</div>
            ) : (
                <div className="mypr-cards">
                    {groupedByExercise.map(([exercise, prs]) => (
                        <div key={exercise} className="mypr-card">
                            <div className="mypr-card-header">
                                <span className="mypr-card-title">{exercise}</span>
                                <span className="mypr-card-type">{prTypeLabel(prs[0].prType)}</span>
                            </div>
                            <ul className="mypr-card-records">
                                {prs.map(p => (
                                    <li key={p.id} className="mypr-card-record">
                                        <span className="mypr-record-value">{formatPRValue(p)}</span>
                                        <span className="mypr-record-date">{p.date}</span>
                                        <button
                                            className="mypr-history-btn"
                                            onClick={() => setHistoryModal(p)}
                                        >이력</button>
                                    </li>
                                ))}
                            </ul>
                            {prs[0].note && (
                                <div className="mypr-card-note">{prs[0].note}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {historyModal && (
                <HistoryModal pr={historyModal} onClose={() => setHistoryModal(null)} />
            )}
        </div>
    );
};

const prTypeLabel = (t) => ({
    oneRM: '최대 중량',
    weightThenReps: '중량×반복',
    timeHold: '시간 보유',
    bodyweightReps: '맨몸 반복'
}[t] || t);

const HistoryModal = ({ pr, onClose }) => {
    const history = (pr.history || []).slice().reverse();
    return (
        <div className="pr-modal-overlay" onClick={onClose}>
            <div className="pr-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="pr-modal-header">
                    <h2 className="pr-modal-title">{pr.exercise} 이력</h2>
                    <button className="pr-modal-close" onClick={onClose}>×</button>
                </div>
                {history.length === 0 ? (
                    <div className="ranking-empty">이력이 없습니다.</div>
                ) : (
                    <ul className="mypr-history-list">
                        {history.map((h, i) => (
                            <li key={i} className="mypr-history-item">
                                <span className="mypr-history-value">{formatPRValue({ ...pr, intensity: h.intensity, reps: h.reps })}</span>
                                <span className="mypr-history-date">{h.date}</span>
                                {h.note && <span className="mypr-history-note">{h.note}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

// ============================================
// 그래프 탭
// ============================================

const GraphTab = ({ user, allPRs, studentNames }) => {
    const isCoach = user?.role === 'coach';
    const [selectedStudent, setSelectedStudent] = useState(isCoach ? '' : user.username);
    const [periodMonths, setPeriodMonths] = useState(3);
    const [selectedExercise, setSelectedExercise] = useState('');
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);

    const targetName = isCoach ? selectedStudent : user.username;

    useEffect(() => {
        if (!targetName) { setRecords([]); return; }
        (async () => {
            setLoading(true);
            try {
                const since = new Date();
                since.setMonth(since.getMonth() - periodMonths);
                const sinceStr = since.toISOString().slice(0, 10);
                const data = await getRecordsByUserSince(targetName, sinceStr);
                setRecords(data);
            } catch (err) {
                console.error('records 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [targetName, periodMonths]);

    const exercises = useMemo(() => {
        const set = new Set(records.map(r => r.exercise).filter(Boolean));
        return Array.from(set).sort();
    }, [records]);

    const effectiveExercise = selectedExercise || exercises[0] || '';

    // 일별 metric 시계열: 해당 운동의 그날 best 세트
    const chartData = useMemo(() => {
        const byDate = new Map();
        for (const r of records) {
            if (r.exercise !== effectiveExercise) continue;
            const date = r.date;
            for (const set of (r.sets || [])) {
                const intUnit = set.intensity?.unit;
                const repUnit = set.reps?.unit;
                let metric;
                let label;
                if (intUnit === 'kg') {
                    metric = numVal(set.intensity?.value);
                    label = `${metric}kg × ${set.reps?.value || 0}회`;
                } else if (repUnit === '초' && !set.reps?.count) {
                    metric = numVal(set.reps?.value);
                    label = `${metric}초`;
                } else if (intUnit === '맨몸' && repUnit === '회') {
                    metric = numVal(set.reps?.value);
                    label = `맨몸 ${metric}회`;
                } else {
                    continue;
                }
                if (!byDate.has(date) || byDate.get(date).metric < metric) {
                    byDate.set(date, { date, metric, label });
                }
            }
        }
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [records, effectiveExercise]);

    // 공식 PR 측정점 (같은 운동, 같은 학생)
    const prMarkers = useMemo(() => {
        const markers = [];
        for (const pr of allPRs) {
            if (pr.userName !== targetName) continue;
            if (pr.exercise !== effectiveExercise) continue;
            for (const h of (pr.history || [])) {
                const intUnit = h.intensity?.unit;
                const repUnit = h.reps?.unit;
                let metric;
                if (intUnit === 'kg') metric = numVal(h.intensity?.value);
                else if (repUnit === '초') metric = numVal(h.reps?.value);
                else if (intUnit === '맨몸' || pr.prType === 'bodyweightReps') metric = numVal(h.reps?.value);
                else metric = numVal(h.intensity?.value) || numVal(h.reps?.value);
                markers.push({ date: h.date, metric, label: '★ 공식 측정' });
            }
        }
        return markers.sort((a, b) => a.date.localeCompare(b.date));
    }, [allPRs, targetName, effectiveExercise]);

    // 두 데이터를 합쳐서 ComposedChart에 사용
    const mergedData = useMemo(() => {
        const map = new Map();
        for (const d of chartData) {
            map.set(d.date, { date: d.date, daily: d.metric });
        }
        for (const m of prMarkers) {
            if (!map.has(m.date)) map.set(m.date, { date: m.date });
            map.get(m.date).pr = m.metric;
        }
        return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [chartData, prMarkers]);

    return (
        <div className="ranking-content">
            <div className="graph-controls">
                {isCoach && (
                    <select
                        className="ranking-exercise-select"
                        value={selectedStudent}
                        onChange={(e) => setSelectedStudent(e.target.value)}
                    >
                        <option value="">학생 선택</option>
                        {studentNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                )}
                <select
                    className="ranking-exercise-select"
                    value={effectiveExercise}
                    onChange={(e) => setSelectedExercise(e.target.value)}
                >
                    <option value="">운동 선택</option>
                    {exercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                </select>
                <div className="ranking-gender-filter">
                    {[3, 6, 12].map(m => (
                        <button
                            key={m}
                            className={periodMonths === m ? 'active' : ''}
                            onClick={() => setPeriodMonths(m)}
                        >{m}개월</button>
                    ))}
                </div>
            </div>

            {!targetName ? (
                <div className="ranking-empty">학생을 선택해주세요.</div>
            ) : loading ? (
                <div className="ranking-loading">불러오는 중...</div>
            ) : mergedData.length === 0 ? (
                <div className="ranking-empty">선택한 기간·운동의 기록이 없습니다.</div>
            ) : (
                <div className="graph-wrapper">
                    <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={mergedData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="daily" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="일상 훈련" connectNulls />
                            <Scatter dataKey="pr" fill="#f59e0b" shape="star" name="공식 PR" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};

export default Ranking;
