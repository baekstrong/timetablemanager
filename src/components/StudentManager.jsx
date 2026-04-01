import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField, clearStudentScheduleAllSheets, parseSheetDate, processStudentAbsence, processCoachHolding } from '../services/googleSheetsService';
import { getHolidays, createHoldingRequest } from '../services/firebaseService';
import GoogleSheetsEmbed from './GoogleSheetsEmbed';
import StudentRegistrationModal from './StudentRegistrationModal';
import ContractHistory from './ContractHistory';
import './StudentManager.css';

const StudentManager = ({ onBack }) => {
    const {
        students,
        isConnected,
        updateStudent,
        loading,
        error,
        refresh
    } = useGoogleSheets();
    const [editingStudent, setEditingStudent] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [viewMode, setViewMode] = useState('table'); // 'table' or 'sheet'
    const [showRegistrationModal, setShowRegistrationModal] = useState(false);
    const [renewalStudentName, setRenewalStudentName] = useState(null);
    const [absenceTarget, setAbsenceTarget] = useState(null); // 결석 대상 수강생
    const [absenceDates, setAbsenceDates] = useState([]); // 결석 날짜 목록
    const [absenceDateInput, setAbsenceDateInput] = useState(''); // 날짜 입력
    const [absenceProcessing, setAbsenceProcessing] = useState(false);
    const [holidays, setHolidays] = useState([]);
    const [contractHistoryTarget, setContractHistoryTarget] = useState(null);
    const [holdingTarget, setHoldingTarget] = useState(null); // 홀딩 대상 수강생
    const [holdingDates, setHoldingDates] = useState([]); // 홀딩 날짜 목록
    const [holdingDateInput, setHoldingDateInput] = useState(''); // 날짜 입력
    const [holdingProcessing, setHoldingProcessing] = useState(false);

    // 공휴일 로드
    useEffect(() => {
        getHolidays().then(setHolidays).catch(err => console.error('공휴일 로드 실패:', err));
    }, []);

    // 시간표 배너에서 재등록 모달 자동 열기
    useEffect(() => {
        const name = sessionStorage.getItem('renewalStudentName');
        if (name) {
            sessionStorage.removeItem('renewalStudentName');
            setRenewalStudentName(name);
            setShowRegistrationModal(true);
        }
    }, []);

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
    const handleEndClass = async (student, index) => {
        if (!confirm(`${student['이름']} 수강생의 수강을 종료하시겠습니까?\n\n- 시간표에서 제거됩니다.\n- 이름, 결제 내역 등은 시트에 보존됩니다.\n- 모든 시트의 '요일 및 시간' 칸이 지워집니다.`)) {
            return;
        }

        try {
            // 모든 시트에서 해당 학생의 스케줄 삭제
            await clearStudentScheduleAllSheets(student['이름']);
            alert('수강 종료 처리되었습니다. (모든 시트에서 스케줄 삭제)');
        } catch (err) {
            console.error('Failed to end class:', err);
            alert('수강 종료 처리에 실패했습니다.');
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
                holidays
            );
            alert(`✅ 결석 처리 완료!\n\n수업일 결석: ${result.validAbsenceCount}일\n새 종료날짜: ${result.newEndDate}\n특이사항: ${result.notesText}`);
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
    const handleOpenHolding = (student) => {
        setHoldingTarget(student);
        setHoldingDates([]);
        setHoldingDateInput('');
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
                holidays
            );

            alert(`홀딩 처리 완료!\n\n홀딩 기간: ${startDate} ~ ${endDate}\n새 종료날짜: ${result.newEndDate}\n홀딩 상태: ${result.holdingStatus}`);
            setHoldingTarget(null);
            setHoldingDates([]);
            if (refresh) refresh();
        } catch (err) {
            console.error('홀딩 처리 실패:', err);
            alert('홀딩 처리에 실패했습니다: ' + err.message);
        }
        setHoldingProcessing(false);
    };

    // 종료날짜가 지난 수강생 필터링 (활성 수강생만 표시)
    const activeStudents = students.filter(student => {
        const endDateStr = student['종료날짜'];
        if (!endDateStr) return true; // 종료날짜 없으면 표시
        const endDate = parseSheetDate(endDateStr);
        if (!endDate) return true; // 파싱 실패 시 표시
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return endDate >= today; // 오늘이 종료일이면 아직 표시
    });

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
            <div className="student-header">
                <h1 className="student-title">수강생 관리</h1>
            </div>
            <div className="student-header-actions-mobile">
                <div className="info-message-mobile">
                    📋 활성 수강생만 조회 중 (종료일 기준 필터링)
                </div>
                <div className="header-buttons-row">
                    <button onClick={() => setShowRegistrationModal(true)} className="register-btn">
                        + 수강생 등록
                    </button>
                    <button onClick={() => setViewMode('sheet')} className="view-switch-btn">
                        📊 구글 시트로 보기
                    </button>
                    <div className="student-count">총 {activeStudents.length}명</div>
                </div>
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
                                {activeStudents.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className="empty-message">
                                            등록된 수강생이 없습니다.
                                        </td>
                                    </tr>
                                ) : (
                                    activeStudents.map((student, index) => (
                                        <tr key={index} className={editingStudent === index ? 'editing' : ''}>
                                            <td className="student-name">{student['이름'] || '-'}</td>

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
                                            <td>{student['종료날짜'] || '-'}</td>

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
                                                        <button onClick={() => handleEndClass(student, index)} className="end-class-btn" title="수강 종료 (시간표에서 제거)">
                                                            종료
                                                        </button>
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
                                style={{ background: '#667eea' }}
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
