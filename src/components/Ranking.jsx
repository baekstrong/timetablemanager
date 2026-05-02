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
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
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
                <button className={`ranking-subtab ${subTab === 'attendance' ? 'active' : ''}`} onClick={() => setSubTab('attendance')}>한달 출석일 수·총 운동량</button>
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
                <button className={sortBy === 'days' ? 'active' : ''} onClick={() => setSortBy('days')}>한달 출석일 수</button>
                <button className={sortBy === 'volume' ? 'active' : ''} onClick={() => setSortBy('volume')}>한달 총 운동량</button>
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
                    <>
                        <input
                            className="ranking-exercise-select"
                            type="text"
                            list="mypr-student-list"
                            value={selectedStudent}
                            onChange={(e) => setSelectedStudent(e.target.value)}
                            placeholder="학생 이름 검색"
                        />
                        <datalist id="mypr-student-list">
                            {studentNames.map(n => <option key={n} value={n} />)}
                        </datalist>
                    </>
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

const GRAPH_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const computeSetMetric = (set) => {
    const intUnit = set.intensity?.unit;
    const repUnit = set.reps?.unit;
    if (intUnit === 'kg') return numVal(set.intensity?.value);
    if (repUnit === '초' && !set.reps?.count) return numVal(set.reps?.value);
    if (intUnit === '맨몸' && repUnit === '회') return numVal(set.reps?.value);
    return null;
};

const computePRMetric = (pr, h) => {
    const intUnit = h.intensity?.unit;
    const repUnit = h.reps?.unit;
    if (intUnit === 'kg') return numVal(h.intensity?.value);
    if (repUnit === '초') return numVal(h.reps?.value);
    if (intUnit === '맨몸' || pr.prType === 'bodyweightReps') return numVal(h.reps?.value);
    return numVal(h.intensity?.value) || numVal(h.reps?.value);
};

