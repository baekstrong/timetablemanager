import { useState, useEffect, useMemo } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
    getPersonalBests,
    getPersonalBestsByExercise,
    getMonthlyPRUpdaters,
    getAttendanceRanking,
    getRecordsByUserSince,
    getMonthlyAttendanceHistory,
    getAllExerciseNames,
    deletePersonalBest,
    updatePersonalBest
} from '../services/firebaseService';
import PRSubmitModal from './PRSubmitModal';
import {
    Bar,
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
    const [trainingLogExercises, setTrainingLogExercises] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [showSubmitModal, setShowSubmitModal] = useState(false);

    const isCoach = user?.role === 'coach';

    // 이름 → 성별 맵 (Q열). 같은 학생이 여러 시트에 있을 수 있으므로 비어있지 않은 값을 우선
    const genderMap = useMemo(() => {
        const m = {};
        const normalize = (g) => {
            const t = (g || '').trim();
            if (!t) return '';
            if (t.startsWith('남')) return '남';
            if (t.startsWith('여')) return '여';
            return '';
        };
        for (const s of (students || [])) {
            const name = (s['이름'] || '').trim();
            if (!name) continue;
            const gender = normalize(s['성별']);
            if (gender && !m[name]) m[name] = gender;
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

    const loadExerciseNames = async () => {
        setLoading(true);
        try {
            const exercises = await getAllExerciseNames();
            setTrainingLogExercises(exercises);
        } catch (err) {
            console.error('운동 종목 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    const refreshCurrentPRData = () => setRefreshNonce(n => n + 1);

    useEffect(() => { loadExerciseNames(); }, []);

    // 운동명 드롭다운 옵션: 코치가 관리하는 공식 운동 종목 목록 (이미 가나다 정렬)
    const exerciseSuggestions = trainingLogExercises;

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
                        <RankingTab
                            exerciseSuggestions={exerciseSuggestions}
                            genderMap={genderMap}
                            refreshNonce={refreshNonce}
                        />
                    )}
                    {tab === 'mypr' && (
                        <MyPRTab
                            user={user}
                            studentNames={studentNames}
                            onAddClick={() => setShowSubmitModal(true)}
                            onRefresh={refreshCurrentPRData}
                            refreshNonce={refreshNonce}
                        />
                    )}
                    {tab === 'graph' && (
                        <GraphTab
                            user={user}
                            studentNames={studentNames}
                            refreshNonce={refreshNonce}
                        />
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
                        refreshCurrentPRData();
                    }}
                />
            )}
        </div>
    );
};

// ============================================
// 랭킹 탭
// ============================================

const RankingTab = ({ exerciseSuggestions, genderMap, refreshNonce }) => {
    const [subTab, setSubTab] = useState('topn'); // 'topn' | 'monthly' | 'attendance'
    const [genderFilter, setGenderFilter] = useState('all'); // 'all' | '남' | '여'
    const [selectedExercise, setSelectedExercise] = useState('');
    const [exercisePRs, setExercisePRs] = useState([]);
    const [loadingExercisePRs, setLoadingExercisePRs] = useState(false);

    const exercises = exerciseSuggestions;
    const effectiveExercise = selectedExercise || exercises[0] || '';

    useEffect(() => {
        if (subTab !== 'topn' || !effectiveExercise) {
            setExercisePRs([]);
            return;
        }
        (async () => {
            setLoadingExercisePRs(true);
            try {
                const data = await getPersonalBestsByExercise(effectiveExercise);
                setExercisePRs(data);
            } catch (err) {
                console.error('운동별 PR 로드 실패:', err);
                setExercisePRs([]);
            } finally {
                setLoadingExercisePRs(false);
            }
        })();
    }, [subTab, effectiveExercise, refreshNonce]);

    // 종목별 TOP-N: 선택 운동만 Firestore에서 읽고, 성별 필터/metric 정렬은 클라이언트에서 처리
    const topNData = useMemo(() => {
        return exercisePRs.filter(p => genderFilter === 'all' || genderMap[p.userName] === genderFilter)
            .map(p => ({ ...p, _metric: prMetric(p) }))
            .sort((a, b) => b._metric - a._metric)
            .slice(0, 10);
    }, [exercisePRs, genderFilter, genderMap]);

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
                            {loadingExercisePRs ? (
                                <div className="ranking-loading">불러오는 중...</div>
                            ) : (
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
                            )}
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
    const monthOptions = useMemo(() => {
        const list = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
            list.push({ ym, label });
        }
        return list;
    }, []);

    const [selectedYM, setSelectedYM] = useState(monthOptions[0].ym);
    const [list, setList] = useState([]);
    const [sortBy, setSortBy] = useState('days'); // 'days' | 'volume'
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const data = await getAttendanceRanking(selectedYM);
                setList(data);
            } finally {
                setLoading(false);
            }
        })();
    }, [selectedYM]);

    const filtered = list
        .filter(e => genderFilter === 'all' || genderMap[e.userName] === genderFilter)
        .sort((a, b) => sortBy === 'days' ? b.trainingDays - a.trainingDays : b.volume - a.volume);

    const currentLabel = monthOptions.find(o => o.ym === selectedYM)?.label || selectedYM;
    const isCurrentMonth = selectedYM === monthOptions[0].ym;

    return (
        <>
            <div className="ranking-period-row">
                <select
                    className="ranking-month-select"
                    value={selectedYM}
                    onChange={(e) => setSelectedYM(e.target.value)}
                >
                    {monthOptions.map(o => (
                        <option key={o.ym} value={o.ym}>{o.label}</option>
                    ))}
                </select>
                <span className="ranking-period-hint">
                    {currentLabel} {isCurrentMonth ? '기준 (매달 1일 초기화)' : '기록'}
                </span>
            </div>
            <div className="ranking-gender-filter" style={{ marginBottom: '0.5rem' }}>
                <button className={sortBy === 'days' ? 'active' : ''} onClick={() => setSortBy('days')}>한달 출석일 수</button>
                <button className={sortBy === 'volume' ? 'active' : ''} onClick={() => setSortBy('volume')}>한달 총 운동량</button>
            </div>
            {loading ? (
                <div className="ranking-loading">불러오는 중...</div>
            ) : filtered.length === 0 ? (
                <div className="ranking-empty">{currentLabel} 훈련 기록이 없습니다.</div>
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

const MyPRTab = ({ user, studentNames, onAddClick, onRefresh, refreshNonce }) => {
    const isCoach = user?.role === 'coach';
    const [selectedStudent, setSelectedStudent] = useState(isCoach ? '' : user.username);
    const [myPRs, setMyPRs] = useState([]);
    const [loadingPRs, setLoadingPRs] = useState(false);
    const [historyModal, setHistoryModal] = useState(null);
    const [editModal, setEditModal] = useState(null);

    const handleDelete = async (pr) => {
        if (!confirm(`'${pr.exercise}' (${formatPRValue(pr)}) 기록을 삭제하시겠습니까?\n이력도 모두 함께 사라집니다.`)) return;
        try {
            await deletePersonalBest(pr.id);
            onRefresh?.();
        } catch (err) {
            alert(`삭제 실패: ${err.message}`);
        }
    };

    const targetName = isCoach ? selectedStudent : user.username;

    useEffect(() => {
        if (!targetName) {
            setMyPRs([]);
            return;
        }
        (async () => {
            setLoadingPRs(true);
            try {
                const data = await getPersonalBests(targetName);
                setMyPRs(data);
            } catch (err) {
                console.error('개인 PR 로드 실패:', err);
                setMyPRs([]);
            } finally {
                setLoadingPRs(false);
            }
        })();
    }, [targetName, refreshNonce]);

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
            ) : loadingPRs ? (
                <div className="ranking-loading">불러오는 중...</div>
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
                                        <button
                                            className="mypr-history-btn"
                                            onClick={() => setEditModal(p)}
                                        >수정</button>
                                        <button
                                            className="mypr-history-btn mypr-delete-btn"
                                            onClick={() => handleDelete(p)}
                                        >삭제</button>
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

            {editModal && (
                <PREditModal
                    pr={editModal}
                    onClose={() => setEditModal(null)}
                    onSaved={() => {
                        setEditModal(null);
                        onRefresh?.();
                    }}
                />
            )}
        </div>
    );
};

const PREditModal = ({ pr, onClose, onSaved }) => {
    const [intensityValue, setIntensityValue] = useState(pr.intensity?.value ?? '');
    const [intensityUnit] = useState(pr.intensity?.unit ?? 'kg');
    const [repsValue, setRepsValue] = useState(pr.reps?.value ?? '');
    const [date, setDate] = useState(pr.date || '');
    const [note, setNote] = useState(pr.note || '');
    const [saving, setSaving] = useState(false);

    const showIntensity = pr.prType === 'oneRM' || pr.prType === 'weightThenReps';
    const showReps = pr.prType !== 'oneRM';

    const handleSave = async () => {
        try {
            setSaving(true);
            const updates = {
                intensity: showIntensity
                    ? { value: intensityValue, unit: intensityUnit }
                    : pr.intensity,
                reps: showReps
                    ? { value: repsValue, unit: pr.reps?.unit || (pr.prType === 'timeHold' ? '초' : '회') }
                    : pr.reps,
                date,
                note: note.trim()
            };
            await updatePersonalBest(pr.id, updates);
            onSaved?.();
        } catch (err) {
            alert(`수정 실패: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="pr-modal-overlay" onClick={onClose}>
            <div className="pr-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="pr-modal-header">
                    <h2 className="pr-modal-title">{pr.exercise} 수정</h2>
                    <button className="pr-modal-close" onClick={onClose}>×</button>
                </div>

                {showIntensity && (
                    <div className="pr-form-row">
                        <label>중량 ({intensityUnit})</label>
                        <input
                            type="number"
                            value={intensityValue}
                            onChange={(e) => setIntensityValue(e.target.value)}
                        />
                    </div>
                )}

                {showReps && (
                    <div className="pr-form-row">
                        <label>{pr.prType === 'timeHold' ? '시간 (초)' : '반복 횟수 (회)'}</label>
                        <input
                            type="number"
                            value={repsValue}
                            onChange={(e) => setRepsValue(e.target.value)}
                        />
                    </div>
                )}

                <div className="pr-form-row">
                    <label>측정일</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>

                <div className="pr-form-row">
                    <label>메모</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                    />
                </div>

                <div className="pr-modal-actions">
                    <button className="pr-btn-cancel" onClick={onClose} disabled={saving}>취소</button>
                    <button className="pr-btn-submit" onClick={handleSave} disabled={saving}>
                        {saving ? '저장 중…' : '저장'}
                    </button>
                </div>
            </div>
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

const GRAPH_COLORS = ['#329BE7', '#47C8FF', '#31A552', '#EDBC40', '#E94E58', '#327AB8', '#06b6d4', '#84cc16'];

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

const GraphTab = ({ user, studentNames, refreshNonce }) => {
    const isCoach = user?.role === 'coach';
    const [selectedStudent, setSelectedStudent] = useState(isCoach ? '' : user.username);
    const [graphMode, setGraphMode] = useState('exercise'); // 'exercise' | 'monthly'

    const targetName = isCoach ? selectedStudent : user.username;
    const isValidStudent = !isCoach || studentNames.includes(targetName);
    const effectiveTarget = isValidStudent ? targetName : '';

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
            </div>

            <div className="ranking-subtabs">
                <button
                    className={`ranking-subtab ${graphMode === 'exercise' ? 'active' : ''}`}
                    onClick={() => setGraphMode('exercise')}
                >운동별 추세</button>
                <button
                    className={`ranking-subtab ${graphMode === 'monthly' ? 'active' : ''}`}
                    onClick={() => setGraphMode('monthly')}
                >월별 출석·운동량</button>
            </div>

            {!effectiveTarget ? (
                <div className="ranking-empty">학생을 선택해주세요.</div>
            ) : graphMode === 'exercise' ? (
                <ExerciseTrendBlock effectiveTarget={effectiveTarget} refreshNonce={refreshNonce} />
            ) : (
                <MonthlyStatsGraph effectiveTarget={effectiveTarget} />
            )}
        </div>
    );
};

const ExerciseTrendBlock = ({ effectiveTarget, refreshNonce }) => {
    const [periodMonths, setPeriodMonths] = useState(3);
    const [selectedExercises, setSelectedExercises] = useState([]);
    const [exerciseSearch, setExerciseSearch] = useState('');
    const [records, setRecords] = useState([]);
    const [personalPRs, setPersonalPRs] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!effectiveTarget) {
            setRecords([]);
            setPersonalPRs([]);
            return;
        }
        (async () => {
            setLoading(true);
            try {
                const since = new Date();
                since.setMonth(since.getMonth() - periodMonths);
                const sinceStr = since.toISOString().slice(0, 10);
                const [recordData, prData] = await Promise.all([
                    getRecordsByUserSince(effectiveTarget, sinceStr),
                    getPersonalBests(effectiveTarget)
                ]);
                setRecords(recordData);
                setPersonalPRs(prData);
            } catch (err) {
                console.error('records 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [effectiveTarget, periodMonths, refreshNonce]);

    // 학생의 모든 운동 목록 = records에서 + 해당 학생 PR에서 (PR만 있는 경우도 표시)
    const allExercises = useMemo(() => {
        const set = new Set();
        for (const r of records) if (r.exercise) set.add(r.exercise);
        for (const pr of personalPRs) {
            if (pr.exercise) set.add(pr.exercise);
        }
        return Array.from(set).sort();
    }, [records, personalPRs]);

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
        for (const pr of personalPRs) {
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
    }, [records, personalPRs, selectedExercises]);

    return (
        <>
            <div className="graph-controls" style={{ marginBottom: '0.75rem' }}>
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

            {loading ? (
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
        </>
    );
};

const MonthlyStatsGraph = ({ effectiveTarget }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!effectiveTarget) { setData([]); return; }
        (async () => {
            setLoading(true);
            try {
                const d = await getMonthlyAttendanceHistory(effectiveTarget, 12);
                setData(d);
            } catch (err) {
                console.error('월별 출석/운동량 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, [effectiveTarget]);

    if (loading) return <div className="ranking-loading">불러오는 중...</div>;
    if (!data.length || data.every(d => d.trainingDays === 0 && d.volume === 0)) {
        return <div className="ranking-empty">최근 12개월 훈련 기록이 없습니다.</div>;
    }

    return (
        <div className="graph-wrapper">
            <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip
                        formatter={(value, name) => {
                            if (name === '출석일 수') return [`${value}일`, name];
                            if (name === '총 운동량') return [`${Number(value).toLocaleString()}kg`, name];
                            return [value, name];
                        }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="left" dataKey="trainingDays" fill="#329BE7" name="출석일 수" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="volume" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="총 운동량" />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default Ranking;
