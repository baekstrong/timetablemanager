import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import './StudentManager.css';

const StudentManager = ({ onBack }) => {
    const { students, isConnected, updateStudent, loading, error } = useGoogleSheets();
    const [editingStudent, setEditingStudent] = useState(null);
    const [editForm, setEditForm] = useState({});

    // Start editing a student
    const handleEdit = (student, index) => {
        setEditingStudent(index);
        setEditForm({
            ...student,
            rowIndex: index
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

    // Handle form field changes
    const handleFieldChange = (field, value) => {
        setEditForm(prev => ({
            ...prev,
            [field]: value
        }));
    };

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
                <div className="student-count">총 {students.length}명</div>
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
                                                        value={editForm['홀딩 사용여부'] || 'X'}
                                                        onChange={(e) => handleFieldChange('홀딩 사용여부', e.target.value)}
                                                        className="edit-select"
                                                    >
                                                        <option value="O">O</option>
                                                        <option value="X">X</option>
                                                    </select>
                                                ) : (
                                                    <span className={`holding-status ${student['홀딩 사용여부'] === 'O' ? 'active' : 'inactive'}`}>
                                                        {student['홀딩 사용여부'] || 'X'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* 홀딩 시작일 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="date"
                                                        value={editForm['홀딩 시작일'] || ''}
                                                        onChange={(e) => handleFieldChange('홀딩 시작일', e.target.value)}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    student['홀딩 시작일'] || '-'
                                                )}
                                            </td>

                                            {/* 홀딩 종료일 */}
                                            <td>
                                                {editingStudent === index ? (
                                                    <input
                                                        type="date"
                                                        value={editForm['홀딩 종료일'] || ''}
                                                        onChange={(e) => handleFieldChange('홀딩 종료일', e.target.value)}
                                                        className="edit-input"
                                                    />
                                                ) : (
                                                    student['홀딩 종료일'] || '-'
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
                                                    <button onClick={() => handleEdit(student, index)} className="edit-btn">
                                                        수정
                                                    </button>
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
