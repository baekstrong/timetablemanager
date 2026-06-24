import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField, clearStudentScheduleAllSheets, processStudentAbsence, processCoachHolding, cancelHoldingInSheets, pauseStudent, resumeStudent } from '../services/googleSheetsService';
import { createHoldingRequest, getHoldingsByStudent, cancelHolding, getActiveMakeupRequests, createStudentTermination, recordStudentCount, getGradeMap } from '../services/firebaseService';
import { getCoachStudentListStatus, shouldShowInCoachStudentList, isPausedRegistration } from '../utils/studentList';
import { onSeatsFreedForDates } from '../services/makeupWaitlistService';
import GoogleSheetsEmbed from './GoogleSheetsEmbed';
import StudentRegistrationModal from './StudentRegistrationModal';
import ContractHistory from './ContractHistory';
import SmsSendModal from './SmsSendModal';
import GradeBadge from './GradeBadge';
import './StudentManager.css';

const StudentManager = ({ onImpersonate, onNavigate }) => {
    const {
        students,
        isConnected,
        updateStudent,
        loading,
        error,
        refresh,
        holidays
    } = useGoogleSheets();
    const [editingStudent, setEditingStudent] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [viewMode, setViewMode] = useState('table'); // 'table' or 'sheet'
    const [renewalStudentName, setRenewalStudentName] = useState(() => {
        const name = sessionStorage.getItem('renewalStudentName');
        if (name) sessionStorage.removeItem('renewalStudentName');
        return name;
    });
    const [showRegistrationModal, setShowRegistrationModal] = useState(Boolean(renewalStudentName));
    const [absenceTarget, setAbsenceTarget] = useState(null); // 결석 대상 수강생
    const [absenceDates, setAbsenceDates] = useState([]); // 결석 날짜 목록
    const [absenceDateInput, setAbsenceDateInput] = useState(''); // 날짜 입력
    const [absenceProcessing, setAbsenceProcessing] = useState(false);
    const [contractHistoryTarget, setContractHistoryTarget] = useState(null);
    const [holdingTarget, setHoldingTarget] = useState(null); // 홀딩 대상 수강생
    const [existingHoldings, setExistingHoldings] = useState([]); // 기존 활성 홀딩 목록
    const [holdingCancelling, setHoldingCancelling] = useState(false); // 홀딩 취소 처리 중
    const [holdingDates, setHoldingDates] = useState([]); // 홀딩 날짜 목록
    const [holdingDateInput, setHoldingDateInput] = useState(''); // 날짜 입력
    const [holdingProcessing, setHoldingProcessing] = useState(false);
    const [searchQuery, setSearchQuery] = useState(''); // 수강생 검색어
    const [actionProcessing, setActionProcessing] = useState(''); // 작업(종료/일시정지/재개) 처리 중 메시지
    const [showSmsModal, setShowSmsModal] = useState(false);
    const [gradeMap, setGradeMap] = useState({}); // 이름→학년키 (수강생 레벨 표시용)

    // 학년 맵 로드(게시판과 동일 캐시 소스). 코치 백필이 채운 grade를 읽음.
    useEffect(() => {
        let cancel = false;
        getGradeMap().then(map => { if (!cancel && map) setGradeMap(map); });
        return () => { cancel = true; };
    }, []);

    const getCountedHolidayMakeupDates = async (studentName) => {
        const makeups = await getActiveMakeupRequests(studentName).catch(() => []);
        return [...new Set(makeups.map(m => m.originalClass?.date).filter(Boolean))];
    };

    // Start editing a student
    const handleEdit = (student, index) => {
        setEditingStudent(index);
        setEditForm({
            ...student,
            rowIndex: student._rowIndex // Use original row index
        });
    };

    // Cancel editing
    const handleCancel = () => {
        setEditingStudent(null);
        setEditForm({});
    };

    // Save changes
    const handleSave = async () => {
        try {
            await updateStudent(editForm.rowIndex, editForm);
            setEditingStudent(null);
            setEditForm({});
            alert('수강생 정보가 성공적으로 업데이트되었습니다.');
        } catch (err) {
            console.error('Failed to update student:', err);
            alert('수강생 정보 업데이트에 실패했습니다.');
        }
    };

    // End class (Clear schedule in ALL sheets)
    const handleEndClass = async (student) => {
        if (!confirm(`${student['이름']} 수강생의 수강을 종료하시겠습니까?\n\n- 시간표에서 제거됩니다.\n- 이름, 결제 내역 등은 시트에 보존됩니다.\n- 모든 시트의 '요일 및 시간' 칸이 지워집니다.`)) {
            return;
        }

        setActionProcessing('수강 종료 처리 중...');
        try {
            // 모든 시트에서 해당 학생의 스케줄 삭제
            await clearStudentScheduleAllSheets(student['이름']);
            // 이탈 통계용 종료 기록 (실패해도 종료 처리는 유지)
            try {
                await createStudentTermination(student['이름']);
            } catch (recErr) {
                console.warn('종료 기록 저장 실패:', recErr);
            }
            if (refresh) await refresh();
            alert('수강 종료 처리되었습니다. (모든 시트에서 스케줄 삭제)');
        } catch (err) {
            console.error('Failed to end class:', err);
            alert('수강 종료 처리에 실패했습니다.');
        } finally {
            setActionProcessing('');
        }
    };

    // 일시정지 (주횟수·요일/시간 비우고 종료날짜를 "N회"로 — 모든 시트의 등록 행)
    const handlePause = async (student) => {
        if (!confirm(`${student['이름']} 수강생을 일시정지하시겠습니까?\n\n- 주횟수, 요일 및 시간을 비웁니다.\n- 종료날짜에 남은 횟수(예: "5회")를 기록합니다.\n- 오늘 수업이 끝난 후면 오늘은 횟수에서 제외됩니다.\n- 미리 등록이 있으면 함께 정지(시작날짜도 비움)됩니다.`)) {
            return;
        }
        setActionProcessing('일시정지 처리 중...');
        try {
            const holidaysArray = holidays.map(h => typeof h === 'string' ? { date: h } : h);
            const results = await pauseStudent(student['이름'], holidaysArray);
            if (refresh) await refresh();
            const summary = results
                .map(r => `${r.notStarted ? '미리 등록' : '현재 등록'}: ${r.n}회${r.notStarted ? ' (시작 전)' : ''}`)
                .join('\n');
            alert(`일시정지 처리 완료!\n\n${summary}`);
        } catch (err) {
            console.error('일시정지 실패:', err);
            alert('일시정지 처리에 실패했습니다: ' + err.message);
        } finally {
            setActionProcessing('');
        }
    };

    // 재개 (정지된 등록을 복원 + 재시작일부터 종료날짜 재계산)
    const handleResume = async (student) => {
        const today = new Date();
        const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const input = prompt(`${student['이름']} 수강생을 재개합니다.\n재시작 날짜를 입력하세요 (YYYY-MM-DD):`, defaultDate);
        if (!input) return;
        const restart = new Date(input.trim() + 'T00:00:00');
        if (isNaN(restart.getTime())) {
            alert('날짜 형식이 올바르지 않습니다. 예: 2026-07-01');
            return;
        }
        setActionProcessing('재개 처리 중...');
        try {
            const holidaysArray = holidays.map(h => typeof h === 'string' ? { date: h } : h);
            const results = await resumeStudent(student['이름'], restart, holidaysArray);
            if (refresh) await refresh();
            const summary = results
                .map(r => `${r.schedule} (${r.n}회): ${r.start} ~ ${r.end}`)
                .join('\n');
            alert(`재개 처리 완료!\n\n${summary}`);
        } catch (err) {
            console.error('재개 실패:', err);
            alert('재개 처리에 실패했습니다: ' + err.message);
        } finally {
            setActionProcessing('');
        }
    };

    // 결석 모달 열기
    const handleOpenAbsence = (student) => {
        setAbsenceTarget(student);
        setAbsenceDates([]);
        setAbsenceDateInput('');
    };

    // 결석 날짜 추가
    const handleAddAbsenceDate = () => {
        if (!absenceDateInput) return;
        if (absenceDates.includes(absenceDateInput)) {
            alert('이미 추가된 날짜입니다.');
            return;
        }
        setAbsenceDates(prev => [...prev, absenceDateInput].sort());
        setAbsenceDateInput('');
    };

    // 결석 날짜 삭제
    const handleRemoveAbsenceDate = (dateToRemove) => {
        setAbsenceDates(prev => prev.filter(d => d !== dateToRemove));
    };

    // 결석 처리 실행
    const handleSubmitAbsence = async () => {
        if (!absenceTarget || absenceDates.length === 0) {
            alert('결석 날짜를 최소 1개 이상 선택해주세요.');
            return;
        }

        const dateTexts = absenceDates.map(d => {
            const date = new Date(d + 'T00:00:00');
            return `${date.getMonth() + 1}/${date.getDate()}`;
        }).join(', ');

        if (!confirm(`${absenceTarget['이름']} 수강생의 결석 처리를 진행하시겠습니까?\n\n결석일: ${dateTexts}\n\n- 특이사항에 결석 내용이 기록됩니다.\n- 종료날짜가 결석 횟수만큼 연장됩니다.`)) {
            return;
        }

        setAbsenceProcessing(true);
        try {
            const result = await processStudentAbsence(
                absenceTarget['이름'],
                absenceDates,
                holidays,
                await getCountedHolidayMakeupDates(absenceTarget['이름'])
            );
            alert(`✅ 결석 처리 완료!\n\n수업일 결석: ${result.validAbsenceCount}일\n새 종료날짜: ${result.newEndDate}\n특이사항: ${result.notesText}`);

            // 빠진 자리의 보강 대기자에게 순차 알림 (실패해도 처리 자체에는 영향 없음)
            try {
                await onSeatsFreedForDates(absenceDates, absenceTarget['요일 및 시간'] || '');
            } catch (e) {
                console.error('보강 대기 알림 트리거 실패:', e);
            }

            setAbsenceTarget(null);
            setAbsenceDates([]);
            if (refresh) refresh();
        } catch (err) {
            console.error('결석 처리 실패:', err);
            alert('결석 처리에 실패했습니다: ' + err.message);
        }
        setAbsenceProcessing(false);
    };

    // Handle form field changes
    const handleFieldChange = (field, value) => {
        setEditForm(prev => ({
            ...prev,
            [field]: value
        }));
    };

    // 등록 성공 시 모달 닫기 + 새로고침
    const handleRegistrationSuccess = () => {
        setShowRegistrationModal(false);
        if (refresh) refresh();
    };

    // 홀딩 모달 열기
    const handleOpenHolding = async (student) => {
        setHoldingTarget(student);
        setHoldingDates([]);
        setHoldingDateInput('');
        // 기존 활성 홀딩 목록 조회 (현재 등록 기간 내 홀딩만)
        try {
            const holdings = await getHoldingsByStudent(student['이름']);
            const regStart = student['시작날짜'] || '';
            const regEnd = student['종료날짜'] || '';
            const filtered = holdings.filter(h => {
                if (!regStart || !regEnd) return true;
                // 시작날짜/종료날짜는 YYMMDD 형식, 홀딩의 startDate/endDate는 YYYY-MM-DD 형식
                const regStartISO = `20${regStart.substring(0,2)}-${regStart.substring(2,4)}-${regStart.substring(4,6)}`;
                const regEndISO = `20${regEnd.substring(0,2)}-${regEnd.substring(2,4)}-${regEnd.substring(4,6)}`;
                return h.startDate >= regStartISO && h.startDate <= regEndISO;
            });
            setExistingHoldings(filtered);
        } catch (err) {
            console.error('홀딩 목록 조회 실패:', err);
            setExistingHoldings([]);
        }
    };

    // 홀딩 취소 처리
    const handleCancelHolding = async (holdingData) => {
        if (!confirm(`홀딩을 취소하시겠습니까?\n기간: ${holdingData.startDate} ~ ${holdingData.endDate}`)) {
            return;
        }
        setHoldingCancelling(true);
        try {
            // Firebase 홀딩 취소
            await cancelHolding(holdingData.id);
            // 남은 홀딩 목록 계산
            const remainingHoldingsList = existingHoldings.filter(h => h.id !== holdingData.id);
            // Google Sheets 홀딩 정보 업데이트 (종료일 재계산)
            const holidaysArray = holidays.map(h => typeof h === 'string' ? { date: h } : h);
            const countedHolidayDates = await getCountedHolidayMakeupDates(holdingTarget['이름']);
            await cancelHoldingInSheets(holdingTarget['이름'], remainingHoldingsList, holidaysArray, countedHolidayDates);
            // 상태 업데이트
            setExistingHoldings(remainingHoldingsList);
            if (refresh) await refresh();
            alert('홀딩이 취소되었습니다.');
        } catch (err) {
            console.error('홀딩 취소 실패:', err);
            alert('홀딩 취소에 실패했습니다: ' + err.message);
        }
        setHoldingCancelling(false);
    };

    // 홀딩 날짜 추가
    const handleAddHoldingDate = () => {
        if (!holdingDateInput) return;
        if (holdingDates.includes(holdingDateInput)) {
            alert('이미 추가된 날짜입니다.');
            return;
        }
        setHoldingDates(prev => [...prev, holdingDateInput].sort());
        setHoldingDateInput('');
    };

    // 홀딩 날짜 삭제
    const handleRemoveHoldingDate = (dateToRemove) => {
        setHoldingDates(prev => prev.filter(d => d !== dateToRemove));
    };

    // 홀딩 처리 실행
    const handleSubmitHolding = async () => {
        if (!holdingTarget || holdingDates.length === 0) {
            alert('홀딩 날짜를 최소 1개 이상 선택해주세요.');
            return;
        }

        const sortedDates = [...holdingDates].sort();
        const dateTexts = sortedDates.map(d => {
            const date = new Date(d + 'T00:00:00');
            return `${date.getMonth() + 1}/${date.getDate()}`;
        }).join(', ');

        if (!confirm(`${holdingTarget['이름']} 수강생의 홀딩을 처리하시겠습니까?\n\n홀딩일: ${dateTexts}\n\n- Google Sheets + Firebase에 모두 기록됩니다.\n- 종료날짜가 자동으로 연장됩니다.\n- 미리 등록이 있으면 일정이 자동 조정됩니다.`)) {
            return;
        }

        setHoldingProcessing(true);
        try {
            const startDate = sortedDates[0];
            const endDate = sortedDates[sortedDates.length - 1];

            // 1. Firebase에 홀딩 기록
            await createHoldingRequest(holdingTarget['이름'], startDate, endDate, sortedDates);

            // 2. Google Sheets 업데이트 (종료일 재계산 + 다음 등록 조정)
            const result = await processCoachHolding(
                holdingTarget['이름'],
                sortedDates,
                holidays,
                await getCountedHolidayMakeupDates(holdingTarget['이름'])
            );

            alert(`홀딩 처리 완료!\n\n홀딩 기간: ${startDate} ~ ${endDate}\n새 종료날짜: ${result.newEndDate}\n홀딩 상태: ${result.holdingStatus}`);

            // 빠진 자리의 보강 대기자에게 순차 알림 (실패해도 처리 자체에는 영향 없음)
            try {
                await onSeatsFreedForDates(sortedDates, holdingTarget['요일 및 시간'] || '');
            } catch (e) {
                console.error('보강 대기 알림 트리거 실패:', e);
            }

            setHoldingTarget(null);
            setHoldingDates([]);
            if (refresh) refresh();
        } catch (err) {
            console.error('홀딩 처리 실패:', err);
            alert('홀딩 처리에 실패했습니다: ' + err.message);
        }
        setHoldingProcessing(false);
    };

    // 스케줄이 남아있는 수강생을 코치 관리 목록에 표시 + 이름순(ㄱ→ㅎ) 정렬
    const activeStudents = useMemo(() => {
        return students
            .filter(shouldShowInCoachStudentList)
            .sort((a, b) => (a['이름'] || '').localeCompare(b['이름'] || '', 'ko'));
    }, [students]);

    // 이번 달 총 수강생수(활성) 스냅샷 기록 — 매출 통계의 총 수강생 추세용 (앞으로 누적)
    useEffect(() => {
        if (activeStudents.length === 0) return; // 로딩 중 0 기록 방지
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        recordStudentCount(ym, activeStudents.length).catch(() => {});
    }, [activeStudents.length]);

    // 이름 부분 일치 + 전화번호 숫자 부분 일치 필터
    const filteredStudents = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return activeStudents;
        const qDigits = q.replace(/\D/g, '');
        return activeStudents.filter(s => {
            const name = (s['이름'] || '').toLowerCase();
            if (name.includes(q)) return true;
            if (!qDigits) return false;
            const phone = String(getStudentField(s, '핸드폰') || '').replace(/\D/g, '');
            return phone.includes(qDigits);
        });
    }, [activeStudents, searchQuery]);

    // 문자 발송 수신자 목록 — 같은 이름 여러 행이면 전화번호 있는 행 우선
    const smsRecipients = useMemo(() => {
        const seen = new Map();
        activeStudents.forEach(s => {
            const name = s['이름'];
            if (!name) return;
            const phone = String(getStudentField(s, '핸드폰') || '').trim();
            if (!seen.has(name) || (!seen.get(name).phone && phone)) {
                seen.set(name, { name, phone });
            }
        });
        return Array.from(seen.values());
    }, [activeStudents]);

    // 시트 임베드 모드인 경우
    if (viewMode === 'sheet') {
        return <GoogleSheetsEmbed onBack={() => setViewMode('table')} />;
    }

    if (!isConnected) {
        return (
            <div className="student-manager-container">
                <div className="student-header">
                    <h1 className="student-title">수강생 관리</h1>
                </div>
                <div className="not-connected-message">
                    <div className="warning-icon">⚠️</div>
                    <h3>Google Sheets에 연결되지 않았습니다</h3>
                    <p>대시보드에서 Google 계정을 연결해주세요.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="student-manager-container">
            {actionProcessing && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 3000,
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: '16px', padding: '28px 32px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                    }}>
                        <div style={{
                            width: '34px', height: '34px', borderRadius: '50%',
                            border: '3px solid #EFEFF0', borderTopColor: '#329BE7',
                            animation: 'spin 0.8s linear infinite',
                        }} />
                        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{actionProcessing}</span>
                    </div>
                </div>
            )}
            <div className="student-header">
                <h1 className="student-title">수강생 관리</h1>
            </div>
            <div className="student-header-actions-mobile">
                <div className="info-message-mobile">
                    📋 관리 대상 수강생 조회 중 (요일 및 시간 기준)
                </div>
                <div className="header-buttons-row">
                    <button onClick={() => setShowRegistrationModal(true)} className="register-btn">
                        + 수강생 등록
                    </button>
                    <button onClick={() => setViewMode('sheet')} className="view-switch-btn">
                        📊 구글 시트로 보기
                    </button>
                    <button
                      type="button"
                      className="analytics-entry-btn"
                      onClick={() => onNavigate && onNavigate('analytics')}
                    >
                      📈 매출·통계
                    </button>
                    <button
                      type="button"
                      className="view-switch-btn"
                      onClick={() => onNavigate && onNavigate('holidays')}
                    >
                      🗓️ 휴일설정
                    </button>
                    <button
                        type="button"
                        className="view-switch-btn"
                        onClick={() => setShowSmsModal(true)}
                    >
                        ✉️ 문자 보내기
                    </button>
                    <div className="student-count">총 {activeStudents.length}명</div>
                </div>
                <input
                    type="search"
                    aria-label="수강생 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="이름·전화번호 검색"
                    style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '8px 12px',
                        fontSize: '0.9rem',
                        border: '1px solid var(--hairline)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        boxSizing: 'border-box',
                    }}
                />
            </div>

            {error && (
                <div className="error-banner">
                    <span>⚠️ {error}</span>
                </div>
            )}

            {loading ? (
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>데이터를 불러오는 중...</p>
                </div>
            ) : (
                <div className="student-content">
                    <div className="student-table-container">
                        <table className="student-table">
                            <thead>
                                <tr>
                                    <th>이름</th>
                                    <th>주횟수</th>
                                    <th>요일 및 시간</th>
                                    <th>시작날짜</th>
                                    <th>종료날짜</th>
                                    <th>홀딩 사용</th>
                                    <th>홀딩 시작일</th>
                                    <th>홀딩 종료일</th>
                                    <th>작업</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className="empty-message">
                                            {searchQuery.trim() ? '검색 결과가 없습니다.' : '등록된 수강생이 없습니다.'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredStudents.map((student, index) => (
                                        <tr key={index} className={editingStudent === index ? 'editing' : ''}>
                                            <td className="student-name">
                                                {student['이름'] || '-'}
                                                {student['이름'] && <GradeBadge grade={gradeMap[student['이름']]} style={{ marginLeft: '4px', marginRight: 0 }} />}
                                                {onNavigate && student['이름'] && (
                                                    <button
                                                        type="button"
                                                        title="성장 그래프 보기"
                                                        onClick={() => onNavigate('ranking', 'graph', student['이름'])}
                                                        style={{ marginLeft: '4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.85rem', padding: 0, verticalAlign: 'middle' }}
                                                    >📈</button>
                                                )}
                                            </td>

                                            {/* 주횟수 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="text"
                                                        value={editForm['주횟수'] || ''}
                                                        onChange={(e) => handleFieldChange('주횟수', e.target.value)}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    student['주횟수'] || '-'
                                                )}
                                            </td>

                                            {/* 요일 및 시간 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="text"
                                                        value={editForm['요일 및 시간'] || ''}
                                                        onChange={(e) => handleFieldChange('요일 및 시간', e.target.value)}
                                                        className="edit-input"
                                                        placeholder="예: 월수금 10:00"
                                                    />
                                                ) : (
                                                    student['요일 및 시간'] || '-'
                                                )}
                                            </td>

                                            {/* 시작날짜 */}
                                            <td>{student['시작날짜'] || '-'}</td>

                                            {/* 종료날짜 */}
                                            <td>
                                                {student['종료날짜'] || '-'}
                                                {isPausedRegistration(student) && (
                                                    <span className="student-status-badge paused">일시정지</span>
                                                )}
                                                {getCoachStudentListStatus(student) === 'expired' && (
                                                    <span className="student-status-badge expired">종료일 지남</span>
                                                )}
                                            </td>

                                            {/* 홀딩 사용여부 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <select
                                                        value={getStudentField(editForm, '홀딩 사용여부') || 'X'}
                                                        onChange={(e) => handleFieldChange('홀딩 사용여부', e.target.value)}
                                                        className="edit-select"
                                                    >
                                                        <option value="O">O</option>
                                                        <option value="X">X</option>
                                                    </select>
                                                ) : (
                                                    <span className={`holding-status ${getStudentField(student, '홀딩 사용여부') === 'O' ? 'active' : 'inactive'}`}>
                                                        {getStudentField(student, '홀딩 사용여부') || 'X'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* 홀딩 시작일 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="date"
                                                        value={getStudentField(editForm, '홀딩 시작일') || ''}
                                                        onChange={(e) => handleFieldChange('홀딩 시작일', e.target.value)}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    getStudentField(student, '홀딩 시작일') || '-'
                                                )}
                                            </td>

                                            {/* 홀딩 종료일 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="date"
                                                        value={getStudentField(editForm, '홀딩 종료일') || ''}
                                                        onChange={(e) => handleFieldChange('홀딩 종료일', e.target.value)}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    getStudentField(student, '홀딩 종료일') || '-'
                                                )}
                                            </td>

                                            {/* 작업 버튼 */}
                                            <td className="action-cell">
                                                {editingStudent === index ? (
                                                    <div className="action-buttons">
                                                        <button onClick={handleSave} className="save-btn">
                                                            저장
                                                        </button>
                                                        <button onClick={handleCancel} className="cancel-btn">
                                                            취소
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="action-buttons">
                                                        <button onClick={() => handleEdit(student, index)} className="edit-btn">
                                                            수정
                                                        </button>
                                                        <button onClick={() => handleOpenHolding(student)} className="holding-btn" title="홀딩 처리">
                                                            홀딩
                                                        </button>
                                                        <button onClick={() => handleOpenAbsence(student)} className="absence-btn" title="결석 처리">
                                                            결석
                                                        </button>
                                                        <button onClick={() => setContractHistoryTarget(student['이름'])} className="contract-btn" title="계약 이력">
                                                            계약
                                                        </button>
                                                        {isPausedRegistration(student) ? (
                                                            <button onClick={() => handleResume(student)} className="resume-btn" title="재개 (정지 해제 + 종료날짜 재계산)">
                                                                재개
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => handlePause(student)} className="pause-btn" title="일시정지 (남은 횟수 기록 후 시간표에서 제거)">
                                                                일시정지
                                                            </button>
                                                        )}
                                                        <button onClick={() => handleEndClass(student)} className="end-class-btn" title="수강 종료 (시간표에서 제거)">
                                                            종료
                                                        </button>
                                                        {onImpersonate && (
                                                            <button
                                                                onClick={() => onImpersonate(student)}
                                                                className="impersonate-btn"
                                                                title="이 수강생 화면으로 보기"
                                                                style={{
                                                                    background: '#dc2626',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    padding: '4px 8px',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem'
                                                                }}
                                                            >
                                                                👤 빙의
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showRegistrationModal && (
                <StudentRegistrationModal
                    onClose={() => { setShowRegistrationModal(false); setRenewalStudentName(null); }}
                    onSuccess={handleRegistrationSuccess}
                    initialRenewalName={renewalStudentName}
                />
            )}

            {/* 계약 이력 모달 */}
            {contractHistoryTarget && (
                <ContractHistory
                    studentName={contractHistoryTarget}
                    isCoach={true}
                    onClose={() => setContractHistoryTarget(null)}
                />
            )}

            {/* 결석 처리 모달 */}
            {absenceTarget && (
                <div className="absence-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAbsenceTarget(null); }}>
                    <div className="absence-modal-content">
                        <h2 className="absence-modal-title">결석 처리</h2>
                        <p className="absence-modal-student">{absenceTarget['이름']} ({absenceTarget['요일 및 시간'] || '-'})</p>

                        <div className="absence-date-input-row">
                            <input
                                type="date"
                                value={absenceDateInput}
                                onChange={(e) => setAbsenceDateInput(e.target.value)}
                                className="absence-date-input"
                            />
                            <button onClick={handleAddAbsenceDate} className="absence-add-btn">
                                추가
                            </button>
                        </div>

                        {absenceDates.length > 0 && (
                            <div className="absence-date-list">
                                {absenceDates.map(date => {
                                    const d = new Date(date + 'T00:00:00');
                                    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                    return (
                                        <div key={date} className="absence-date-item">
                                            <span>{date} ({dayNames[d.getDay()]})</span>
                                            <button onClick={() => handleRemoveAbsenceDate(date)} className="absence-remove-btn">X</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="absence-info-box">
                            <p>- 특이사항에 결석 날짜가 기록됩니다.</p>
                            <p>- 수업일에 해당하는 결석만큼 종료날짜가 연장됩니다.</p>
                        </div>

                        <div className="absence-modal-actions">
                            <button
                                className="absence-cancel-btn"
                                onClick={() => setAbsenceTarget(null)}
                                disabled={absenceProcessing}
                            >
                                취소
                            </button>
                            <button
                                className="absence-submit-btn"
                                onClick={handleSubmitAbsence}
                                disabled={absenceProcessing || absenceDates.length === 0}
                            >
                                {absenceProcessing ? '처리 중...' : `결석 처리 (${absenceDates.length}일)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showSmsModal && (
                <SmsSendModal
                    recipients={smsRecipients}
                    onClose={() => setShowSmsModal(false)}
                />
            )}

            {/* 홀딩 처리 모달 */}
            {holdingTarget && (
                <div className="absence-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setHoldingTarget(null); }}>
                    <div className="absence-modal-content">
                        <h2 className="absence-modal-title">홀딩 처리</h2>
                        <p className="absence-modal-student">{holdingTarget['이름']} ({holdingTarget['요일 및 시간'] || '-'})</p>
                        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
                            수강기간: {holdingTarget['시작날짜'] || '-'} ~ {holdingTarget['종료날짜'] || '-'}
                            {' | '}홀딩: {getStudentField(holdingTarget, '홀딩 사용여부') || 'X'}
                        </p>

                        {/* 기존 활성 홀딩 목록 */}
                        {existingHoldings.length > 0 && (
                            <div style={{ marginBottom: '16px' }}>
                                <p style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>활성 홀딩 목록</p>
                                {existingHoldings.map(h => (
                                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--accent-10)', borderRadius: '8px', border: '1px solid var(--accent-30)', marginBottom: '6px' }}>
                                        <div>
                                            <span style={{ fontSize: '14px', color: '#374151' }}>
                                                {h.startDate} ~ {h.endDate}
                                            </span>
                                            <span style={{ marginLeft: '8px', color: '#6b7280', fontSize: '12px' }}>
                                                ({h.dates ? h.dates.length : '?'}일)
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleCancelHolding(h)}
                                            disabled={holdingCancelling}
                                            style={{
                                                padding: '5px 12px',
                                                background: '#dc2626',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: holdingCancelling ? 'not-allowed' : 'pointer',
                                                fontSize: '13px',
                                                opacity: holdingCancelling ? 0.6 : 1
                                            }}
                                        >
                                            {holdingCancelling ? '처리 중...' : '취소'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 새 홀딩 추가 */}
                        <p style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>새 홀딩 추가</p>
                        <div className="absence-date-input-row">
                            <input
                                type="date"
                                value={holdingDateInput}
                                onChange={(e) => setHoldingDateInput(e.target.value)}
                                className="absence-date-input"
                            />
                            <button onClick={handleAddHoldingDate} className="absence-add-btn">
                                추가
                            </button>
                        </div>

                        {holdingDates.length > 0 && (
                            <div className="absence-date-list">
                                {holdingDates.map(date => {
                                    const d = new Date(date + 'T00:00:00');
                                    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                    return (
                                        <div key={date} className="absence-date-item">
                                            <span>{date} ({dayNames[d.getDay()]})</span>
                                            <button onClick={() => handleRemoveHoldingDate(date)} className="absence-remove-btn">X</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="absence-info-box">
                            <p>- Google Sheets + Firebase에 모두 기록됩니다.</p>
                            <p>- 홀딩 기간만큼 종료날짜가 자동 연장됩니다.</p>
                            <p>- 미리 등록이 있으면 시작일/종료일이 자동 조정됩니다.</p>
                        </div>

                        <div className="absence-modal-actions">
                            <button
                                className="absence-cancel-btn"
                                onClick={() => setHoldingTarget(null)}
                                disabled={holdingProcessing}
                            >
                                취소
                            </button>
                            <button
                                className="absence-submit-btn"
                                onClick={handleSubmitHolding}
                                disabled={holdingProcessing || holdingDates.length === 0}
                                style={{ background: 'var(--accent)' }}
                            >
                                {holdingProcessing ? '처리 중...' : `홀딩 처리 (${holdingDates.length}일)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentManager;
