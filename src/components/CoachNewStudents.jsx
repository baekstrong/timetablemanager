import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
    getNewStudentRegistrations,
    updateNewStudentRegistration,
    createEntranceClass,
    getEntranceClasses,
    updateEntranceClass,
    deleteEntranceClass,
    createFAQ,
    getFAQs,
    updateFAQ,
    deleteFAQ
} from '../services/firebaseService';
import {
    getCurrentSheetName,
    readSheetData,
    writeSheetData,
    highlightCells
} from '../services/googleSheetsService';
import { PRICING } from '../data/mockData';
import './CoachNewStudents.css';

// YYYY-MM-DD → "2026년 2월 21일(토)"
const formatEntranceDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return dateStr;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = dayNames[date.getDay()];
    return `${year}년 ${month}월 ${day}일(${dayOfWeek})`;
};

// YYYY-MM-DD → YYMMDD
const convertToYYMMDD = (dateStr) => {
    if (!dateStr) return '';
    return dateStr.slice(2).replace(/-/g, '');
};

// 요일 이름 → JS getDay() 값 매핑 (월=1, 화=2, ..., 금=5)
const dayNameToIndex = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };

/**
 * 입학반 다음주 기준 시작일/종료일 계산
 * @param {string} entranceDateStr - 입학반 날짜 (YYYY-MM-DD)
 * @param {Array} requestedSlots - [{day: '화', period: 2}, {day: '목', period: 2}]
 * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD 형식
 */
const calculateStartEndDates = (entranceDateStr, requestedSlots) => {
    // 로컬 시간 기준 YYYY-MM-DD 포맷 (UTC 변환 방지)
    const fmtLocal = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };

    if (!entranceDateStr || !requestedSlots || requestedSlots.length === 0) {
        const today = new Date();
        const end = new Date(today);
        end.setDate(end.getDate() + 30);
        return { startDate: fmtLocal(today), endDate: fmtLocal(end) };
    }

    const entranceDate = new Date(entranceDateStr + 'T00:00:00');

    // 입학반 다음주 월요일 찾기
    const dayOfWeek = entranceDate.getDay(); // 0=일, 1=월, ..., 6=토
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMonday = new Date(entranceDate);
    nextMonday.setDate(entranceDate.getDate() + daysUntilNextMonday);

    // 수강 요일 인덱스 정렬
    const classDayIndices = requestedSlots
        .map(s => dayNameToIndex[s.day])
        .filter(Boolean)
        .sort((a, b) => a - b);

    if (classDayIndices.length === 0) {
        const end = new Date(nextMonday);
        end.setDate(end.getDate() + 27);
        return { startDate: fmtLocal(nextMonday), endDate: fmtLocal(end) };
    }

    // 시작일: 다음주 첫 수업 요일
    const firstClassDayOffset = classDayIndices[0] - 1; // 월=0 offset
    const startDate = new Date(nextMonday);
    startDate.setDate(nextMonday.getDate() + firstClassDayOffset);

    // 종료일: 4주차 마지막 수업 요일
    const lastClassDayOffset = classDayIndices[classDayIndices.length - 1] - 1;
    const week4Monday = new Date(nextMonday);
    week4Monday.setDate(nextMonday.getDate() + 21); // 3주 후 = 4주차 월요일
    const endDate = new Date(week4Monday);
    endDate.setDate(week4Monday.getDate() + lastClassDayOffset);

    return { startDate: fmtLocal(startDate), endDate: fmtLocal(endDate) };
};

