import { useState, useEffect } from 'react';
import {
    getAllSheetNames,
    getCurrentSheetName,
    findStudentAcrossSheets,
    getStudentField,
    readSheetData,
    writeSheetData,
    calculateEndDateWithHolidays,
    formatCellsWithStyle
} from '../services/googleSheetsService';
import { getHolidays } from '../services/firebaseService';
import './StudentRegistrationModal.css';

// YYYY-MM-DD → YYMMDD
const convertToYYMMDD = (dateStr) => {
    if (!dateStr) return '';
    return dateStr.slice(2).replace(/-/g, '');
};

// Date → YYMMDD
const formatYYMMDD = (date) => {
    const year = String(date.getFullYear()).slice(2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

// 오늘 → YYYY-MM-DD
const formatToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const StudentRegistrationModal = ({ onClose, onSuccess }) => {
    const [registrationType, setRegistrationType] = useState('new');
    const [targetSheet, setTargetSheet] = useState('');
    const [availableSheets, setAvailableSheets] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);

    const [absenceDates, setAbsenceDates] = useState([]);
    const [absenceDateInput, setAbsenceDateInput] = useState('');

    const [form, setForm] = useState({
        이름: '',
        주횟수: '',
        등록개월수: '1',
        '요일 및 시간': '',
        특이사항: '',
        시작날짜: '',
        종료날짜: '',
        결제금액: '',
        결제일: formatToday(),
        결제유무: '',
        결제방식: '',
        '홀딩 사용여부': 'X',
        핸드폰: '',
        성별: '',
        직업: ''
    });

    // 시트 목록 & 공휴일 로드
    useEffect(() => {
        getAllSheetNames().then(sheets => {
            const filtered = sheets.filter(s => s.includes('등록생 목록'));
            setAvailableSheets(filtered);
            setTargetSheet(getCurrentSheetName());
        }).catch(err => console.error('시트 목록 로드 실패:', err));

        getHolidays().then(setHolidays).catch(err => console.error('공휴일 로드 실패:', err));
    }, []);

    // 종료날짜 자동 계산 (결석일 반영)
    useEffect(() => {
        if (!form.시작날짜 || !form.주횟수 || !form['요일 및 시간']) {
            setForm(prev => ({ ...prev, 종료날짜: '' }));
            return;
        }
        const startDate = new Date(form.시작날짜 + 'T00:00:00');
        const weeklyFreq = parseInt(form.주횟수);
        if (isNaN(weeklyFreq) || weeklyFreq <= 0) return;

        const registrationMonths = parseInt(form.등록개월수 || '1');
        const totalSessions = weeklyFreq * 4 * registrationMonths;
        const endDate = calculateEndDateWithHolidays(
            startDate, totalSessions, form['요일 및 시간'], holidays, absenceDates
        );
        if (endDate) {
            setForm(prev => ({ ...prev, 종료날짜: formatYYMMDD(endDate) }));
        }
    }, [form.시작날짜, form.주횟수, form.등록개월수, form['요일 및 시간'], holidays, absenceDates]);

    const handleChange = (field, value) => {
        setForm(prev => {
            const updated = { ...prev, [field]: value };
            // 등록개월수 변경 시 홀딩 사용여부 자동 설정 (재등록 모드에서만)
            if (field === '등록개월수' && registrationType === 'renew') {
                const months = parseInt(value || '1');
                updated['홀딩 사용여부'] = months > 1 ? `X(0/${months})` : 'X';
            }
            return updated;
        });
    };

    // 재등록 모드: 이름 검색
    const handleSearchStudent = async () => {
        if (!form.이름.trim()) {
            alert('이름을 입력해주세요.');
            return;
        }
        setSearchLoading(true);
        try {
            const result = await findStudentAcrossSheets(form.이름.trim());
            if (result) {
                setForm(prev => ({
                    ...prev,
                    주횟수: result.student['주횟수'] || getStudentField(result.student, '주횟수') || '',
                    '요일 및 시간': result.student['요일 및 시간'] || getStudentField(result.student, '요일 및 시간') || '',
                    특이사항: result.student['특이사항'] || getStudentField(result.student, '특이사항') || '',
                    핸드폰: getStudentField(result.student, '핸드폰') || '',
                    성별: getStudentField(result.student, '성별') || '',
                    직업: getStudentField(result.student, '직업') || '',
                    '홀딩 사용여부': 'X',
                    결제금액: getStudentField(result.student, '결제금액') || '',
                }));
                alert(`${result.foundSheetName}에서 정보를 불러왔습니다.`);
            } else {
                alert('수강생을 찾을 수 없습니다.');
            }
        } catch (err) {
            console.error('검색 실패:', err);
            alert('검색 중 오류가 발생했습니다.');
        }
        setSearchLoading(false);
    };

    // 제출
    const handleSubmit = async () => {
        if (!form.이름 || !form.주횟수 || !form['요일 및 시간'] || !form.시작날짜 || !targetSheet) {
            alert('필수 항목을 모두 입력해주세요.\n(이름, 주횟수, 요일 및 시간, 시작날짜, 대상 시트)');
            return;
        }

        setSubmitting(true);
        try {
            const startDateYYMMDD = convertToYYMMDD(form.시작날짜);
            const 결제일YYMMDD = form.결제일 ? convertToYYMMDD(form.결제일) : '';

            // 시트를 읽어서 마지막 데이터 행 찾기 (B열=이름 기준)
            const rows = await readSheetData(`${targetSheet}!A:R`);
            let lastDataRowIndex = 1; // 기본값: 헤더행 (index 1 = sheet row 2)
            for (let i = rows.length - 1; i >= 2; i--) {
                if (rows[i] && rows[i][1]) { // index 1 = B열 (이름)
                    lastDataRowIndex = i;
                    break;
                }
            }
            const nextSheetRow = lastDataRowIndex + 1 + 1; // array→sheet 변환(+1) + 다음 행(+1)

            // A열에서 가장 큰 번호 찾기
            let maxNumber = 0;
            for (let i = 2; i < rows.length; i++) {
                if (rows[i] && rows[i][0]) {
                    const num = parseInt(rows[i][0]);
                    if (!isNaN(num) && num > maxNumber) {
                        maxNumber = num;
                    }
                }
            }
            const newNumber = maxNumber + 1;

            // 결석 날짜가 있으면 특이사항에 추가
            let finalNotes = form.특이사항;
            if (absenceDates.length > 0) {
                const absenceTexts = absenceDates.map(dateStr => {
                    const d = new Date(dateStr + 'T00:00:00');
                    const yy = String(d.getFullYear()).slice(2);
                    const m = d.getMonth() + 1;
                    const day = d.getDate();
                    return `${yy}.${m}.${day}`;
                });
                const absenceNote = `${absenceTexts.join(', ')} 결석`;
                finalNotes = finalNotes ? `${finalNotes}, ${absenceNote}` : absenceNote;
            }

            const rowData = [
                newNumber,                                                       // A: 번호 (자동 부여)
                form.이름,                                                   // B: 이름
                form.주횟수,                                                 // C: 주횟수
                form['요일 및 시간'],                                        // D: 요일 및 시간
                finalNotes,                                                  // E: 특이사항 (결석 포함)
                registrationType === 'new' ? '신규' : '재등록',              // F: 신규/재등록
                startDateYYMMDD,                                             // G: 시작날짜
                form.종료날짜,                                               // H: 종료날짜
                form.결제금액,                                               // I: 결제금액
                결제일YYMMDD,                                                // J: 결제일
                form.결제유무,                                               // K: 결제유무
                form.결제방식,                                               // L: 결제방식
                form['홀딩 사용여부'],                                       // M: 홀딩 사용여부
                '',                                                          // N: 홀딩 시작일
                '',                                                          // O: 홀딩 종료일
                form.핸드폰,                                                 // P: 핸드폰
                form.성별,                                                   // Q: 성별
                form.직업                                                    // R: 직업
            ];

            await writeSheetData(`${targetSheet}!A${nextSheetRow}:R${nextSheetRow}`, [rowData]);

            // 흰색 배경 + 가운데 정렬 적용
            try {
                const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                const cellRanges = columns.map(col => `${col}${nextSheetRow}`);
                await formatCellsWithStyle(cellRanges, targetSheet, { red: 1.0, green: 1.0, blue: 1.0 });
            } catch (err) {
                console.warn('서식 적용 실패:', err);
            }

            alert('수강생이 등록되었습니다.');
            onSuccess();
        } catch (err) {
            console.error('등록 실패:', err);
            alert('등록에 실패했습니다: ' + err.message);
        }
        setSubmitting(false);
    };

    return (
        <div className="reg-modal-overlay">
            <div className="reg-modal-content">
                <h2 className="reg-modal-title">수강생 등록</h2>

                {/* 탭 토글 */}
                <div className="reg-tab-toggle">
                    <button
                        className={`reg-tab-btn ${registrationType === 'new' ? 'active' : ''}`}
                        onClick={() => setRegistrationType('new')}
                    >
                        신규
                    </button>
                    <button
                        className={`reg-tab-btn ${registrationType === 'renew' ? 'active' : ''}`}
                        onClick={() => setRegistrationType('renew')}
                    >
                        재등록
                    </button>
                </div>

                {/* 대상 시트 선택 */}
                <div className="reg-field-group">
                    <label>대상 시트 *</label>
                    <select value={targetSheet} onChange={(e) => setTargetSheet(e.target.value)}>
                        <option value="">시트를 선택하세요</option>
                        {availableSheets.map(sheet => (
                            <option key={sheet} value={sheet}>{sheet}</option>
                        ))}
                    </select>
                </div>

                <hr className="reg-section-divider" />

                {/* 재등록 모드: 이름 검색 */}
                {registrationType === 'renew' && (
                    <div className="reg-search-row">
                        <input
                            type="text"
                            placeholder="수강생 이름 입력"
                            value={form.이름}
                            onChange={(e) => handleChange('이름', e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !searchLoading) handleSearchStudent(); }}
                        />
                        <button
                            className="reg-search-btn"
                            onClick={handleSearchStudent}
                            disabled={searchLoading}
                        >
                            {searchLoading ? '검색 중...' : '검색'}
                        </button>
                    </div>
                )}

                {/* 이름 (신규 모드) */}
                {registrationType === 'new' && (
                    <div className="reg-field-group">
                        <label>이름 *</label>
                        <input
                            type="text"
                            value={form.이름}
                            onChange={(e) => handleChange('이름', e.target.value)}
                            placeholder="수강생 이름"
                        />
                    </div>
                )}

                {/* 등록개월수 (재등록 모드에서만 표시) */}
                {registrationType === 'renew' && (
                    <div className="reg-field-group">
                        <label>등록개월수</label>
                        <select
                            value={form.등록개월수}
                            onChange={(e) => handleChange('등록개월수', e.target.value)}
                        >
                            <option value="1">1개월</option>
                            <option value="2">2개월</option>
                            <option value="3">3개월</option>
                        </select>
                        {parseInt(form.등록개월수) > 1 && (
                            <div className="field-hint">
                                홀딩 사용여부: {form['홀딩 사용여부']}
                            </div>
                        )}
                    </div>
                )}

                {/* 주횟수 / 요일 및 시간 */}
                <div className="reg-field-row">
                    <div className="reg-field-group">
                        <label>주횟수 *</label>
                        <input
                            type="number"
                            min="1"
                            max="7"
                            value={form.주횟수}
                            onChange={(e) => handleChange('주횟수', e.target.value)}
                            placeholder="예: 2"
                        />
                    </div>
                    <div className="reg-field-group">
                        <label>요일 및 시간 *</label>
                        <input
                            type="text"
                            value={form['요일 및 시간']}
                            onChange={(e) => handleChange('요일 및 시간', e.target.value)}
                            placeholder="예: 월1수1"
                        />
                        <div className="field-hint">요일+교시 (월~금, 1~6교시)</div>
                    </div>
                </div>

                {/* 특이사항 */}
                <div className="reg-field-group">
                    <label>특이사항</label>
                    <textarea
                        value={form.특이사항}
                        onChange={(e) => handleChange('특이사항', e.target.value)}
                        placeholder="특이사항 입력 (선택)"
                    />
                </div>

                {/* 결석 날짜 입력 */}
                <div className="reg-field-group">
                    <label>결석 날짜 (선택)</label>
                    <div className="reg-absence-input-row">
                        <input
                            type="date"
                            value={absenceDateInput}
                            onChange={(e) => setAbsenceDateInput(e.target.value)}
                        />
                        <button
                            type="button"
                            className="reg-absence-add-btn"
                            onClick={() => {
                                if (!absenceDateInput) return;
                                if (absenceDates.includes(absenceDateInput)) {
                                    alert('이미 추가된 날짜입니다.');
                                    return;
                                }
                                setAbsenceDates(prev => [...prev, absenceDateInput].sort());
                                setAbsenceDateInput('');
                            }}
                        >
                            추가
                        </button>
                    </div>
                    {absenceDates.length > 0 && (
                        <div className="reg-absence-list">
                            {absenceDates.map(date => {
                                const d = new Date(date + 'T00:00:00');
                                const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                return (
                                    <span key={date} className="reg-absence-tag">
                                        {date} ({dayNames[d.getDay()]})
                                        <button
                                            type="button"
                                            onClick={() => setAbsenceDates(prev => prev.filter(x => x !== date))}
                                        >
                                            X
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                    <div className="field-hint">수업일에 해당하는 결석만큼 종료날짜가 자동 연장됩니다.</div>
                </div>

                {/* 시작날짜 / 종료날짜 */}
                <div className="reg-field-row">
                    <div className="reg-field-group">
                        <label>시작날짜 *</label>
                        <input
                            type="date"
                            value={form.시작날짜}
                            onChange={(e) => handleChange('시작날짜', e.target.value)}
                        />
                    </div>
                    <div className="reg-field-group">
                        <label>종료날짜 (자동계산)</label>
                        <div className={`reg-end-date-display ${form.종료날짜 ? '' : 'empty'}`}>
                            {form.종료날짜 || '시작날짜, 주횟수, 요일을 입력하세요'}
                        </div>
                    </div>
                </div>

                <hr className="reg-section-divider" />

                {/* 결제 정보 */}
                <div className="reg-field-row-3">
                    <div className="reg-field-group">
                        <label>결제금액</label>
                        <input
                            type="text"
                            value={form.결제금액}
                            onChange={(e) => handleChange('결제금액', e.target.value)}
                            placeholder="예: 300000"
                        />
                    </div>
                    <div className="reg-field-group">
                        <label>결제유무</label>
                        <select value={form.결제유무} onChange={(e) => handleChange('결제유무', e.target.value)}>
                            <option value="">선택</option>
                            <option value="O">O</option>
                            <option value="X">X</option>
                        </select>
                    </div>
                    <div className="reg-field-group">
                        <label>결제방식</label>
                        <select value={form.결제방식} onChange={(e) => handleChange('결제방식', e.target.value)}>
                            <option value="">선택</option>
                            <option value="카드">카드</option>
                            <option value="계좌">계좌</option>
                            <option value="제로페이">제로페이</option>
                            <option value="네이버">네이버</option>
                        </select>
                    </div>
                </div>

                {/* 결제일 */}
                <div className="reg-field-group">
                    <label>결제일</label>
                    <div className="reg-date-wrapper">
                        <input
                            type="date"
                            value={form.결제일}
                            onChange={(e) => handleChange('결제일', e.target.value)}
                        />
                        <button
                            type="button"
                            className="reg-date-clear-btn"
                            onClick={() => handleChange('결제일', '')}
                        >
                            X
                        </button>
                    </div>
                </div>

                {/* 신규 모드에서만 추가 개인정보 */}
                {registrationType === 'new' && (
                    <>
                        <hr className="reg-section-divider" />
                        <div className="reg-field-row-3">
                            <div className="reg-field-group">
                                <label>핸드폰</label>
                                <input
                                    type="tel"
                                    value={form.핸드폰}
                                    onChange={(e) => handleChange('핸드폰', e.target.value)}
                                    placeholder="010-0000-0000"
                                />
                            </div>
                            <div className="reg-field-group">
                                <label>성별</label>
                                <select value={form.성별} onChange={(e) => handleChange('성별', e.target.value)}>
                                    <option value="">선택</option>
                                    <option value="남">남</option>
                                    <option value="여">여</option>
                                </select>
                            </div>
                            <div className="reg-field-group">
                                <label>직업</label>
                                <input
                                    type="text"
                                    value={form.직업}
                                    onChange={(e) => handleChange('직업', e.target.value)}
                                    placeholder="직업"
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* 버튼 */}
                <div className="reg-modal-actions">
                    <button className="reg-cancel-btn" onClick={onClose} disabled={submitting}>
                        취소
                    </button>
                    <button className="reg-submit-btn" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? '등록 중...' : '등록'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StudentRegistrationModal;