const GraphTab = ({ user, allPRs, studentNames }) => {
    const isCoach = user?.role === 'coach';
    const [selectedStudent, setSelectedStudent] = useState(isCoach ? '' : user.username);
    const [periodMonths, setPeriodMonths] = useState(3);
    const [selectedExercises, setSelectedExercises] = useState([]); // string[]
    const [exerciseSearch, setExerciseSearch] = useState('');
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);

    const targetName = isCoach ? selectedStudent : user.username;
    const isValidStudent = !isCoach || studentNames.includes(targetName);
    const effectiveTarget = isValidStudent ? targetName : '';

    useEffect(() => {
        if (!effectiveTarget) { setRecords([]); return; }
        (async () => {
            setLoading(true);
            try {
                const since = new Date();
                since.setMonth(since.getMonth() - periodMonths);
                const sinceStr = since.toISOString().slice(0, 10);
                const data = await getRecordsByUserSince(effectiveTarget, sinceStr);
                setRecords(data);
            } catch (err) {
                console.error('records 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [effectiveTarget, periodMonths]);

    // 학생의 모든 운동 목록 = records에서 + 해당 학생 PR에서 (PR만 있는 경우도 표시)
    const allExercises = useMemo(() => {
        const set = new Set();
        for (const r of records) if (r.exercise) set.add(r.exercise);
        for (const pr of allPRs) {
            if (pr.userName === effectiveTarget && pr.exercise) set.add(pr.exercise);
        }
        return Array.from(set).sort();
    }, [records, allPRs, effectiveTarget]);

    // 검색 필터 적용된 표시 목록
    const filteredExercises = useMemo(() => {
        const q = exerciseSearch.trim().toLowerCase();
        if (!q) return allExercises;
        return allExercises.filter(ex => ex.toLowerCase().includes(q));
    }, [allExercises, exerciseSearch]);

    const toggleExercise = (ex) => {
        setSelectedExercises(prev =>
            prev.includes(ex) ? prev.filter(e => e !== ex) : [...prev, ex]
        );
    };

    const clearExercises = () => setSelectedExercises([]);
    const selectAllVisible = () => {
        setSelectedExercises(prev => Array.from(new Set([...prev, ...filteredExercises])));
    };

    // 운동별 색상 매핑 (선택 순서 기반)
    const colorMap = useMemo(() => {
        const m = {};
        selectedExercises.forEach((ex, i) => { m[ex] = GRAPH_COLORS[i % GRAPH_COLORS.length]; });
        return m;
    }, [selectedExercises]);

    // 차트 데이터: 운동별 daily/pr 컬럼 별도 생성
    const mergedData = useMemo(() => {
        if (selectedExercises.length === 0) return [];
        const byDate = new Map();
        const ensure = (date) => {
            if (!byDate.has(date)) byDate.set(date, { date });
            return byDate.get(date);
        };
        // 일상 훈련
        for (const r of records) {
            if (!selectedExercises.includes(r.exercise)) continue;
            const dailyKey = `${r.exercise}_daily`;
            for (const set of (r.sets || [])) {
                const metric = computeSetMetric(set);
                if (metric === null) continue;
                const row = ensure(r.date);
                if (row[dailyKey] === undefined || row[dailyKey] < metric) {
                    row[dailyKey] = metric;
                }
            }
        }
        // 공식 PR
        for (const pr of allPRs) {
            if (pr.userName !== effectiveTarget) continue;
            if (!selectedExercises.includes(pr.exercise)) continue;
            const prKey = `${pr.exercise}_pr`;
            for (const h of (pr.history || [])) {
                const metric = computePRMetric(pr, h);
                const row = ensure(h.date);
                if (row[prKey] === undefined || row[prKey] < metric) {
                    row[prKey] = metric;
                }
            }
        }
        return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [records, allPRs, effectiveTarget, selectedExercises]);

    return (
        <div className="ranking-content">
            <div className="graph-controls">
                {isCoach && (
                    <>
                        <input
                            className="ranking-exercise-select"
                            type="text"
                            list="graph-student-list"
                            value={selectedStudent}
                            onChange={(e) => setSelectedStudent(e.target.value)}
                            placeholder="학생 이름 검색"
                        />
                        <datalist id="graph-student-list">
                            {studentNames.map(n => <option key={n} value={n} />)}
                        </datalist>
                    </>
                )}
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

            {!effectiveTarget ? (
                <div className="ranking-empty">학생을 선택해주세요.</div>
            ) : loading ? (
                <div className="ranking-loading">불러오는 중...</div>
            ) : (
                <>
                    <div className="graph-exercise-picker">
                        <div className="graph-exercise-search-row">
                            <input
                                type="text"
                                className="ranking-exercise-select"
                                value={exerciseSearch}
                                onChange={(e) => setExerciseSearch(e.target.value)}
                                placeholder="운동 검색"
                            />
                            <button className="graph-picker-btn" onClick={selectAllVisible} disabled={filteredExercises.length === 0}>전체선택</button>
                            <button className="graph-picker-btn" onClick={clearExercises} disabled={selectedExercises.length === 0}>해제</button>
                        </div>
                        {allExercises.length === 0 ? (
                            <div className="ranking-empty">표시할 운동이 없습니다.</div>
                        ) : (
                            <div className="graph-exercise-list">
                                {filteredExercises.length === 0 ? (
                                    <span className="ranking-empty-row">검색 결과가 없습니다.</span>
                                ) : filteredExercises.map(ex => {
                                    const checked = selectedExercises.includes(ex);
                                    return (
                                        <label
                                            key={ex}
                                            className={`graph-exercise-chip ${checked ? 'active' : ''}`}
                                            style={checked ? { borderColor: colorMap[ex], color: colorMap[ex] } : undefined}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleExercise(ex)}
                                            />
                                            <span>{ex}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {selectedExercises.length === 0 ? (
                        <div className="ranking-empty">운동을 1개 이상 선택해주세요.</div>
                    ) : mergedData.length === 0 ? (
                        <div className="ranking-empty">선택한 기간·운동의 기록이 없습니다.</div>
                    ) : (
                        <div className="graph-wrapper">
                            <ResponsiveContainer width="100%" height={340}>
                                <ComposedChart data={mergedData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    {selectedExercises.map(ex => (
                                        <Line
                                            key={`${ex}_daily`}
                                            type="monotone"
                                            dataKey={`${ex}_daily`}
                                            stroke={colorMap[ex]}
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                            name={ex}
                                            connectNulls
                                        />
                                    ))}
                                    {selectedExercises.map(ex => (
                                        <Scatter
                                            key={`${ex}_pr`}
                                            dataKey={`${ex}_pr`}
                                            fill={colorMap[ex]}
                                            shape="star"
                                            name={`${ex} ★PR`}
                                        />
                                    ))}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default Ranking;