const CoachNewStudents = ({ user, onBack }) => {
    const [activeTab, setActiveTab] = useState('registrations');
    const [loading, setLoading] = useState(false);

    // === 등록 목록 ===
    const [registrations, setRegistrations] = useState([]);
    const [regFilter, setRegFilter] = useState('pending');
    const [expandedReg, setExpandedReg] = useState(null);
    const [approving, setApproving] = useState(null);

    // === 입학반 관리 ===
    const [entranceClasses, setEntranceClassesList] = useState([]);
    const [showEntranceForm, setShowEntranceForm] = useState(false);
    const [editingEntrance, setEditingEntrance] = useState(null);
    const [entranceForm, setEntranceForm] = useState({ date: '', time: '', description: '', maxCapacity: 10 });

    // === FAQ 관리 ===
    const [faqList, setFaqList] = useState([]);
    const [showFaqForm, setShowFaqForm] = useState(false);
    const [editingFaq, setEditingFaq] = useState(null);
    const [faqForm, setFaqForm] = useState({ question: '', answer: '', order: 0 });

    useEffect(() => {
        if (activeTab === 'registrations') loadRegistrations();
        if (activeTab === 'entrance') loadEntranceClasses();
        if (activeTab === 'faq') loadFAQs();
    }, [activeTab, regFilter]);

    // ─── Data loading ─────────────────────
    const loadRegistrations = async () => {
        setLoading(true);
        try {
            const data = await getNewStudentRegistrations(regFilter || null);
            setRegistrations(data);
        } catch (err) {
            console.error('등록 목록 조회 실패:', err);
        }
        setLoading(false);
    };

    const loadEntranceClasses = async () => {
        setLoading(true);
        try {
            const data = await getEntranceClasses(false);
            setEntranceClassesList(data);
        } catch (err) {
            console.error('입학반 조회 실패:', err);
        }
        setLoading(false);
    };

    const loadFAQs = async () => {
        setLoading(true);
        try {
            const data = await getFAQs(false);
            setFaqList(data);
        } catch (err) {
            console.error('FAQ 조회 실패:', err);
        }
        setLoading(false);
    };

    // ─── 승인 워크플로우 ─────────────────────
    const handleApprove = async (reg) => {
        if (!confirm(`"${reg.name}" 수강생을 승인하시겠습니까?\n\nFirestore 계정 생성 + Google Sheets 행 추가가 진행됩니다.`)) return;

        setApproving(reg.id);
        try {
            // 1. Firestore users/{name} 생성
            const userRef = doc(db, 'users', reg.name);
            await setDoc(userRef, {
                password: reg.password,
                isCoach: false,
                createdAt: serverTimestamp()
            });

            // 2. Google Sheets 행 추가
            const targetSheet = getCurrentSheetName();
            const rows = await readSheetData(`${targetSheet}!A:R`);
            let lastDataRowIndex = 1;
            for (let i = rows.length - 1; i >= 2; i--) {
                if (rows[i] && rows[i][1]) {
                    lastDataRowIndex = i;
                    break;
                }
            }
            const nextSheetRow = lastDataRowIndex + 1 + 1;

            // 입학반 다음주 기준 시작일/종료일 계산
            const { startDate: calcStartDate, endDate: calcEndDate } = calculateStartEndDates(
                reg.entranceDate,
                reg.requestedSlots
            );
            const startDateYYMMDD = convertToYYMMDD(calcStartDate);
            const endDateYYMMDD = convertToYYMMDD(calcEndDate);

            // 결제금액: 만원 단위 (390000 → 39)
            const paymentAmount = reg.totalCost ? String(Math.round(reg.totalCost / 10000)) : '';

            const rowData = [
                '',                                     // A: 번호
                reg.name,                               // B: 이름
                String(reg.weeklyFrequency),             // C: 주횟수
                reg.scheduleString,                      // D: 요일 및 시간
                reg.healthIssues || '',                  // E: 특이사항
                '신규',                                  // F: 신규/재등록
                startDateYYMMDD,                         // G: 시작날짜
                endDateYYMMDD,                           // H: 종료날짜
                paymentAmount,                           // I: 결제금액 (만원 단위)
                '',                                      // J: 결제일
                reg.paymentMethod === 'naver' ? 'O' : 'X', // K: 결제유무
                reg.paymentMethod === 'naver' ? '네이버' : reg.paymentMethod === 'card' ? '현장카드' : '계좌이체', // L: 결제방식
                'X',                                     // M: 홀딩
                '',                                      // N: 홀딩 시작일
                '',                                      // O: 홀딩 종료일
                reg.phone,                               // P: 핸드폰
                reg.gender || '',                        // Q: 성별
                reg.occupation || ''                     // R: 직업
            ];

            await writeSheetData(`${targetSheet}!A${nextSheetRow}:R${nextSheetRow}`, [rowData]);

            // 2-1. 주황색 음영 적용 (신규 수강생 표시)
            try {
                const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                const cellRanges = columns.map(col => `${col}${nextSheetRow}`);
                await highlightCells(cellRanges, targetSheet, {
                    red: 1.0,
                    green: 0.87,
                    blue: 0.68
                });
            } catch (err) {
                console.warn('주황색 음영 적용 실패:', err);
            }

            // 3. 등록 상태 업데이트
            await updateNewStudentRegistration(reg.id, {
                status: 'approved',
                approvedAt: new Date().toISOString()
            });

            // 4. 입학반 인원 증가
            if (reg.entranceClassId) {
                try {
                    const classes = await getEntranceClasses(false);
                    const ec = classes.find(c => c.id === reg.entranceClassId);
                    if (ec) {
                        await updateEntranceClass(reg.entranceClassId, {
                            currentCount: (ec.currentCount || 0) + 1
                        });
                    }
                } catch (err) {
                    console.warn('입학반 인원 업데이트 실패:', err);
                }
            }

            alert(`"${reg.name}" 수강생이 승인되었습니다.\n로그인 가능 상태입니다.`);
            await loadRegistrations();
        } catch (err) {
            console.error('승인 실패:', err);
            alert('승인 실패: ' + err.message);
        }
        setApproving(null);
    };

    const handleReject = async (reg) => {
        if (!confirm(`"${reg.name}" 수강생의 등록을 거절하시겠습니까?`)) return;

        try {
            await updateNewStudentRegistration(reg.id, { status: 'rejected' });
            await loadRegistrations();
        } catch (err) {
            alert('거절 실패: ' + err.message);
        }
    };

    // ─── 입학반 CRUD ─────────────────────
    const handleEntranceSubmit = async () => {
        if (!entranceForm.date || !entranceForm.time) {
            alert('날짜와 시간을 입력해주세요.');
            return;
        }

        try {
            if (editingEntrance) {
                await updateEntranceClass(editingEntrance.id, entranceForm);
            } else {
                await createEntranceClass(entranceForm);
            }
            setShowEntranceForm(false);
            setEditingEntrance(null);
            setEntranceForm({ date: '', time: '', description: '', maxCapacity: 10 });
            await loadEntranceClasses();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    };

    const handleEntranceDelete = async (ec) => {
        if (!confirm('이 입학반 일정을 삭제하시겠습니까?')) return;
        try {
            await deleteEntranceClass(ec.id);
            await loadEntranceClasses();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    };

    // ─── FAQ CRUD ─────────────────────
    const handleFaqSubmit = async () => {
        if (!faqForm.question || !faqForm.answer) {
            alert('질문과 답변을 입력해주세요.');
            return;
        }

        try {
            if (editingFaq) {
                await updateFAQ(editingFaq.id, faqForm);
            } else {
                await createFAQ(faqForm);
            }
            setShowFaqForm(false);
            setEditingFaq(null);
            setFaqForm({ question: '', answer: '', order: 0 });
            await loadFAQs();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    };

    const handleFaqDelete = async (faq) => {
        if (!confirm('이 FAQ를 삭제하시겠습니까?')) return;
        try {
            await deleteFAQ(faq.id);
            await loadFAQs();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    };

    const formatScheduleDisplay = (reg) => {
        if (!reg.scheduleString) return '-';
        return reg.scheduleString;
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        if (timestamp.toDate) return timestamp.toDate().toLocaleDateString('ko-KR');
        if (typeof timestamp === 'string') return timestamp.split('T')[0];
        return '-';
    };

    return (
        <div className="cns-container">
            <div className="cns-background">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
            </div>

            <div className="cns-content">
                <header className="cns-header">
                    <div className="cns-header-row">
                        <button onClick={onBack} className="cns-back-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <h1 className="cns-title">신규 수강생 관리</h1>
                    </div>

                    {/* Sub Tabs */}
                    <div className="cns-tabs">
                        <button
                            className={`cns-tab ${activeTab === 'registrations' ? 'active' : ''}`}
                            onClick={() => setActiveTab('registrations')}
                        >
                            등록 목록
                        </button>
                        <button
                            className={`cns-tab ${activeTab === 'entrance' ? 'active' : ''}`}
                            onClick={() => setActiveTab('entrance')}
                        >
                            입학반 관리
                        </button>
                        <button
                            className={`cns-tab ${activeTab === 'faq' ? 'active' : ''}`}
                            onClick={() => setActiveTab('faq')}
                        >
                            FAQ 관리
                        </button>
                    </div>
                </header>

                {/* === 등록 목록 탭 === */}
                {activeTab === 'registrations' && (
                    <div className="cns-section">
                        <div className="cns-filter-row">
                            {['pending', 'approved', 'rejected'].map(f => (
                                <button
                                    key={f}
                                    className={`cns-filter-btn ${regFilter === f ? 'active' : ''}`}
                                    onClick={() => setRegFilter(f)}
                                >
                                    {f === 'pending' ? '대기중' : f === 'approved' ? '승인됨' : '거절됨'}
                                </button>
                            ))}
                        </div>

                        {loading ? (
                            <div className="cns-loading">불러오는 중...</div>
                        ) : registrations.length === 0 ? (
                            <div className="cns-empty">
                                {regFilter === 'pending' ? '대기 중인 등록이 없습니다.' : '해당 목록이 없습니다.'}
                            </div>
                        ) : (
                            <div className="cns-reg-list">
                                {registrations.map(reg => (
                                    <div key={reg.id} className="cns-reg-card">
                                        <div
                                            className="cns-reg-card-header"
                                            onClick={() => setExpandedReg(expandedReg === reg.id ? null : reg.id)}
                                        >
                                            <div className="cns-reg-main">
                                                <span className="cns-reg-name">{reg.name}</span>
                                                <span className="cns-reg-freq">
                                                    {PRICING.find(p => p.frequency === reg.weeklyFrequency)?.label || `주${reg.weeklyFrequency}회`}
                                                </span>
                                                <span className="cns-reg-schedule">{formatScheduleDisplay(reg)}</span>
                                            </div>
                                            <div className="cns-reg-badges">
                                                {reg.wantsConsultation && <span className="cns-badge consult">상담</span>}
                                                {reg.question && <span className="cns-badge question">질문</span>}
                                                <span className="cns-expand-arrow">{expandedReg === reg.id ? '▲' : '▼'}</span>
                                            </div>
                                        </div>

                                        {expandedReg === reg.id && (
                                            <div className="cns-reg-detail">
                                                <div className="cns-detail-grid">
                                                    <div className="cns-detail-item">
                                                        <span className="cns-detail-label">연락처</span>
                                                        <span className="cns-detail-value">{reg.phone}</span>
                                                    </div>
                                                    <div className="cns-detail-item">
                                                        <span className="cns-detail-label">결제방식</span>
                                                        <span className="cns-detail-value">
                                                            {reg.paymentMethod === 'naver' ? '네이버' : reg.paymentMethod === 'card' ? '현장 카드 결제' : '현장 계좌 이체'}
                                                        </span>
                                                    </div>
                                                    <div className="cns-detail-item">
                                                        <span className="cns-detail-label">총 비용</span>
                                                        <span className="cns-detail-value">{reg.totalCost?.toLocaleString()}원</span>
                                                    </div>
                                                    <div className="cns-detail-item">
                                                        <span className="cns-detail-label">입학반</span>
                                                        <span className="cns-detail-value">{reg.entranceClassDate || '-'}</span>
                                                    </div>
                                                    {reg.gender && (
                                                        <div className="cns-detail-item">
                                                            <span className="cns-detail-label">성별</span>
                                                            <span className="cns-detail-value">{reg.gender}</span>
                                                        </div>
                                                    )}
                                                    {reg.occupation && (
                                                        <div className="cns-detail-item">
                                                            <span className="cns-detail-label">직업</span>
                                                            <span className="cns-detail-value">{reg.occupation}</span>
                                                        </div>
                                                    )}
                                                    {reg.healthIssues && (
                                                        <div className="cns-detail-item full">
                                                            <span className="cns-detail-label">불편한 곳</span>
                                                            <span className="cns-detail-value">{reg.healthIssues}</span>
                                                        </div>
                                                    )}
                                                    {reg.exerciseGoal && (
                                                        <div className="cns-detail-item full">
                                                            <span className="cns-detail-label">운동 목적</span>
                                                            <span className="cns-detail-value">{reg.exerciseGoal}</span>
                                                        </div>
                                                    )}
                                                    {reg.question && (
                                                        <div className="cns-detail-item full">
                                                            <span className="cns-detail-label">질문</span>
                                                            <span className="cns-detail-value">{reg.question}</span>
                                                        </div>
                                                    )}
                                                    <div className="cns-detail-item">
                                                        <span className="cns-detail-label">등록일</span>
                                                        <span className="cns-detail-value">{formatDate(reg.createdAt)}</span>
                                                    </div>
                                                </div>

                                                {regFilter === 'pending' && (
                                                    <div className="cns-action-row">
                                                        <button
                                                            className="cns-action-btn approve"
                                                            onClick={() => handleApprove(reg)}
                                                            disabled={approving === reg.id}
                                                        >
                                                            {approving === reg.id ? '처리 중...' : '승인'}
                                                        </button>
                                                        <button
                                                            className="cns-action-btn reject"
                                                            onClick={() => handleReject(reg)}
                                                            disabled={approving === reg.id}
                                                        >
                                                            거절
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* === 입학반 관리 탭 === */}
                {activeTab === 'entrance' && (
                    <div className="cns-section">
                        <div className="cns-section-header">
                            <h2>입학반 일정</h2>
                            <button
                                className="cns-add-btn"
                                onClick={() => {
                                    setEditingEntrance(null);
                                    setEntranceForm({ date: '', time: '', endTime: '', description: '', maxCapacity: 10 });
                                    setShowEntranceForm(true);
                                }}
                            >
                                + 추가
                            </button>
                        </div>

                        {loading ? (
                            <div className="cns-loading">불러오는 중...</div>
                        ) : entranceClasses.length === 0 ? (
                            <div className="cns-empty">등록된 입학반이 없습니다.</div>
                        ) : (
                            <div className="cns-entrance-list">
                                {entranceClasses.map(ec => (
                                    <div key={ec.id} className={`cns-entrance-card ${!ec.isActive ? 'inactive' : ''}`}>
                                        <div className="cns-entrance-info">
                                            <div className="cns-entrance-date">{formatEntranceDate(ec.date)}</div>
                                            <div className="cns-entrance-time">{ec.time}{ec.endTime ? ` ~ ${ec.endTime}` : ''}</div>
                                            {ec.description && <div className="cns-entrance-desc">{ec.description}</div>}
                                            <div className="cns-entrance-capacity">
                                                {ec.currentCount || 0}/{ec.maxCapacity}명
                                                {!ec.isActive && <span className="cns-inactive-badge">비활성</span>}
                                            </div>
                                        </div>
                                        <div className="cns-entrance-actions">
                                            <button
                                                className="cns-icon-btn edit"
                                                onClick={() => {
                                                    setEditingEntrance(ec);
                                                    setEntranceForm({
                                                        date: ec.date,
                                                        time: ec.time,
                                                        endTime: ec.endTime || '',
                                                        description: ec.description || '',
                                                        maxCapacity: ec.maxCapacity || 10
                                                    });
                                                    setShowEntranceForm(true);
                                                }}
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className="cns-icon-btn delete"
                                                onClick={() => handleEntranceDelete(ec)}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 입학반 폼 모달 */}
                        {showEntranceForm && (
                            <div className="cns-modal-overlay" onClick={() => setShowEntranceForm(false)}>
                                <div className="cns-modal" onClick={(e) => e.stopPropagation()}>
                                    <h3>{editingEntrance ? '입학반 수정' : '입학반 추가'}</h3>
                                    <div className="cns-form-field">
                                        <label>날짜</label>
                                        <input
                                            type="date"
                                            value={entranceForm.date}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, date: e.target.value })}
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>시작 시간</label>
                                        <input
                                            type="text"
                                            value={entranceForm.time}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, time: e.target.value })}
                                            placeholder="예: 14:00"
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>종료 시간</label>
                                        <input
                                            type="text"
                                            value={entranceForm.endTime || ''}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, endTime: e.target.value })}
                                            placeholder="예: 15:00"
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>설명 (선택)</label>
                                        <input
                                            type="text"
                                            value={entranceForm.description}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, description: e.target.value })}
                                            placeholder="입학반 설명"
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>최대 인원</label>
                                        <input
                                            type="number"
                                            value={entranceForm.maxCapacity}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, maxCapacity: parseInt(e.target.value) || 1 })}
                                            min={1}
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-modal-actions">
                                        <button className="cns-modal-btn cancel" onClick={() => setShowEntranceForm(false)}>취소</button>
                                        <button className="cns-modal-btn save" onClick={handleEntranceSubmit}>저장</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* === FAQ 관리 탭 === */}
                {activeTab === 'faq' && (
                    <div className="cns-section">
                        <div className="cns-section-header">
                            <h2>FAQ 관리</h2>
                            <button
                                className="cns-add-btn"
                                onClick={() => {
                                    setEditingFaq(null);
                                    setFaqForm({ question: '', answer: '', order: faqList.length });
                                    setShowFaqForm(true);
                                }}
                            >
                                + 추가
                            </button>
                        </div>

                        {loading ? (
                            <div className="cns-loading">불러오는 중...</div>
                        ) : faqList.length === 0 ? (
                            <div className="cns-empty">등록된 FAQ가 없습니다.</div>
                        ) : (
                            <div className="cns-faq-list">
                                {faqList.map((faq, idx) => (
                                    <div key={faq.id} className="cns-faq-card">
                                        <div className="cns-faq-content">
                                            <div className="cns-faq-order">#{faq.order ?? idx + 1}</div>
                                            <div className="cns-faq-text">
                                                <div className="cns-faq-q">Q. {faq.question}</div>
                                                <div className="cns-faq-a">A. {faq.answer}</div>
                                            </div>
                                        </div>
                                        <div className="cns-faq-actions">
                                            <button
                                                className="cns-icon-btn edit"
                                                onClick={() => {
                                                    setEditingFaq(faq);
                                                    setFaqForm({
                                                        question: faq.question,
                                                        answer: faq.answer,
                                                        order: faq.order ?? idx
                                                    });
                                                    setShowFaqForm(true);
                                                }}
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className="cns-icon-btn delete"
                                                onClick={() => handleFaqDelete(faq)}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* FAQ 폼 모달 */}
                        {showFaqForm && (
                            <div className="cns-modal-overlay" onClick={() => setShowFaqForm(false)}>
                                <div className="cns-modal" onClick={(e) => e.stopPropagation()}>
                                    <h3>{editingFaq ? 'FAQ 수정' : 'FAQ 추가'}</h3>
                                    <div className="cns-form-field">
                                        <label>질문</label>
                                        <input
                                            type="text"
                                            value={faqForm.question}
                                            onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })}
                                            placeholder="질문을 입력하세요"
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>답변</label>
                                        <textarea
                                            value={faqForm.answer}
                                            onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
                                            placeholder="답변을 입력하세요"
                                            className="cns-form-input cns-textarea"
                                            rows={4}
                                        />
                                    </div>
                                    <div className="cns-form-field">
                                        <label>순서</label>
                                        <input
                                            type="number"
                                            value={faqForm.order}
                                            onChange={(e) => setFaqForm({ ...faqForm, order: parseInt(e.target.value) || 0 })}
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-modal-actions">
                                        <button className="cns-modal-btn cancel" onClick={() => setShowFaqForm(false)}>취소</button>
                                        <button className="cns-modal-btn save" onClick={handleFaqSubmit}>저장</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CoachNewStudents;
