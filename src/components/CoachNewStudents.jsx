import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
    getNewStudentRegistrations,
    updateNewStudentRegistration,
    deleteNewStudentRegistration,
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
    formatCellsWithStyle
} from '../services/googleSheetsService';
import { sendApprovalNotifications, sendWaitlistAvailableSMS } from '../services/smsService';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { formatEntranceDate, convertToYYMMDD, calculateStartEndDates } from '../utils/dateUtils';
import { PRICING, PERIODS, MAX_CAPACITY } from '../data/mockData';
import './CoachNewStudents.css';

const CoachNewStudents = ({ user, onBack }) => {
    const { refresh: refreshSheets } = useGoogleSheets();
    const [activeTab, setActiveTab] = useState('registrations');
    const [loading, setLoading] = useState(false);

    // === 등록 목록 ===
    const [registrations, setRegistrations] = useState([]);
    const [regFilter, setRegFilter] = useState('pending');
    const [collapsedRegs, setCollapsedRegs] = useState(new Set());
    const [approving, setApproving] = useState(null);
    const [regCounts, setRegCounts] = useState({});
    const [waitlistApproveReg, setWaitlistApproveReg] = useState(null);
    const [waitlistEntranceId, setWaitlistEntranceId] = useState('');

    // === 입학반 관리 ===
    const [entranceClasses, setEntranceClassesList] = useState([]);
    const [entranceRegs, setEntranceRegs] = useState([]);
    const [showEntranceForm, setShowEntranceForm] = useState(false);
    const [editingEntrance, setEditingEntrance] = useState(null);
    const [entranceForm, setEntranceForm] = useState({ date: '', time: '', description: '', maxCapacity: 6 });

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
    const loadRegCounts = async () => {
        try {
            const all = await getNewStudentRegistrations(null);
            const counts = {};
            all.forEach(r => {
                counts[r.status] = (counts[r.status] || 0) + 1;
            });
            setRegCounts(counts);
        } catch (err) {
            console.error('등록 건수 조회 실패:', err);
        }
    };

    const loadRegistrations = async () => {
        setLoading(true);
        try {
            const data = await getNewStudentRegistrations(regFilter || null);
            setRegistrations(data);
        } catch (err) {
            console.error('등록 목록 조회 실패:', err);
        }
        setLoading(false);
        loadRegCounts();
    };

    const loadEntranceClasses = async () => {
        setLoading(true);
        try {
            const [data, regs] = await Promise.all([
                getEntranceClasses(false),
                getNewStudentRegistrations(null)
            ]);

            // 날짜가 지난 입학반 자동 완료 처리 (isActive → false)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const expiredClasses = data.filter(ec => {
                if (!ec.isActive || !ec.date) return false;
                const ecDate = new Date(ec.date + 'T23:59:59');
                return ecDate < today;
            });
            if (expiredClasses.length > 0) {
                await Promise.all(
                    expiredClasses.map(ec => updateEntranceClass(ec.id, { isActive: false }))
                );
                // 로컬 데이터에도 반영
                expiredClasses.forEach(ec => { ec.isActive = false; });
                console.log(`✅ ${expiredClasses.length}개 입학반 자동 완료 처리`);
            }

            setEntranceClassesList(data);
            setEntranceRegs(regs.filter(r => r.entranceClassId && r.status !== 'rejected'));
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

            // 시간표 슬롯 만석 체크
            if (reg.requestedSlots && reg.requestedSlots.length > 0) {
                const slotCounts = {};
                for (let i = 2; i < rows.length; i++) {
                    const schedule = rows[i] && rows[i][3]; // D열: 요일 및 시간
                    if (!schedule) continue;
                    const matches = schedule.match(/([월화수목금])(\d)/g);
                    if (matches) {
                        matches.forEach(m => {
                            const key = `${m[0]}-${m[1]}`;
                            slotCounts[key] = (slotCounts[key] || 0) + 1;
                        });
                    }
                }
                const fullSlots = reg.requestedSlots.filter(s => {
                    const key = `${s.day}-${s.period}`;
                    return (slotCounts[key] || 0) >= MAX_CAPACITY;
                });
                if (fullSlots.length > 0) {
                    const fullNames = fullSlots.map(s => {
                        const p = PERIODS.find(p => p.id === s.period);
                        return `${s.day}요일 ${p ? p.name : s.period + '교시'}`;
                    }).join(', ');
                    alert(`만석입니다: ${fullNames}\n\n해당 시간에 빈 자리가 없어 승인할 수 없습니다.`);
                    setApproving(null);
                    return;
                }
            }

            let lastDataRowIndex = 1;
            for (let i = rows.length - 1; i >= 2; i--) {
                if (rows[i] && rows[i][1]) {
                    lastDataRowIndex = i;
                    break;
                }
            }
            const nextSheetRow = lastDataRowIndex + 1 + 1;

            // A열에서 가장 큰 번호 찾기 → 자동 부여
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
                newNumber,                                  // A: 번호 (자동 부여)
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
                reg.paymentMethod === 'naver' ? '네이버' : reg.paymentMethod === 'card' ? '카드' : reg.paymentMethod === 'zeropay' ? '제로페이' : '계좌', // L: 결제방식
                'X',                                     // M: 홀딩
                '',                                      // N: 홀딩 시작일
                '',                                      // O: 홀딩 종료일
                reg.phone,                               // P: 핸드폰
                reg.gender || '',                        // Q: 성별
                reg.occupation || ''                     // R: 직업
            ];

            await writeSheetData(`${targetSheet}!A${nextSheetRow}:R${nextSheetRow}`, [rowData]);

            // 2-1. 주황색 음영 + 가운데 정렬 적용 (신규 수강생 표시)
            try {
                const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                const cellRanges = columns.map(col => `${col}${nextSheetRow}`);
                await formatCellsWithStyle(cellRanges, targetSheet, { red: 1.0, green: 0.87, blue: 0.68 });
            } catch (err) {
                console.warn('서식 적용 실패:', err);
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

            // 승인 문자 발송 (수강생 SMS 2 + 입학반 리마인더 SMS 3 예약)
            // 실패해도 승인에 영향을 주지 않음
            let smsWarning = '';
            if (reg.phone) {
                try {
                    const smsResults = await sendApprovalNotifications(reg.phone, reg.name, {
                        paymentMethod: reg.paymentMethod,
                        weeklyFrequency: reg.weeklyFrequency,
                        entranceDate: reg.entranceDate,
                        entranceClassDate: reg.entranceClassDate
                    });
                    const sent = [];
                    const failed = [];
                    if (smsResults.approvalSMS) sent.push('승인 문자');
                    else failed.push('승인 문자');
                    if (smsResults.reminderSMS) sent.push('입학반 리마인더');
                    if (sent.length > 0) {
                        console.log(`문자 발송 완료: ${sent.join(', ')}`);
                    }
                    if (failed.length > 0) {
                        smsWarning = `\n\n⚠ ${failed.join(', ')} 발송에 실패했습니다. SMS 설정을 확인해주세요.`;
                        console.warn('문자 발송 실패:', failed.join(', '));
                    }
                } catch (smsError) {
                    smsWarning = '\n\n⚠ 안내 문자 발송에 실패했습니다. SMS 설정을 확인해주세요.';
                    console.error('승인 문자 발송 오류:', smsError);
                }
            }

            alert(`"${reg.name}" 수강생이 승인되었습니다.\n로그인 가능 상태입니다.${smsWarning}`);
            await refreshSheets();
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

    const handleDelete = async (reg) => {
        const isApproved = reg.status === 'approved';
        const msg = isApproved
            ? `"${reg.name}" 수강생의 등록을 삭제하시겠습니까?\n\nFirestore + Google Sheets 모두에서 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
            : `"${reg.name}" 수강생의 등록을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;
        if (!confirm(msg)) return;

        try {
            // 승인된 등록이면 Google Sheets 행 클리어 + 음영 초기화
            if (isApproved) {
                try {
                    const targetSheet = getCurrentSheetName();
                    const rows = await readSheetData(`${targetSheet}!A:R`);
                    let targetRow = -1;
                    for (let i = rows.length - 1; i >= 2; i--) {
                        if (rows[i] && rows[i][1] === reg.name) {
                            targetRow = i + 1;
                            break;
                        }
                    }
                    if (targetRow > 0) {
                        const emptyRow = Array(18).fill('');
                        await writeSheetData(`${targetSheet}!A${targetRow}:R${targetRow}`, [emptyRow]);
                        try {
                            const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                            const cellRanges = columns.map(col => `${col}${targetRow}`);
                            await formatCellsWithStyle(cellRanges, targetSheet, { red: 1.0, green: 1.0, blue: 1.0 }, 'LEFT');
                        } catch (fmtErr) {
                            console.warn('음영 초기화 실패:', fmtErr);
                        }
                    }
                } catch (sheetErr) {
                    console.warn('Google Sheets 삭제 실패:', sheetErr);
                }
            }

            await deleteNewStudentRegistration(reg.id);

            // 승인된 등록이면 입학반 인원 차감
            if (isApproved && reg.entranceClassId) {
                try {
                    const classes = await getEntranceClasses(false);
                    const ec = classes.find(c => c.id === reg.entranceClassId);
                    if (ec && (ec.currentCount || 0) > 0) {
                        await updateEntranceClass(reg.entranceClassId, {
                            currentCount: (ec.currentCount || 0) - 1
                        });
                    }
                } catch (ecErr) {
                    console.warn('입학반 인원 차감 실패:', ecErr);
                }
            }

            if (isApproved) {
                refreshSheets();
            }
            await loadRegistrations();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    };

    const handleSendWaitlistSMS = async (reg) => {
        if (!reg.phone) {
            alert('연락처가 없어 문자를 보낼 수 없습니다.');
            return;
        }
        if (!confirm(`"${reg.name}" 수강생에게 여석 안내 SMS를 발송하시겠습니까?`)) return;

        try {
            const result = await sendWaitlistAvailableSMS(
                reg.phone,
                reg.name,
                reg.requestedSlots || [],
                PERIODS
            );
            if (result) {
                alert(`"${reg.name}" 수강생에게 여석 안내 SMS가 발송되었습니다.`);
            } else {
                alert('SMS 발송에 실패했습니다.');
            }
        } catch (err) {
            alert('SMS 발송 실패: ' + err.message);
        }
    };

    const handleWaitlistApproveOpen = async (reg) => {
        // 입학반 목록이 비어있으면 로드
        if (entranceClasses.length === 0) {
            try {
                const data = await getEntranceClasses(false);
                setEntranceClassesList(data);
            } catch (err) {
                console.error('입학반 조회 실패:', err);
            }
        }
        setWaitlistEntranceId(reg.entranceClassId || '');
        setWaitlistApproveReg(reg);
    };

    const handleWaitlistApproveConfirm = async () => {
        if (!waitlistApproveReg) return;
        if (!waitlistEntranceId) {
            alert('입학반을 선택해주세요.');
            return;
        }

        const selectedEC = entranceClasses.find(ec => ec.id === waitlistEntranceId);
        if (!selectedEC) {
            alert('선택한 입학반을 찾을 수 없습니다.');
            return;
        }

        // 만석 체크
        if ((selectedEC.currentCount || 0) >= (selectedEC.maxCapacity || 0)) {
            alert('선택한 입학반이 만석입니다. 다른 입학반을 선택해주세요.');
            return;
        }

        // 입학반 정보 업데이트 후 승인 진행
        try {
            await updateNewStudentRegistration(waitlistApproveReg.id, {
                entranceClassId: selectedEC.id,
                entranceDate: selectedEC.date,
                entranceClassDate: selectedEC.date,
                isWaitlist: false
            });

            // 로컬 reg 객체도 업데이트하여 handleApprove에 전달
            const updatedReg = {
                ...waitlistApproveReg,
                entranceClassId: selectedEC.id,
                entranceDate: selectedEC.date,
                entranceClassDate: selectedEC.date,
                isWaitlist: false
            };

            setWaitlistApproveReg(null);
            await handleApprove(updatedReg);
        } catch (err) {
            alert('승인 실패: ' + err.message);
        }
    };

    const handleDeleteFromEntrance = async (reg, ec) => {
        const isApproved = reg.status === 'approved';
        const msg = isApproved
            ? `"${reg.name}" 수강생의 등록을 삭제하시겠습니까?\n\nFirestore + Google Sheets 모두에서 삭제됩니다.`
            : `"${reg.name}" 수강생의 등록을 삭제하시겠습니까?`;
        if (!confirm(msg)) return;

        try {
            // 승인된 등록이었으면 Google Sheets에서도 해당 행 삭제
            if (isApproved) {
                try {
                    const targetSheet = getCurrentSheetName();
                    const rows = await readSheetData(`${targetSheet}!A:R`);
                    // B열(이름)으로 해당 수강생 행 찾기
                    let targetRow = -1;
                    for (let i = rows.length - 1; i >= 2; i--) {
                        if (rows[i] && rows[i][1] === reg.name) {
                            targetRow = i + 1; // 배열 인덱스 → 시트 행번호
                            break;
                        }
                    }
                    if (targetRow > 0) {
                        // 행 내용 클리어 (A~R열을 빈 값으로)
                        const emptyRow = Array(18).fill('');
                        await writeSheetData(`${targetSheet}!A${targetRow}:R${targetRow}`, [emptyRow]);
                        // 음영(배경색)도 흰색으로 초기화
                        try {
                            const columns = 'ABCDEFGHIJKLMNOPQR'.split('');
                            const cellRanges = columns.map(col => `${col}${targetRow}`);
                            await formatCellsWithStyle(cellRanges, targetSheet, { red: 1.0, green: 1.0, blue: 1.0 }, 'LEFT');
                        } catch (fmtErr) {
                            console.warn('음영 초기화 실패:', fmtErr);
                        }
                        console.log(`✅ Google Sheets ${targetSheet} ${targetRow}행 삭제 완료: ${reg.name}`);
                    }
                } catch (sheetErr) {
                    console.warn('Google Sheets 삭제 실패:', sheetErr);
                }
            }

            await deleteNewStudentRegistration(reg.id);
            // 승인된 등록이었으면 입학반 인원 차감
            if (isApproved && ec && (ec.currentCount || 0) > 0) {
                await updateEntranceClass(ec.id, {
                    currentCount: (ec.currentCount || 0) - 1
                });
            }
            await loadEntranceClasses();
            if (isApproved) {
                refreshSheets(); // Google Sheets 데이터 새로고침
            }
        } catch (err) {
            alert('삭제 실패: ' + err.message);
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
            setEntranceForm({ date: '', time: '', description: '', maxCapacity: 6 });
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
                            {['pending', 'waitlist', 'approved', 'rejected'].map(f => (
                                <button
                                    key={f}
                                    className={`cns-filter-btn ${regFilter === f ? 'active' : ''}`}
                                    onClick={() => setRegFilter(f)}
                                >
                                    {f === 'pending' ? '대기중' : f === 'waitlist' ? '대기(만석)' : f === 'approved' ? '승인됨' : '거절됨'}
                                    {(regCounts[f] || 0) > 0 && f !== 'rejected' && (
                                        <span className="cns-filter-dot" />
                                    )}
                                </button>
                            ))}
                        </div>

                        {loading ? (
                            <div className="cns-loading">불러오는 중...</div>
                        ) : registrations.length === 0 ? (
                            <div className="cns-empty">
                                {regFilter === 'pending' ? '대기 중인 등록이 없습니다.'
                                    : regFilter === 'waitlist' ? '대기(만석) 신청이 없습니다.'
                                    : '해당 목록이 없습니다.'}
                            </div>
                        ) : (() => {
                            // 카드 렌더링 함수
                            const renderRegCard = (reg) => (
                                <div key={reg.id} className="cns-reg-card">
                                    <div
                                        className="cns-reg-card-header"
                                        onClick={() => setCollapsedRegs(prev => {
                                            const next = new Set(prev);
                                            if (next.has(reg.id)) next.delete(reg.id);
                                            else next.add(reg.id);
                                            return next;
                                        })}
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
                                            <span className="cns-expand-arrow">{collapsedRegs.has(reg.id) ? '▼' : '▲'}</span>
                                        </div>
                                    </div>

                                    {!collapsedRegs.has(reg.id) && (
                                        <div className="cns-reg-detail">
                                            <div className="cns-detail-grid">
                                                <div className="cns-detail-item">
                                                    <span className="cns-detail-label">연락처</span>
                                                    <span className="cns-detail-value">{reg.phone}</span>
                                                </div>
                                                <div className="cns-detail-item">
                                                    <span className="cns-detail-label">결제방식</span>
                                                    <span className="cns-detail-value">
                                                        {reg.paymentMethod === 'naver' ? '네이버' : reg.paymentMethod === 'card' ? '현장 카드 결제' : reg.paymentMethod === 'zeropay' ? '제로페이' : '현장 계좌 이체'}
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

                                            <div className="cns-action-row">
                                                {regFilter === 'pending' && (
                                                    <>
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
                                                    </>
                                                )}
                                                {regFilter === 'waitlist' && (
                                                    <>
                                                        <button
                                                            className="cns-action-btn"
                                                            style={{ background: '#f59e0b', color: '#fff' }}
                                                            onClick={() => handleSendWaitlistSMS(reg)}
                                                        >
                                                            SMS 안내
                                                        </button>
                                                        <button
                                                            className="cns-action-btn approve"
                                                            onClick={() => handleWaitlistApproveOpen(reg)}
                                                            disabled={approving === reg.id}
                                                        >
                                                            {approving === reg.id ? '처리 중...' : '수강 승인'}
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    className="cns-action-btn delete"
                                                    onClick={() => handleDelete(reg)}
                                                >
                                                    삭제
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );

                            // 승인됨 필터: 입학반별 그룹 표시
                            if (regFilter === 'approved') {
                                const groups = {};
                                registrations.forEach(reg => {
                                    const key = reg.entranceDate || 'none';
                                    if (!groups[key]) groups[key] = [];
                                    groups[key].push(reg);
                                });
                                const sortedKeys = Object.keys(groups).sort((a, b) => {
                                    if (a === 'none') return 1;
                                    if (b === 'none') return -1;
                                    return b.localeCompare(a);
                                });

                                return (
                                    <div className="cns-reg-list">
                                        {sortedKeys.map(key => (
                                            <div key={key}>
                                                <div className="cns-group-header">
                                                    <span className="cns-group-title">
                                                        {key === 'none' ? '입학반 미지정' : formatEntranceDate(key)}
                                                    </span>
                                                    <span className="cns-group-count">{groups[key].length}명</span>
                                                </div>
                                                {groups[key].map(renderRegCard)}
                                            </div>
                                        ))}
                                    </div>
                                );
                            }

                            // 기본 렌더링
                            return (
                                <div className="cns-reg-list">
                                    {registrations.map(renderRegCard)}
                                </div>
                            );
                        })()}
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
                                    setEntranceForm({ date: new Date().toISOString().split('T')[0], time: '', endTime: '', description: '', maxCapacity: 6, currentCount: 0 });
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
                                            {(() => {
                                                const ecRegs = entranceRegs.filter(r => r.entranceClassId === ec.id);
                                                if (ecRegs.length === 0) return null;
                                                return (
                                                    <div className="cns-entrance-students">
                                                        {ecRegs.map(r => (
                                                            <span key={r.id} className={`cns-entrance-student-tag ${r.status}`}>
                                                                {r.name}
                                                                {r.status === 'pending' && <small>(대기)</small>}
                                                                <button
                                                                    className="cns-entrance-student-remove"
                                                                    onClick={() => handleDeleteFromEntrance(r, ec)}
                                                                    title="삭제"
                                                                >×</button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
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
                                                        maxCapacity: ec.maxCapacity || 10,
                                                        currentCount: ec.currentCount || 0
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
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '') {
                                                    setEntranceForm({ ...entranceForm, maxCapacity: '' });
                                                } else {
                                                    const num = parseInt(val);
                                                    if (!isNaN(num) && num >= 1) {
                                                        setEntranceForm({ ...entranceForm, maxCapacity: num });
                                                    }
                                                }
                                            }}
                                            onBlur={() => {
                                                if (entranceForm.maxCapacity === '' || entranceForm.maxCapacity < 1) {
                                                    setEntranceForm({ ...entranceForm, maxCapacity: 1 });
                                                }
                                            }}
                                            min={1}
                                            step={1}
                                            className="cns-form-input"
                                        />
                                    </div>
                                    {editingEntrance && (
                                        <div className="cns-form-field">
                                            <label>현재 인원</label>
                                            <input
                                                type="number"
                                                value={entranceForm.currentCount}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val === '') {
                                                        setEntranceForm({ ...entranceForm, currentCount: '' });
                                                    } else {
                                                        const num = parseInt(val);
                                                        if (!isNaN(num) && num >= 0) {
                                                            setEntranceForm({ ...entranceForm, currentCount: num });
                                                        }
                                                    }
                                                }}
                                                onBlur={() => {
                                                    if (entranceForm.currentCount === '' || entranceForm.currentCount < 0) {
                                                        setEntranceForm({ ...entranceForm, currentCount: 0 });
                                                    }
                                                }}
                                                min={0}
                                                step={1}
                                                className="cns-form-input"
                                            />
                                        </div>
                                    )}
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

            {/* === 대기(만석) 수강 승인 모달 === */}
            {waitlistApproveReg && (
                <div className="cns-modal-overlay" onClick={() => setWaitlistApproveReg(null)}>
                    <div className="cns-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>수강 승인 - 입학반 선택</h3>
                        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '12px' }}>
                            "{waitlistApproveReg.name}" 수강생의 입학반 날짜를 선택해주세요.
                        </p>
                        <div className="cns-form-field">
                            <label>입학반</label>
                            <select
                                value={waitlistEntranceId}
                                onChange={(e) => setWaitlistEntranceId(e.target.value)}
                                className="cns-form-input"
                            >
                                <option value="">입학반을 선택하세요</option>
                                {entranceClasses.filter(ec => ec.isActive).map(ec => (
                                    <option key={ec.id} value={ec.id}>
                                        {formatEntranceDate(ec.date)} {ec.time}{ec.endTime ? ` ~ ${ec.endTime}` : ''} ({ec.currentCount || 0}/{ec.maxCapacity}명)
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="cns-modal-actions">
                            <button className="cns-modal-btn cancel" onClick={() => setWaitlistApproveReg(null)}>취소</button>
                            <button className="cns-modal-btn save" onClick={handleWaitlistApproveConfirm}>승인</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CoachNewStudents;
