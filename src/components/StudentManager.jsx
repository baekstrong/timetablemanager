import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField } from '../services/googleSheetsService';
import GoogleSheetsEmbed from './GoogleSheetsEmbed';
import './StudentManager.css';

const StudentManager = ({ onBack }) => {
    const {
        students,
        isConnected,
        updateStudent,
        loading,
        error
    } = useGoogleSheets();
    const [editingStudent, setEditingStudent] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [viewMode, setViewMode] = useState('table'); // 'table' or 'sheet'

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

    // End class (Clear schedule)
    const handleEndClass = async (student, index) => {
        if (!confirm(`${student['이름']} 수강생의 수강을 종료하시겠습니까?\n\n- 시간표에서 제거됩니다.\n- 이름, 결제 내역 등은 시트에 보존됩니다.\n- 시트의 '요일 및 시간' 칸만 지워집니다.`)) {
            return;
        }

        try {
            const updatedStudent = { ...student, '요일 및 시간': '' };
            // Use original row index
            await updateStudent(student._rowIndex, updatedStudent);
            alert('수강 종료 처리되었습니다.');
        } catch (err) {
            console.error('Failed to end class:', err);
            alert('수강 종료 처리에 실패했습니다.');
        }
    };

    // Handle form field changes
    const handleFieldChange = (field, value) => {
        setEditForm(prev => ({
            ...prev,
            [field]: value
        }));
    };

    // 시트 임베드 모드인 경우
    if (viewMode === 'sheet') {
        return <GoogleSheetsEmbed onBack={() => setViewMode('table')} />;
    }

    if (!isConnected) {
        return (
            <div className="student-manager-container">
                <div className="student-header">
                    <button onClick={onBack} className="back-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        뒤로가기
                    </button>
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
                <button onClick={onBack} className="back-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="student-title">수강생 관리</h1>
                <div className="header-actions">
                    <div className="info-message" style={{ fontSize: '0.9rem', color: '#666', marginRight: '1rem' }}>
                        📋 전체 시트 조회 중 (날짜 기반 자동 필터링)
                    </div>
                    <button onClick={() => setViewMode('sheet')} className="view-switch-btn">
                        📊 구글 시트로 보기
                    </button>
                    <div className="student-count">총 {students.length}명</div>
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
                                {students.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className="empty-message">
                                            등록된 수강생이 없습니다.
                                        </td>
                                    </tr>
                                ) : (
                                    students.map((student, index) => (
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
        </div>
    );
};

export default StudentManager;
