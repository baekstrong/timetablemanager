import { useState, useEffect } from 'react';
import { getPendingContractForStudent, agreeToContract } from '../services/firebaseService';
import { readSheetData, writeSheetData, formatCellsWithStyle } from '../services/googleSheetsService';
import { CONTRACT_TITLE, TRAINING_RULES, GUARANTEES, RISK_NOTICE } from '../data/contractTerms';
import './ContractView.css';

// YYMMDD → YYYY-MM-DD 표시용
const formatYYMMDD = (yymmdd) => {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd || '';
    const yy = yymmdd.slice(0, 2);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
};

const ContractView = ({ user, onBack }) => {
    const [contract, setContract] = useState(null);
    const [loading, setLoading] = useState(true);
    const [agreed, setAgreed] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const loadContract = async () => {
            try {
                const c = await getPendingContractForStudent(user.username);
                setContract(c);
            } catch (err) {
                console.error('계약서 로드 실패:', err);
            }
            setLoading(false);
        };
        loadContract();
    }, [user.username]);

    const handleAgree = async () => {
        if (!agreed) {
            alert('약관에 동의해주세요.');
            return;
        }
        if (!contract) return;

        setSubmitting(true);
        try {
            const { registrationData, targetSheet } = contract;

            // 1. 시트 데이터 읽기 → 다음 행/번호 계산
            const rows = await readSheetData(`${targetSheet}!A:R`);
            let lastDataRowIndex = 1;
            for (let i = rows.length - 1; i >= 2; i--) {
                if (rows[i] && rows[i][1]) {
                    lastDataRowIndex = i;
                    break;
                }
            }
            const nextSheetRow = lastDataRowIndex + 1 + 1;

            let maxNumber = 0;
            for (let i = 2; i < rows.length; i++) {
                if (rows[i] && rows[i][0]) {
                    const num = parseInt(rows[i][0]);
                    if (!isNaN(num) && num > maxNumber) maxNumber = num;
                }
            }
            const newNumber = maxNumber + 1;

            // 2. 행 데이터 구성
            const rowData = [
                newNumber,                              // A: 번호
                registrationData.이름,                  // B: 이름
                registrationData.주횟수,                // C: 주횟수
                registrationData['요일 및 시간'],       // D: 요일 및 시간
                registrationData.특이사항,              // E: 특이사항
                '재등록',                               // F: 신규/재등록
                registrationData.시작날짜,              // G: 시작날짜
                registrationData.종료날짜,              // H: 종료날짜
                registrationData.결제금액,              // I: 결제금액
                registrationData.결제일,                // J: 결제일
                registrationData.결제유무,              // K: 결제유무
                registrationData.결제방식,              // L: 결제방식
                registrationData['홀딩 사용여부'],      // M: 홀딩 사용여부
                '',                                     // N: 홀딩 시작일
                '',                                     // O: 홀딩 종료일
                registrationData.핸드폰,                // P: 핸드폰
                registrationData.성별,                  // Q: 성별
                registrationData.직업                   // R: 직업
            ];

            // 3. 시트에 쓰기
            await writeSheetData(`${targetSheet}!A${nextSheetRow}:R${nextSheetRow}`, [rowData]);

            // 4. 서식 적용 (주황색 + 미결제 빨간색)
            try {
                const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                const cellRanges = columns.map(col => `${col}${nextSheetRow}`);
                await formatCellsWithStyle(cellRanges, targetSheet, { red: 1.0, green: 0.87, blue: 0.68 });

                const paymentEmpty = [];
                if (!registrationData.결제일) paymentEmpty.push(`J${nextSheetRow}`);
                if (!registrationData.결제유무) paymentEmpty.push(`K${nextSheetRow}`);
                if (!registrationData.결제방식) paymentEmpty.push(`L${nextSheetRow}`);
                if (paymentEmpty.length > 0) {
                    await formatCellsWithStyle(paymentEmpty, targetSheet, { red: 0.92, green: 0.36, blue: 0.36 });
                }
            } catch (err) {
                console.warn('서식 적용 실패:', err);
            }

            // 5. Firebase 상태 업데이트
            await agreeToContract(contract.id);

            alert('계약에 동의하였습니다. 등록이 완료되었습니다.');
            onBack();
        } catch (err) {
            console.error('계약 동의 처리 실패:', err);
            alert('처리 중 오류가 발생했습니다: ' + err.message);
        }
        setSubmitting(false);
    };

    if (loading) {
        return (
            <div className="contract-view-container">
                <div className="contract-loading">계약서를 불러오는 중...</div>
            </div>
        );
    }

    if (!contract) {
        return (
            <div className="contract-view-container">
                <div className="contract-header">
                    <button onClick={onBack} className="contract-back-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        뒤로가기
                    </button>
                </div>
                <div className="contract-empty">대기 중인 계약서가 없습니다.</div>
            </div>
        );
    }

    const rd = contract.registrationData;

    return (
        <div className="contract-view-container">
            <div className="contract-header">
                <button onClick={onBack} className="contract-back-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    뒤로가기
                </button>
                <h1 className="contract-title">{CONTRACT_TITLE}</h1>
            </div>

            <div className="contract-content">
                {/* 등록 정보 카드 */}
                <div className="contract-info-card">
                    <h2 className="contract-section-title">등록 정보</h2>
                    <div className="contract-info-grid">
                        <div className="contract-info-row">
                            <span className="contract-info-label">이름</span>
                            <span className="contract-info-value">{rd.이름}</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">주횟수</span>
                            <span className="contract-info-value">주 {rd.주횟수}회</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">요일/시간</span>
                            <span className="contract-info-value">{rd['요일 및 시간']}</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">등록기간</span>
                            <span className="contract-info-value">{rd.등록개월수 || '1'}개월</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">시작일</span>
                            <span className="contract-info-value">{formatYYMMDD(rd.시작날짜)}</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">종료일</span>
                            <span className="contract-info-value">{formatYYMMDD(rd.종료날짜)}</span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">결제금액</span>
                            <span className="contract-info-value">
                                {rd.결제금액 ? `${rd.결제금액}만원` : '-'}
                            </span>
                        </div>
                        <div className="contract-info-row">
                            <span className="contract-info-label">결제방식</span>
                            <span className="contract-info-value">{rd.결제방식 || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* 수강 규정 */}
                <div className="contract-terms-card">
                    <h2 className="contract-section-title">수강 규정</h2>
                    <ol className="contract-terms-list">
                        {TRAINING_RULES.map((rule, i) => (
                            <li key={i}>{rule}</li>
                        ))}
                    </ol>
                </div>

                {/* 보증/승인 사항 */}
                <div className="contract-terms-card">
                    <h2 className="contract-section-title">보증 및 승인 사항</h2>
                    <ol className="contract-terms-list">
                        {GUARANTEES.map((item, i) => (
                            <li key={i}>{item}</li>
                        ))}
                    </ol>
                </div>

                {/* 위험 고지 */}
                <div className="contract-terms-card risk">
                    <h2 className="contract-section-title">위험에 대한 고지</h2>
                    <p className="contract-risk-text">{RISK_NOTICE}</p>
                </div>

                {/* 동의 체크박스 */}
                <div className="contract-agree-section">
                    <label className="contract-agree-label">
                        <input
                            type="checkbox"
                            checked={agreed}
                            onChange={(e) => setAgreed(e.target.checked)}
                        />
                        <span>위 약관을 모두 읽었으며 동의합니다</span>
                    </label>
                    <button
                        className="contract-agree-btn"
                        onClick={handleAgree}
                        disabled={!agreed || submitting}
                    >
                        {submitting ? '처리 중...' : '동의합니다'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ContractView;
