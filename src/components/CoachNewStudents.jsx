import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { setStudentPassword } from '../services/authService';
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
    deleteFAQ,
    getHolidays,
    updateWaitlistRequestedSlots,
    getDisabledClasses
} from '../services/firebaseService';
import {
    getCurrentSheetName,
    readSheetData,
    writeSheetData,
    formatCellsWithStyle,
    getStudentField,
    calculateEndDateWithHolidays
} from '../services/googleSheetsService';
import { sendApprovalNotifications, sendWaitlistAvailableSMS, cancelScheduledSMS, sendWaitlistCancelledSMS, sendStudentRegistrationSMS, sendStudentApprovalSMS, scheduleEntranceReminderSMS } from '../services/smsService';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/calendarService';
import SmsStatusChips from './SmsStatusChips';
import { smsIssueCount, isReminderResendable } from '../utils/smsStatus';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { formatEntranceDate, convertToYYMMDD, calculateStartEndDates } from '../utils/dateUtils';
import { PRICING, PERIODS, DAYS, MAX_CAPACITY } from '../data/mockData';
import StudentRegistrationModal from './StudentRegistrationModal';
import './CoachNewStudents.css';

const CoachNewStudents = ({ user, onBack }) => {
    const { refresh: refreshSheets, students: allStudents } = useGoogleSheets();
    const [activeTab, setActiveTab] = useState('registrations');
    const [loading, setLoading] = useState(false);

    // === 등록 목록 ===
    const [registrations, setRegistrations] = useState([]);
    const [regFilter, setRegFilter] = useState('approved');
    const [collapsedRegs, setCollapsedRegs] = useState(new Set());
    const [approving, setApproving] = useState(null);
    const [regCounts, setRegCounts] = useState({});
    const [waitlistApproveReg, setWaitlistApproveReg] = useState(null);
    const [waitlistEntranceId, setWaitlistEntranceId] = useState('');
    const [waitlistSelectedSlots, setWaitlistSelectedSlots] = useState([]);

    // === 입학반 선택 모달 (승인 시 선택 / 승인 후 변경) ===
    const [entranceModal, setEntranceModal] = useState(null); // { reg, mode: 'approve' | 'edit' }
    const [entKind, setEntKind] = useState('request');        // 'request'(요청대로) | 'existing'(기존) | 'new'(새 날짜)
    const [entEcId, setEntEcId] = useState('');               // 선택한 기존 입학반 id
    const [entDate, setEntDate] = useState('');               // 새로 생성할 날짜 (YYYY-MM-DD)
    const [entSaving, setEntSaving] = useState(false);

    // === 시간표 편집 모달 ===
    const [editSlotsReg, setEditSlotsReg] = useState(null);
    const [editSlots, setEditSlots] = useState([]);
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [slotOccupancy, setSlotOccupancy] = useState({});

    // === 입학반 관리 ===
    const [entranceClasses, setEntranceClassesList] = useState([]);
    const [entranceRegs, setEntranceRegs] = useState([]);
    const [showEntranceForm, setShowEntranceForm] = useState(false);
    const [editingEntrance, setEditingEntrance] = useState(null);
    const [entranceForm, setEntranceForm] = useState({ date: '', time: '', description: '', maxCapacity: 6 });
    const [showAddStudentModal, setShowAddStudentModal] = useState(null); // 수동 추가 대상 입학반
    const [sheetNewStudents, setSheetNewStudents] = useState([]);          // 후보 신청(reg) 목록
    const [selectedNewStudents, setSelectedNewStudents] = useState(new Set()); // 선택한 reg.id 집합
    const [addTempName, setAddTempName] = useState('');                    // 목록에 없는 임시 이름(메모용)
    const [addStudentLoading, setAddStudentLoading] = useState(false);

    // === 예약 리마인더 일정 변경 모달 ===
    const [reminderModal, setReminderModal] = useState(null); // 대상 reg
    const [reminderAt, setReminderAt] = useState('');         // datetime-local 값
    const [showPastEntrance, setShowPastEntrance] = useState(false);
    const [directRegEntrance, setDirectRegEntrance] = useState(null);

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

    // 비활성 슬롯 + 슬롯 점유율 로드 (시간표 편집/승인 모달용)
    useEffect(() => {
        getDisabledClasses().then(setDisabledClasses).catch(() => {});
    }, []);

    useEffect(() => {
        if (!allStudents || allStudents.length === 0) return;
        const occ = {};
        const namesPerSlot = {};
        allStudents.forEach(student => {
            const name = student['이름'];
            const scheduleStr = student['요일 및 시간'];
            if (!name || !scheduleStr) return;
            const chars = scheduleStr.replace(/\s/g, '');
            let i = 0;
            while (i < chars.length) {
                const ch = chars[i];
                if ('월화수목금'.includes(ch)) {
                    const day = ch;
                    i++;
                    let ps = '';
                    while (i < chars.length && /\d/.test(chars[i])) { ps += chars[i]; i++; }
                    if (ps) {
                        const key = `${day}-${parseInt(ps)}`;
                        if (!namesPerSlot[key]) namesPerSlot[key] = new Set();
                        namesPerSlot[key].add(name);
                    }
                } else { i++; }
            }
        });
        Object.keys(namesPerSlot).forEach(k => { occ[k] = namesPerSlot[k].size; });
        setSlotOccupancy(occ);
    }, [allStudents]);

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

            // 승인된 건 중 입학반 날짜가 지난 건 자동 완료 처리
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const expiredApproved = data.filter(r => {
                if (r.status !== 'approved') return false;
                const eDate = r.entranceDate || r.entranceClassDate;
                if (!eDate) return false;
                const entranceDate = new Date(eDate + 'T23:59:59');
                return entranceDate < today;
            });
            if (expiredApproved.length > 0) {
                await Promise.all(
                    expiredApproved.map(r => updateNewStudentRegistration(r.id, { status: 'completed' }))
                );
                console.log(`✅ ${expiredApproved.length}명 신규 수강생 자동 완료 처리`);
                // 완료 처리된 건 목록에서 제외
                const completedIds = new Set(expiredApproved.map(r => r.id));
                setRegistrations(data.filter(r => !completedIds.has(r.id)));
            } else {
                setRegistrations(data);
            }
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
                isCoach: false,
                createdAt: serverTimestamp()
            });
            try {
                const saved = JSON.parse(localStorage.getItem('savedUser') || '{}');
                const coachName = saved.name, coachPassword = saved.password;
                await setStudentPassword(coachName, coachPassword, reg.name, reg.password);
            } catch (hashErr) {
                console.warn('bcrypt 해시 기록 실패 (평문 폴백으로 로그인 가능):', hashErr);
            }

            // 2. Google Sheets 행 추가 (시작일 기준 시트 결정)
            const entranceDateForCalc = reg.entranceInquiry || reg.entranceDate;
            const { startDate: calcStartDate } = calculateStartEndDates(
                entranceDateForCalc,
                reg.requestedSlots
            );
            const targetSheet = getCurrentSheetName(new Date(calcStartDate + 'T00:00:00'));
            const rows = await readSheetData(`${targetSheet}!A:R`);
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

            // 시작일/종료일 계산 (entranceDateForCalc, calcStartDate는 위에서 이미 계산됨)
            const startDateYYMMDD = convertToYYMMDD(calcStartDate);

            // 공휴일 반영하여 종료일 재계산
            const firebaseHolidays = await getHolidays().catch(() => []);
            const weeklyFreq = parseInt(reg.weeklyFrequency) || 2;
            const totalSessions = weeklyFreq * 4; // 신규 등록은 1개월
            const startDateObj = new Date(calcStartDate + 'T00:00:00');
            const calcEndDateObj = calculateEndDateWithHolidays(
                startDateObj, totalSessions, reg.scheduleString, firebaseHolidays
            );
            const endDateYYMMDD = calcEndDateObj
                ? convertToYYMMDD(`${calcEndDateObj.getFullYear()}-${String(calcEndDateObj.getMonth() + 1).padStart(2, '0')}-${String(calcEndDateObj.getDate()).padStart(2, '0')}`)
                : convertToYYMMDD(calculateStartEndDates(entranceDateForCalc, reg.requestedSlots).endDate);

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

                // 현장 결제(네이버 외)인 경우 결제일(J), 결제유무(K)에 빨간색 음영
                if (reg.paymentMethod !== 'naver') {
                    await formatCellsWithStyle(
                        [`J${nextSheetRow}`, `K${nextSheetRow}`],
                        targetSheet,
                        { red: 0.92, green: 0.36, blue: 0.36 }
                    );
                }
            } catch (err) {
                console.warn('서식 적용 실패:', err);
            }

            // 3. 등록 상태 업데이트
            await updateNewStudentRegistration(reg.id, {
                status: 'approved',
                approvedAt: new Date().toISOString()
            });

            // 4. 입학반 처리
            let finalEntranceDate = reg.entranceDate;
            let finalEntranceClassDate = reg.entranceClassDate;

            if (reg.entranceInquiry && !reg.entranceClassId) {
                // 다른 날 문의로 승인 → 새 입학반 자동 생성
                try {
                    const ecResult = await createEntranceClass({
                        date: reg.entranceInquiry,
                        time: '10:00',
                        endTime: '13:00',
                        description: '',
                        maxCapacity: 6
                    });
                    const newECId = ecResult.id;
                    // 인원 1로 설정
                    const eventId = await createCalendarEvent(reg.entranceInquiry, '10:00', '13:00');
                    if (eventId) {
                        await updateEntranceClass(newECId, { currentCount: 1, calendarEventId: eventId });
                    } else {
                        await updateEntranceClass(newECId, { currentCount: 1 });
                    }
                    // Firestore 등록 문서에 입학반 연결
                    finalEntranceDate = reg.entranceInquiry;
                    finalEntranceClassDate = `${formatEntranceDate(reg.entranceInquiry)} 10:00 ~ 13:00`;
                    await updateNewStudentRegistration(reg.id, {
                        entranceClassId: newECId,
                        entranceDate: finalEntranceDate,
                        entranceClassDate: finalEntranceClassDate,
                        entranceInquiry: ''
                    });
                    console.log(`✅ 입학반 자동 생성: ${finalEntranceClassDate}, 수강생: ${reg.name}`);
                } catch (ecErr) {
                    console.warn('입학반 자동 생성 실패:', ecErr);
                }
            } else if (reg.entranceClassId) {
                try {
                    const classes = await getEntranceClasses(false);
                    const ec = classes.find(c => c.id === reg.entranceClassId);
                    if (ec) {
                        // SMS에 시간이 누락되지 않도록 입학반 원본에서 날짜+시간 재구성
                        const rebuilt = `${formatEntranceDate(ec.date)} ${ec.time || ''}${ec.endTime ? ' ~ ' + ec.endTime : ''}`.trim();
                        if (rebuilt && rebuilt !== finalEntranceClassDate) {
                            finalEntranceClassDate = rebuilt;
                            finalEntranceDate = ec.date;
                            await updateNewStudentRegistration(reg.id, {
                                entranceClassDate: finalEntranceClassDate,
                                entranceDate: finalEntranceDate
                            });
                        }
                        if (reg.entranceCounted) {
                            // 승인 전에 미리 명단에 올려 이미 자리를 차지함 → 중복 카운트 방지, 플래그만 해제
                            await updateNewStudentRegistration(reg.id, { entranceCounted: false });
                        } else {
                            await updateEntranceClass(reg.entranceClassId, {
                                currentCount: (ec.currentCount || 0) + 1
                            });
                        }
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
                        scheduleString: reg.scheduleString || '',
                        entranceDate: finalEntranceDate,
                        entranceClassDate: finalEntranceClassDate
                    });
                    const sent = [];
                    const failed = [];
                    if (smsResults.approvalSMS) sent.push('승인 문자');
                    else failed.push('승인 문자');

                    const groupId = smsResults.reminderSMS?.groupId;
                    const smsLogUpdate = {
                        'smsLog.approval': {
                            status: smsResults.approvalSMS ? 'sent' : 'failed',
                            at: Date.now(),
                        },
                    };
                    if (smsResults.reminderSMS) {
                        sent.push('입학반 리마인더');
                        const reminderScheduledAt = smsResults.reminderSMS?.scheduledAt;
                        // scheduledAt이 있으면 예약 발송, 없으면(입학반 3일 이내) 즉시 발송됨
                        smsLogUpdate['smsLog.reminder'] = reminderScheduledAt
                            ? {
                                status: 'scheduled',
                                at: Date.now(),
                                scheduledAt: reminderScheduledAt,
                                ...(groupId ? { groupId } : {}),
                            }
                            : { status: 'sent', at: Date.now() };
                        // 예약 SMS groupId 저장 (취소용, 기존 필드 하위호환 유지)
                        if (groupId) smsLogUpdate.reminderGroupId = groupId;
                    } else if (reg.entranceDate && reg.entranceClassDate) {
                        // 리마인더가 기대됐는데 예약 실패
                        smsLogUpdate['smsLog.reminder'] = { status: 'failed', at: Date.now() };
                    }
                    await updateNewStudentRegistration(reg.id, smsLogUpdate);
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
                    // 시작일 기준으로 시트 결정 (승인 시와 동일한 로직)
                    const entranceDateForCalc = reg.entranceInquiry || reg.entranceDate;
                    let targetSheet;
                    if (entranceDateForCalc && reg.requestedSlots) {
                        const { startDate: calcStartDate } = calculateStartEndDates(entranceDateForCalc, reg.requestedSlots);
                        targetSheet = getCurrentSheetName(new Date(calcStartDate + 'T00:00:00'));
                    } else {
                        targetSheet = getCurrentSheetName();
                    }
                    const rows = await readSheetData(`${targetSheet}!A:R`);
                    let targetRow = -1;
                    for (let i = rows.length - 1; i >= 2; i--) {
                        if (rows[i] && rows[i][1] === reg.name) {
                            targetRow = i + 1;
                            break;
                        }
                    }
                    // 현재 시트에서 못 찾으면 현재 월 시트에서도 검색
                    if (targetRow < 0) {
                        const fallbackSheet = getCurrentSheetName();
                        if (fallbackSheet !== targetSheet) {
                            const fallbackRows = await readSheetData(`${fallbackSheet}!A:R`);
                            for (let i = fallbackRows.length - 1; i >= 2; i--) {
                                if (fallbackRows[i] && fallbackRows[i][1] === reg.name) {
                                    targetRow = i + 1;
                                    targetSheet = fallbackSheet;
                                    break;
                                }
                            }
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
                    } else {
                        console.warn('Google Sheets에서 수강생을 찾지 못함:', reg.name);
                    }
                } catch (sheetErr) {
                    console.warn('Google Sheets 삭제 실패:', sheetErr);
                }
            }

            await deleteNewStudentRegistration(reg.id);

            // 예약 SMS 취소 (groupId가 있는 경우)
            if (reg.reminderGroupId) {
                try {
                    await cancelScheduledSMS(reg.reminderGroupId);
                    console.log('예약 SMS 취소 완료:', reg.reminderGroupId);
                } catch (smsErr) {
                    console.warn('예약 SMS 취소 실패:', smsErr);
                }
            }

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

    // 상황판: 문자 종류별 재발송
    const handleResendSms = async (reg, typeKey) => {
        if (!reg.phone) { alert('연락처가 없어 문자를 보낼 수 없습니다.'); return; }
        const labelMap = { reception: '접수확인', approval: '승인문자', reminder: '입학반 리마인더' };
        if (!confirm(`"${reg.name}" 수강생에게 [${labelMap[typeKey]}] 문자를 재발송할까요?`)) return;
        try {
            const details = {
                paymentMethod: reg.paymentMethod,
                weeklyFrequency: reg.weeklyFrequency,
                scheduleString: reg.scheduleString || '',
                entranceDate: reg.entranceDate,
                entranceClassDate: reg.entranceClassDate,
            };
            if (typeKey === 'reception') {
                const ok = await sendStudentRegistrationSMS(reg.phone, reg.name, reg.isWaitlist);
                await updateNewStudentRegistration(reg.id, { 'smsLog.reception': { status: ok ? 'sent' : 'failed', at: Date.now() } });
            } else if (typeKey === 'approval') {
                const ok = await sendStudentApprovalSMS(reg.phone, reg.name, details);
                await updateNewStudentRegistration(reg.id, { 'smsLog.approval': { status: ok ? 'sent' : 'failed', at: Date.now() } });
            } else if (typeKey === 'reminder') {
                const res = await scheduleEntranceReminderSMS(reg.phone, reg.name, details);
                const groupId = res?.groupId;
                const scheduledAt = res?.scheduledAt;
                // scheduledAt 있으면 예약, 없는데 성공이면 즉시 발송(입학반 3일 이내)
                const reminderEntry = !res
                    ? { status: 'failed', at: Date.now() }
                    : scheduledAt
                        ? { status: 'scheduled', at: Date.now(), scheduledAt, ...(groupId ? { groupId } : {}) }
                        : { status: 'sent', at: Date.now() };
                await updateNewStudentRegistration(reg.id, {
                    'smsLog.reminder': reminderEntry,
                    ...(groupId ? { reminderGroupId: groupId } : {}),
                });
            }
            alert('재발송 처리되었습니다.');
            await loadRegistrations();
        } catch (err) {
            alert('재발송 실패: ' + (err?.message || err));
        }
    };

    // 리마인더 재발송 비활성 사유 (입학반 날짜 지남)
    const resendDisabledReason = (reg, typeKey) => {
        if (typeKey === 'reminder' && !isReminderResendable(reg)) return '입학반 날짜가 지나 재예약할 수 없습니다.';
        return null;
    };

    // 시간표 편집 모달 열기
    const handleEditSlotsOpen = (reg) => {
        setEditSlotsReg(reg);
        setEditSlots(reg.requestedSlots ? [...reg.requestedSlots] : []);
    };

    // 시간표 편집 저장
    const handleEditSlotsSave = async () => {
        if (!editSlotsReg) return;
        if (editSlots.length < (editSlotsReg.weeklyFrequency || 2)) {
            alert(`최소 ${editSlotsReg.weeklyFrequency}개 이상의 슬롯을 선택해주세요.`);
            return;
        }
        const schedStr = editSlots
            .sort((a, b) => {
                const dayOrder = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
                return dayOrder !== 0 ? dayOrder : a.period - b.period;
            })
            .map(s => `${s.day}${s.period}`)
            .join('');
        try {
            await updateWaitlistRequestedSlots(editSlotsReg.id, editSlots, schedStr);
            alert('시간표가 수정되었습니다.');
            setEditSlotsReg(null);
            await loadRegistrations();
        } catch (err) {
            alert('시간표 수정 실패: ' + err.message);
        }
    };

    const handleEditSlotToggle = (day, period) => {
        const exists = editSlots.find(s => s.day === day && s.period === period);
        if (exists) {
            setEditSlots(editSlots.filter(s => !(s.day === day && s.period === period)));
        } else {
            setEditSlots([...editSlots, { day, period }]);
        }
    };

    // 대기 삭제 + 취소 SMS
    const handleWaitlistDelete = async (reg) => {
        if (!confirm(`"${reg.name}" 수강생의 대기 신청을 삭제하시겠습니까?\n\n수강생에게 취소 안내 문자가 발송됩니다.`)) return;
        try {
            await deleteNewStudentRegistration(reg.id);
            // 취소 SMS 발송
            if (reg.phone) {
                try {
                    await sendWaitlistCancelledSMS(reg.phone, reg.name);
                } catch (smsErr) {
                    console.warn('취소 SMS 발송 실패:', smsErr);
                }
            }
            await loadRegistrations();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    };

    const handleWaitlistApproveOpen = async (reg) => {
        // 대기(만석) 수강생은 코치가 여석 확인 후 직접 승인하는 것이므로 만석 체크 생략

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
        // 여석 있는 슬롯 중에서 미리 선택 (availableSlots가 있으면 사용)
        const avail = reg.availableSlots || [];
        const freq = reg.weeklyFrequency || 2;
        setWaitlistSelectedSlots(avail.slice(0, freq));
        setWaitlistApproveReg(reg);
    };

    const handleWaitlistApproveConfirm = async () => {
        if (!waitlistApproveReg) return;
        if (!waitlistEntranceId) {
            alert('입학반을 선택해주세요.');
            return;
        }
        const freq = waitlistApproveReg.weeklyFrequency || 2;
        if (waitlistSelectedSlots.length !== freq) {
            alert(`시간표를 정확히 ${freq}개 선택해주세요. (현재 ${waitlistSelectedSlots.length}개)`);
            return;
        }

        const selectedEC = entranceClasses.find(ec => ec.id === waitlistEntranceId);
        if (!selectedEC) {
            alert('선택한 입학반을 찾을 수 없습니다.');
            return;
        }

        if ((selectedEC.currentCount || 0) >= (selectedEC.maxCapacity || 0)) {
            alert('선택한 입학반이 만석입니다. 다른 입학반을 선택해주세요.');
            return;
        }

        // 코치가 선택한 슬롯으로 시간표 생성
        const schedStr = waitlistSelectedSlots
            .sort((a, b) => {
                const dayOrder = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
                return dayOrder !== 0 ? dayOrder : a.period - b.period;
            })
            .map(s => `${s.day}${s.period}`)
            .join('');

        const selectedECDate = `${formatEntranceDate(selectedEC.date)} ${selectedEC.time || ''}${selectedEC.endTime ? ' ~ ' + selectedEC.endTime : ''}`.trim();

        try {
            await updateNewStudentRegistration(waitlistApproveReg.id, {
                entranceClassId: selectedEC.id,
                entranceDate: selectedEC.date,
                entranceClassDate: selectedECDate,
                isWaitlist: false,
                coachSelectedSlots: waitlistSelectedSlots,
                requestedSlots: waitlistSelectedSlots,
                scheduleString: schedStr
            });

            const updatedReg = {
                ...waitlistApproveReg,
                entranceClassId: selectedEC.id,
                entranceDate: selectedEC.date,
                entranceClassDate: selectedECDate,
                isWaitlist: false,
                requestedSlots: waitlistSelectedSlots,
                scheduleString: schedStr
            };

            setWaitlistApproveReg(null);
            setWaitlistSelectedSlots([]);
            await handleApprove(updatedReg);
        } catch (err) {
            alert('승인 실패: ' + err.message);
        }
    };

    // ── 입학반 선택/변경 ──

    // 승인된 수강생 시트 행 찾기 (이름 기준, 승인 시와 동일한 시트 결정 로직)
    const findApprovedStudentRow = async (reg) => {
        const entranceDateForCalc = reg.entranceInquiry || reg.entranceDate;
        let targetSheet;
        if (entranceDateForCalc && reg.requestedSlots) {
            const { startDate } = calculateStartEndDates(entranceDateForCalc, reg.requestedSlots);
            targetSheet = getCurrentSheetName(new Date(startDate + 'T00:00:00'));
        } else {
            targetSheet = getCurrentSheetName();
        }
        const findRow = (rs) => {
            for (let i = rs.length - 1; i >= 2; i--) {
                if (rs[i] && rs[i][1] === reg.name) return i + 1;
            }
            return -1;
        };
        let rows = await readSheetData(`${targetSheet}!A:R`);
        let targetRow = findRow(rows);
        if (targetRow < 0) {
            const fallback = getCurrentSheetName();
            if (fallback !== targetSheet) {
                const fbRows = await readSheetData(`${fallback}!A:R`);
                const fbRow = findRow(fbRows);
                if (fbRow > 0) { targetSheet = fallback; targetRow = fbRow; }
            }
        }
        return { targetSheet, targetRow };
    };

    // 입학반 선택 모달 열기 (mode: 'approve'는 승인 직전, 'edit'은 승인된 건 변경)
    const openEntranceModal = async (reg, mode) => {
        try {
            const data = await getEntranceClasses(false);
            setEntranceClassesList(data);
        } catch (err) {
            console.warn('입학반 목록 조회 실패:', err);
        }
        setEntKind(mode === 'edit' ? (reg.entranceClassId ? 'existing' : 'new') : 'request');
        setEntEcId(reg.entranceClassId || '');
        setEntDate(reg.entranceDate || reg.entranceInquiry || '');
        setEntranceModal({ reg, mode });
    };

    const handleEntranceModalConfirm = async () => {
        if (!entranceModal) return;
        const { reg, mode } = entranceModal;
        if (entKind === 'existing' && !entEcId) { alert('입학반을 선택해주세요.'); return; }
        if (entKind === 'new' && !entDate) { alert('입학반 날짜를 선택해주세요.'); return; }

        setEntSaving(true);
        try {
            if (mode === 'approve') {
                // 승인 흐름: reg 필드만 덮어쓰고 기존 handleApprove 재사용
                let updatedReg = reg;
                if (entKind === 'existing') {
                    const ec = entranceClasses.find(c => c.id === entEcId);
                    if (!ec) throw new Error('선택한 입학반을 찾을 수 없습니다.');
                    if ((ec.currentCount || 0) >= (ec.maxCapacity || 0)) throw new Error('선택한 입학반이 만석입니다.');
                    const classDateStr = `${formatEntranceDate(ec.date)} ${ec.time || ''}${ec.endTime ? ' ~ ' + ec.endTime : ''}`.trim();
                    updatedReg = { ...reg, entranceClassId: ec.id, entranceDate: ec.date, entranceClassDate: classDateStr, entranceInquiry: '' };
                } else if (entKind === 'new') {
                    updatedReg = { ...reg, entranceInquiry: entDate, entranceClassId: '', entranceDate: '', entranceClassDate: '' };
                }
                setEntranceModal(null);
                await handleApprove(updatedReg);
            } else {
                await handleChangeEntrance(reg, buildEntranceTarget());
                setEntranceModal(null);
            }
        } catch (err) {
            alert('처리 실패: ' + err.message);
        }
        setEntSaving(false);
    };

    // 모달 상태(entKind/entEcId/entDate)로부터 배정 대상 입학반 도출
    const buildEntranceTarget = () => entKind === 'existing'
        ? { kind: 'existing', ec: entranceClasses.find(c => c.id === entEcId) }
        : { kind: 'new', date: entDate };

    // 핵심: 승인된 reg를 특정 입학반에 배정 — 이전 입학반 인원 -1, 새 입학반 +1(또는 새로 생성),
    // 시트 시작/종료날짜 재계산, 예약 리마인더 취소+재예약, Firestore 갱신. (알럿/리로드 없음, classDateStr 반환)
    const applyEntranceAssignment = async (reg, target, holidays) => {
        // 1. 새 입학반 결정
        let newEcId, newDate, newTime = '10:00', newEndTime = '13:00';
        if (target.kind === 'existing') {
            const ec = target.ec;
            if (!ec) throw new Error('선택한 입학반을 찾을 수 없습니다.');
            newEcId = ec.id; newDate = ec.date; newTime = ec.time || '10:00'; newEndTime = ec.endTime || '13:00';
        } else {
            const ecRes = await createEntranceClass({ date: target.date, time: '10:00', endTime: '13:00', description: '', maxCapacity: 6 });
            newEcId = ecRes.id; newDate = target.date;
            const eventId = await createCalendarEvent(target.date, '10:00', '13:00');
            await updateEntranceClass(newEcId, eventId ? { currentCount: 1, calendarEventId: eventId } : { currentCount: 1 });
        }
        const classDateStr = `${formatEntranceDate(newDate)} ${newTime}${newEndTime ? ' ~ ' + newEndTime : ''}`.trim();

        // 2. 인원 증감 (DB 최신값 기준 — 연속 배정 시 누락 방지)
        if (reg.entranceClassId !== newEcId) {
            const fresh = await getEntranceClasses(false);
            if (reg.entranceClassId) {
                const oldEc = fresh.find(c => c.id === reg.entranceClassId);
                if (oldEc && (oldEc.currentCount || 0) > 0) {
                    await updateEntranceClass(oldEc.id, { currentCount: (oldEc.currentCount || 0) - 1 });
                }
            }
            if (target.kind === 'existing') {
                const ecFresh = fresh.find(c => c.id === newEcId);
                await updateEntranceClass(newEcId, { currentCount: (ecFresh?.currentCount || 0) + 1 });
            }
        }

        // 3. 시트 시작/종료날짜 재계산 + 업데이트
        try {
            const { startDate } = calculateStartEndDates(newDate, reg.requestedSlots);
            const startYY = convertToYYMMDD(startDate);
            const weeklyFreq = parseInt(reg.weeklyFrequency) || 2;
            const endObj = calculateEndDateWithHolidays(new Date(startDate + 'T00:00:00'), weeklyFreq * 4, reg.scheduleString, holidays);
            const endYY = endObj
                ? convertToYYMMDD(`${endObj.getFullYear()}-${String(endObj.getMonth() + 1).padStart(2, '0')}-${String(endObj.getDate()).padStart(2, '0')}`)
                : '';
            const { targetSheet, targetRow } = await findApprovedStudentRow(reg);
            if (targetRow > 0) {
                if (endYY) await writeSheetData(`${targetSheet}!G${targetRow}:H${targetRow}`, [[startYY, endYY]]);
                else await writeSheetData(`${targetSheet}!G${targetRow}`, [[startYY]]);
            } else {
                console.warn('시트에서 수강생 행을 찾지 못함:', reg.name);
            }
        } catch (err) { console.warn('시트 시작/종료날짜 업데이트 실패:', err); }

        // 4. 예약 리마인더 취소 + 새 날짜로 재예약
        const oldGroupId = reg.reminderGroupId || reg.smsLog?.reminder?.groupId;
        if (oldGroupId) {
            try { await cancelScheduledSMS(oldGroupId); } catch (err) { console.warn('기존 예약문자 취소 실패:', err); }
        }
        let reminderEntry = null, newGroupId = null;
        if (reg.phone) {
            try {
                const res = await scheduleEntranceReminderSMS(reg.phone, reg.name, {
                    paymentMethod: reg.paymentMethod,
                    weeklyFrequency: reg.weeklyFrequency,
                    scheduleString: reg.scheduleString || '',
                    entranceDate: newDate,
                    entranceClassDate: classDateStr,
                });
                newGroupId = res?.groupId || null;
                reminderEntry = !res
                    ? { status: 'failed', at: Date.now() }
                    : res.scheduledAt
                        ? { status: 'scheduled', at: Date.now(), scheduledAt: res.scheduledAt, ...(newGroupId ? { groupId: newGroupId } : {}) }
                        : { status: 'sent', at: Date.now() };
            } catch (err) {
                console.warn('예약문자 재발송 실패:', err);
                reminderEntry = { status: 'failed', at: Date.now() };
            }
        }

        // 5. Firestore 등록 문서 갱신
        const update = { entranceClassId: newEcId, entranceDate: newDate, entranceClassDate: classDateStr, entranceInquiry: '' };
        if (reminderEntry) {
            update['smsLog.reminder'] = reminderEntry;
            update.reminderGroupId = newGroupId || '';
        }
        await updateNewStudentRegistration(reg.id, update);
        return classDateStr;
    };

    // 승인된 수강생의 입학반 변경 (입학반 변경 모달에서 호출)
    const handleChangeEntrance = async (reg, target) => {
        const holidays = await getHolidays().catch(() => []);
        const classDateStr = await applyEntranceAssignment(reg, target, holidays);
        await refreshSheets();
        await loadRegistrations();
        alert(`"${reg.name}" 입학반을 변경했습니다.\n\n입학반: ${classDateStr}`);
    };

    // ── 입학반 리마인더 예약 일정 변경 ──
    const toLocalInput = (d) => {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    const openReminderModal = (reg) => {
        if (!reg.phone) { alert('연락처가 없어 예약 문자를 설정할 수 없습니다.'); return; }
        let local = '';
        const prev = reg.smsLog?.reminder?.scheduledAt;
        if (prev) {
            const d = new Date(prev);
            if (!isNaN(d.getTime())) local = toLocalInput(d);
        }
        if (!local && reg.entranceDate) {
            const d = new Date(reg.entranceDate + 'T00:00:00');
            d.setDate(d.getDate() - 3); d.setHours(9, 0, 0, 0);
            local = toLocalInput(d);
        }
        setReminderAt(local);
        setReminderModal(reg);
    };

    const handleReminderReschedule = async () => {
        const reg = reminderModal;
        if (!reg) return;
        if (!reminderAt) { alert('예약 시각을 입력해주세요.'); return; }
        const when = new Date(reminderAt);
        if (isNaN(when.getTime())) { alert('시각 형식이 올바르지 않습니다.'); return; }

        setEntSaving(true);
        try {
            const oldGroupId = reg.reminderGroupId || reg.smsLog?.reminder?.groupId;
            if (oldGroupId) {
                try { await cancelScheduledSMS(oldGroupId); } catch (err) { console.warn('기존 예약문자 취소 실패:', err); }
            }
            const res = await scheduleEntranceReminderSMS(reg.phone, reg.name, {
                paymentMethod: reg.paymentMethod,
                weeklyFrequency: reg.weeklyFrequency,
                scheduleString: reg.scheduleString || '',
                entranceDate: reg.entranceDate,
                entranceClassDate: reg.entranceClassDate,
            }, when);
            const newGroupId = res?.groupId || null;
            const reminderEntry = !res
                ? { status: 'failed', at: Date.now() }
                : res.scheduledAt
                    ? { status: 'scheduled', at: Date.now(), scheduledAt: res.scheduledAt, ...(newGroupId ? { groupId: newGroupId } : {}) }
                    : { status: 'sent', at: Date.now() };
            await updateNewStudentRegistration(reg.id, { 'smsLog.reminder': reminderEntry, reminderGroupId: newGroupId || '' });
            setReminderModal(null);
            await loadRegistrations();
            alert(!res ? '예약에 실패했습니다.' : res.scheduledAt ? `예약 변경 완료\n\n${res.scheduledAt}` : '지정 시각이 임박/경과하여 즉시 발송되었습니다.');
        } catch (err) {
            alert('예약 변경 실패: ' + err.message);
        }
        setEntSaving(false);
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
                    // 시작일 기준으로 시트 결정 (승인 시와 동일한 로직)
                    const entranceDateForCalc = reg.entranceInquiry || reg.entranceDate;
                    let targetSheet;
                    if (entranceDateForCalc && reg.requestedSlots) {
                        const { startDate: calcStartDate } = calculateStartEndDates(entranceDateForCalc, reg.requestedSlots);
                        targetSheet = getCurrentSheetName(new Date(calcStartDate + 'T00:00:00'));
                    } else {
                        targetSheet = getCurrentSheetName();
                    }
                    const rows = await readSheetData(`${targetSheet}!A:R`);
                    // B열(이름)으로 해당 수강생 행 찾기
                    let targetRow = -1;
                    for (let i = rows.length - 1; i >= 2; i--) {
                        if (rows[i] && rows[i][1] === reg.name) {
                            targetRow = i + 1; // 배열 인덱스 → 시트 행번호
                            break;
                        }
                    }
                    // 현재 시트에서 못 찾으면 현재 월 시트에서도 검색
                    if (targetRow < 0) {
                        const fallbackSheet = getCurrentSheetName();
                        if (fallbackSheet !== targetSheet) {
                            const fallbackRows = await readSheetData(`${fallbackSheet}!A:R`);
                            for (let i = fallbackRows.length - 1; i >= 2; i--) {
                                if (fallbackRows[i] && fallbackRows[i][1] === reg.name) {
                                    targetRow = i + 1;
                                    targetSheet = fallbackSheet;
                                    break;
                                }
                            }
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
                    } else {
                        console.warn('Google Sheets에서 수강생을 찾지 못함:', reg.name);
                    }
                } catch (sheetErr) {
                    console.warn('Google Sheets 삭제 실패:', sheetErr);
                }
            }

            await deleteNewStudentRegistration(reg.id);
            // 예약 SMS 취소
            if (reg.reminderGroupId) {
                try {
                    await cancelScheduledSMS(reg.reminderGroupId);
                } catch (smsErr) {
                    console.warn('예약 SMS 취소 실패:', smsErr);
                }
            }
            // 자리를 차지하던 등록이면 입학반 인원 차감 (승인됨 또는 미승인/메모로 미리 자리 차지한 경우)
            if ((isApproved || reg.entranceCounted) && ec && (ec.currentCount || 0) > 0) {
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

    // ─── 입학반에 수강생 추가 (신청 목록에서 선택 / 임시 이름) ─────────────────────
    const handleOpenAddStudent = async (ec) => {
        setShowAddStudentModal(ec);
        setSelectedNewStudents(new Set());
        setAddTempName('');
        setAddStudentLoading(true);
        try {
            const allRegs = await getNewStudentRegistrations(null);
            // 시트에서 현재 '신규'(F열)인 이름만 = 진짜 신규 수강생 (기존/재등록 수강생 제외)
            const newNamesInSheet = new Set(
                (allStudents || [])
                    .filter(s => String(getStudentField(s, '신규/재등록') || '').trim() === '신규')
                    .map(s => s['이름'])
            );
            // 후보: 이 입학반에 아직 없고,
            //  - 승인됨: 시트에서 '신규'로 남아있는 사람만 (오래된 승인 문서가 남은 기존 수강생 제외)
            //  - 대기/미승인: 아직 시트에 없으니 그대로 후보
            const candidates = allRegs.filter(r => {
                if (!r.name) return false;
                if (r.entranceClassId === ec.id) return false;
                if (r.status === 'approved') return newNamesInSheet.has(r.name);
                return ['pending', 'waitlist'].includes(r.status);
            });
            setSheetNewStudents(candidates);
        } catch (err) {
            console.error('신청 목록 로드 실패:', err);
            alert('신청 목록을 불러오지 못했습니다.');
            setShowAddStudentModal(null);
        }
        setAddStudentLoading(false);
    };

    const handleToggleStudent = (regId) => {
        setSelectedNewStudents(prev => {
            const next = new Set(prev);
            if (next.has(regId)) next.delete(regId);
            else next.add(regId);
            return next;
        });
    };

    const handleAddStudentsToEntrance = async () => {
        const ec = showAddStudentModal;
        if (!ec) return;
        const selected = sheetNewStudents.filter(r => selectedNewStudents.has(r.id));
        const tempName = addTempName.trim();
        if (selected.length === 0 && !tempName) return;

        const remaining = (ec.maxCapacity || 0) - (ec.currentCount || 0);
        const adding = selected.length + (tempName ? 1 : 0);
        if (adding > remaining) {
            alert(`잔여 자리가 ${remaining}명입니다. ${adding}명을 추가할 수 없습니다.`);
            return;
        }

        const names = [...selected.map(s => s.name), ...(tempName ? [`${tempName}(임시)`] : [])].join(', ');
        if (!confirm(`${adding}명(${names})을 이 입학반에 추가하시겠습니까?`)) return;

        const ecClassDate = `${formatEntranceDate(ec.date)} ${ec.time || ''}${ec.endTime ? ' ~ ' + ec.endTime : ''}`.trim();
        const holidays = await getHolidays().catch(() => []);

        // 입학반 인원 한 명 차지 (DB 최신값 기준)
        const reserveSeat = async () => {
            const fresh = await getEntranceClasses(false);
            const ecFresh = fresh.find(c => c.id === ec.id);
            await updateEntranceClass(ec.id, { currentCount: (ecFresh?.currentCount || 0) + 1 });
        };

        try {
            for (const reg of selected) {
                if (reg.status === 'approved') {
                    // 승인된 사람: 시트 날짜 재계산 + 예약문자 재발송까지 (이전 입학반 인원 자동 정리)
                    await applyEntranceAssignment(reg, { kind: 'existing', ec }, holidays);
                } else {
                    // 미승인(대기 포함): 명단에만 올리고 자리 차지. 시트·문자 없음. 승인 시 중복카운트 방지 플래그.
                    if (reg.entranceClassId && reg.entranceClassId !== ec.id && reg.entranceCounted) {
                        const fresh = await getEntranceClasses(false);
                        const oldEc = fresh.find(c => c.id === reg.entranceClassId);
                        if (oldEc && (oldEc.currentCount || 0) > 0) {
                            await updateEntranceClass(oldEc.id, { currentCount: (oldEc.currentCount || 0) - 1 });
                        }
                    }
                    await updateNewStudentRegistration(reg.id, {
                        entranceClassId: ec.id, entranceDate: ec.date, entranceClassDate: ecClassDate, entranceCounted: true
                    });
                    await reserveSeat();
                }
            }

            // 목록에 없는 임시 이름: 메모용 문서(이름만). 문자/시트 없음, 자리만 차지.
            if (tempName) {
                await addDoc(collection(db, 'newStudentRegistrations'), {
                    name: tempName,
                    status: 'memo',
                    source: 'memo',
                    entranceClassId: ec.id,
                    entranceDate: ec.date,
                    entranceClassDate: ecClassDate,
                    entranceCounted: true,
                    createdAt: serverTimestamp()
                });
                await reserveSeat();
            }

            alert(`${adding}명이 입학반에 추가되었습니다.`);
            setShowAddStudentModal(null);
            setSheetNewStudents([]);
            setSelectedNewStudents(new Set());
            setAddTempName('');
            await loadEntranceClasses();
            await loadRegistrations();
            refreshSheets();
        } catch (err) {
            console.error('수강생 추가 실패:', err);
            alert('수강생 추가에 실패했습니다: ' + err.message);
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
                updateCalendarEvent(
                    editingEntrance.calendarEventId,
                    entranceForm.date,
                    entranceForm.time,
                    entranceForm.endTime
                );
            } else {
                const result = await createEntranceClass(entranceForm);
                const eventId = await createCalendarEvent(
                    entranceForm.date,
                    entranceForm.time,
                    entranceForm.endTime
                );
                if (eventId && result?.id) {
                    await updateEntranceClass(result.id, { calendarEventId: eventId });
                }
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
            deleteCalendarEvent(ec.calendarEventId);
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
                    {activeTab === 'registrations' && (
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
                    )}
                </header>

                {/* === 등록 목록 탭 === */}
                {activeTab === 'registrations' && (
                    <div className="cns-section">

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
                                            {reg.hasAvailableSlots && <span className="cns-badge" style={{ background: '#f59e0b', color: '#fff', fontWeight: 700 }}>여석 발생!</span>}
                                            {reg.wantsConsultation && <span className="cns-badge consult">상담</span>}
                                            {reg.question && <span className="cns-badge question">질문</span>}
                                            <span className="cns-expand-arrow">{collapsedRegs.has(reg.id) ? '▼' : '▲'}</span>
                                        </div>
                                    </div>

                                    {!collapsedRegs.has(reg.id) && (
                                        <div className="cns-reg-detail">
                                            <div className="cns-detail-grid">
                                                <div className="cns-detail-item">
                                                    <span className="cns-detail-label">시간표</span>
                                                    <span className="cns-detail-value">{formatScheduleDisplay(reg)}</span>
                                                </div>
                                                <div className="cns-detail-item">
                                                    <span className="cns-detail-label">연락처</span>
                                                    <span className="cns-detail-value">{reg.phone}</span>
                                                </div>
                                                <div className="cns-detail-item">
                                                    <span className="cns-detail-label">결제방식</span>
                                                    <span className="cns-detail-value">
                                                        {(() => {
                                                            // 승인된 수강생은 구글 시트의 결제 정보 확인
                                                            if (reg.status === 'approved') {
                                                                const sheetStudent = allStudents.find(s => (s['이름'] || getStudentField(s, '이름')) === reg.name);
                                                                if (sheetStudent) {
                                                                    const 결제일 = getStudentField(sheetStudent, '결제일');
                                                                    const 결제유무 = getStudentField(sheetStudent, '결제유무');
                                                                    const 결제방식 = getStudentField(sheetStudent, '결제방식');
                                                                    if (!결제일 && !결제유무 && !결제방식) {
                                                                        return <span style={{ color: '#dc2626', fontWeight: 700 }}>미결제</span>;
                                                                    }
                                                                    if (결제방식) return 결제방식;
                                                                }
                                                            }
                                                            return reg.paymentMethod === 'naver' ? '네이버' : reg.paymentMethod === 'card' ? '현장 카드 결제' : reg.paymentMethod === 'zeropay' ? '제로페이' : '현장 계좌 이체';
                                                        })()}
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
                                                {reg.entranceInquiry && (
                                                    <div className="cns-detail-item full">
                                                        <span className="cns-detail-label">입학반 날짜 문의</span>
                                                        <span className="cns-detail-value" style={{ color: '#dc2626' }}>
                                                            {formatEntranceDate(reg.entranceInquiry) || reg.entranceInquiry}
                                                            {reg.entranceInquiryReason && ` — ${reg.entranceInquiryReason}`}
                                                        </span>
                                                    </div>
                                                )}
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

                                            <div style={{ marginTop: '8px' }}>
                                                <SmsStatusChips reg={reg} onResend={handleResendSms} resendDisabledReason={resendDisabledReason} />
                                            </div>

                                            <div className="cns-action-row">
                                                {regFilter === 'pending' && (
                                                    <>
                                                        <button
                                                            className="cns-action-btn approve"
                                                            onClick={() => openEntranceModal(reg, 'approve')}
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
                                                            style={{ background: 'var(--accent)', color: '#fff', fontSize: '0.8rem' }}
                                                            onClick={() => handleEditSlotsOpen(reg)}
                                                        >
                                                            대기 시간표 편집
                                                        </button>
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
                                                {regFilter === 'approved' && (
                                                    <button
                                                        className="cns-action-btn"
                                                        style={{ background: 'var(--accent)', color: '#fff' }}
                                                        onClick={() => openEntranceModal(reg, 'edit')}
                                                    >
                                                        입학반 변경
                                                    </button>
                                                )}
                                                {regFilter === 'approved' && reg.phone && (
                                                    <button
                                                        className="cns-action-btn"
                                                        style={{ background: '#0d9488', color: '#fff' }}
                                                        onClick={() => openReminderModal(reg)}
                                                    >
                                                        문자예약 변경
                                                    </button>
                                                )}
                                                <button
                                                    className="cns-action-btn delete"
                                                    onClick={() => regFilter === 'waitlist' ? handleWaitlistDelete(reg) : handleDelete(reg)}
                                                >
                                                    삭제
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );

                            // SMS 누락 요약 배너
                            const smsSummaryBanner = (() => {
                                const issues = registrations.reduce((sum, r) => sum + smsIssueCount(r), 0);
                                return (
                                    <div style={{
                                        margin: '0 0 12px', padding: '10px 14px', borderRadius: 'var(--r-md)',
                                        background: issues > 0 ? '#F8D2D5' : '#C9E8D2',
                                        color: issues > 0 ? '#991b1b' : '#166534', fontWeight: 600, fontSize: '0.9rem',
                                    }}>
                                        {issues > 0 ? `⚠ 자동 문자 누락/실패 ${issues}건 — 아래에서 재발송하세요` : '✅ 자동 문자 누락/실패 없음'}
                                    </div>
                                );
                            })();

                            // 승인됨 필터: 입학반별 그룹 표시
                            if (regFilter === 'approved') {
                                const groups = {};
                                registrations.forEach(reg => {
                                    const key = reg.entranceDate || 'none';
                                    // 입학반 미지정 그룹: 코치 직접 등록(재등록 포함) 제외, 신규 신청만 표시
                                    if (key === 'none' && reg.registeredByCoach) return;
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
                                        {smsSummaryBanner}
                                        {sortedKeys.map(key => (
                                            <div key={key}>
                                                <div className="cns-group-header">
                                                    <span className="cns-group-title">
                                                        {key === 'none' ? '입학반 미지정' : formatEntranceDate(key)}
                                                    </span>
                                                    <span className="cns-group-count">{groups[key].length}명</span>
                                                </div>
                                                <div className="cns-reg-list">
                                                    {groups[key].map(renderRegCard)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            }

                            // 기본 렌더링
                            return (
                                <div className="cns-reg-list">
                                    {smsSummaryBanner}
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
                        ) : (() => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const upcoming = [];
                            const past = [];
                            for (const ec of entranceClasses) {
                                if (!ec.date) { upcoming.push(ec); continue; }
                                const ecDate = new Date(ec.date + 'T23:59:59');
                                if (ecDate < today) past.push(ec);
                                else upcoming.push(ec);
                            }
                            upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                            past.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

                            const renderEcCard = (ec) => (
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
                                                    {ecRegs.map(r => {
                                                        // 결제 상태 점: 결제유무 O + 결제일 기록 있음 → 녹색, 그 외(미결제/결제일 없음) → 적색
                                                        const sheetStudent = allStudents.find(s => (s['이름'] || getStudentField(s, '이름')) === r.name);
                                                        const 결제유무 = sheetStudent ? String(getStudentField(sheetStudent, '결제유무') || '').trim().toUpperCase() : '';
                                                        const 결제일 = sheetStudent ? String(getStudentField(sheetStudent, '결제일') || '').trim() : '';
                                                        const isPaid = 결제유무 === 'O' && 결제일 !== '';
                                                        return (
                                                        <span key={r.id} className={`cns-entrance-student-tag ${r.status}`}>
                                                            <span className={`cns-pay-dot ${isPaid ? 'paid' : 'unpaid'}`} title={isPaid ? '결제완료' : '미결제'} />
                                                            {r.name}
                                                            {r.status === 'pending' && <small>(미승인)</small>}
                                                            {r.status === 'memo' && <small>(메모)</small>}
                                                            <button
                                                                className="cns-entrance-student-remove"
                                                                onClick={() => handleDeleteFromEntrance(r, ec)}
                                                                title="삭제"
                                                            >×</button>
                                                        </span>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    <div className="cns-entrance-actions">
                                        <button
                                            className="cns-icon-btn add"
                                            onClick={() => handleOpenAddStudent(ec)}
                                            title="수강생 추가"
                                        >
                                            +
                                        </button>
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
                            );

                            return (
                                <>
                                    <div className="cns-entrance-list">
                                        {upcoming.length === 0 ? (
                                            <div className="cns-empty">다가오는 입학반이 없습니다.</div>
                                        ) : upcoming.map(renderEcCard)}
                                    </div>
                                    {past.length > 0 && (
                                        <div className="cns-past-entrance-section">
                                            <button
                                                className="cns-past-entrance-toggle"
                                                onClick={() => setShowPastEntrance(v => !v)}
                                            >
                                                {showPastEntrance ? '▲' : '▼'} 지난 입학반 ({past.length})
                                            </button>
                                            {showPastEntrance && (
                                                <div className="cns-entrance-list past">
                                                    {past.map(renderEcCard)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            );
                        })()}

                        {/* 수강생 수동 추가 모달 */}
                        {showAddStudentModal && (
                            <div className="cns-modal-overlay" onClick={() => { setShowAddStudentModal(null); setSheetNewStudents([]); setSelectedNewStudents(new Set()); }}>
                                <div className="cns-modal" onClick={(e) => e.stopPropagation()}>
                                    <h3>수강생 추가</h3>
                                    <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                                        {formatEntranceDate(showAddStudentModal.date)} 입학반에 추가할 사람을 선택하세요. (승인됨은 시트 날짜·예약문자도 자동 반영)
                                    </p>
                                    {addStudentLoading ? (
                                        <div className="cns-loading">불러오는 중...</div>
                                    ) : sheetNewStudents.length === 0 ? (
                                        <div className="cns-empty">추가 가능한 신청이 없습니다.</div>
                                    ) : (
                                        <div className="cns-add-student-list">
                                            {sheetNewStudents.map(s => {
                                                const statusLabel = s.status === 'approved' ? '승인됨' : s.status === 'waitlist' ? '대기' : '미승인';
                                                return (
                                                    <div
                                                        key={s.id}
                                                        className={`cns-add-student-item${selectedNewStudents.has(s.id) ? ' selected' : ''}`}
                                                        onClick={() => handleToggleStudent(s.id)}
                                                    >
                                                        <div className="cns-add-student-check">
                                                            {selectedNewStudents.has(s.id) ? '✓' : ''}
                                                        </div>
                                                        <div>
                                                            <div className="cns-add-student-name">
                                                                {s.name} <small style={{ color: s.status === 'approved' ? '#166534' : '#92400e', fontWeight: 600 }}>[{statusLabel}]</small>
                                                            </div>
                                                            <div className="cns-add-student-info">
                                                                주{s.weeklyFrequency || '-'}회 · {s.scheduleString || '시간표 미정'}
                                                                {s.entranceClassId && s.entranceDate ? ` · 현재 입학반 ${formatEntranceDate(s.entranceDate)}` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <div className="cns-form-field" style={{ marginTop: '12px' }}>
                                        <label>목록에 없는 사람 — 이름만 임시 등록 (메모용, 문자·시트 없음)</label>
                                        <input
                                            type="text"
                                            value={addTempName}
                                            onChange={(e) => setAddTempName(e.target.value)}
                                            placeholder="이름 입력"
                                            className="cns-form-input"
                                        />
                                    </div>
                                    <div className="cns-modal-actions">
                                        <button
                                            className="cns-modal-btn cancel"
                                            onClick={() => { setShowAddStudentModal(null); setSheetNewStudents([]); setSelectedNewStudents(new Set()); setAddTempName(''); }}
                                        >
                                            취소
                                        </button>
                                        <button
                                            className="cns-modal-btn"
                                            style={{ background: '#10b981', color: '#fff' }}
                                            onClick={() => {
                                                const ec = showAddStudentModal;
                                                setShowAddStudentModal(null);
                                                setSheetNewStudents([]);
                                                setSelectedNewStudents(new Set());
                                                setAddTempName('');
                                                setDirectRegEntrance(ec);
                                            }}
                                        >
                                            + 직접 등록
                                        </button>
                                        <button
                                            className="cns-modal-btn save"
                                            onClick={handleAddStudentsToEntrance}
                                            disabled={selectedNewStudents.size === 0 && !addTempName.trim()}
                                        >
                                            추가 ({selectedNewStudents.size + (addTempName.trim() ? 1 : 0)}명)
                                        </button>
                                    </div>
                                </div>
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
                                        <select
                                            value={entranceForm.time}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, time: e.target.value })}
                                            className="cns-form-input"
                                        >
                                            <option value="">선택</option>
                                            {Array.from({ length: 28 }, (_, i) => {
                                                const h = Math.floor(i / 2) + 7;
                                                const m = i % 2 === 0 ? '00' : '30';
                                                const val = `${String(h).padStart(2, '0')}:${m}`;
                                                return <option key={val} value={val}>{val}</option>;
                                            })}
                                        </select>
                                    </div>
                                    <div className="cns-form-field">
                                        <label>종료 시간</label>
                                        <select
                                            value={entranceForm.endTime || ''}
                                            onChange={(e) => setEntranceForm({ ...entranceForm, endTime: e.target.value })}
                                            className="cns-form-input"
                                        >
                                            <option value="">선택</option>
                                            {Array.from({ length: 28 }, (_, i) => {
                                                const h = Math.floor(i / 2) + 7;
                                                const m = i % 2 === 0 ? '00' : '30';
                                                const val = `${String(h).padStart(2, '0')}:${m}`;
                                                return <option key={val} value={val}>{val}</option>;
                                            })}
                                        </select>
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
            {waitlistApproveReg && (() => {
                const freq = waitlistApproveReg.weeklyFrequency || 2;
                const reqSlots = waitlistApproveReg.requestedSlots || [];
                return (
                    <div className="cns-modal-overlay" onClick={() => setWaitlistApproveReg(null)}>
                        <div className="cns-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                            <h3>수강 승인</h3>
                            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '12px' }}>
                                "{waitlistApproveReg.name}" - 주{freq}회 중 {waitlistSelectedSlots.length}개 선택됨
                            </p>

                            {/* 시간표 선택 그리드 */}
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px', display: 'block' }}>
                                    최종 시간표 선택 ({waitlistSelectedSlots.length}/{freq})
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${DAYS.length}, 1fr)`, gap: '2px', fontSize: '0.75rem' }}>
                                    <div></div>
                                    {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontWeight: 600, padding: '4px' }}>{d}</div>)}
                                    {PERIODS.filter(p => p.type !== 'free').map(period => (
                                        <div key={period.id} style={{ display: 'contents' }}>
                                            <div style={{ fontSize: '0.7rem', padding: '4px 2px', color: '#666' }}>{period.name}</div>
                                            {DAYS.map(day => {
                                                const key = `${day}-${period.id}`;
                                                const isDisabled = disabledClasses.includes(key);
                                                const occ = slotOccupancy[key] || 0;
                                                const isFull = occ >= MAX_CAPACITY;
                                                const isRequested = reqSlots.some(s => s.day === day && s.period === period.id);
                                                const isSelected = waitlistSelectedSlots.some(s => s.day === day && s.period === period.id);
                                                const canSelect = !isDisabled && isRequested && (isSelected || waitlistSelectedSlots.length < freq);

                                                return (
                                                    <div
                                                        key={key}
                                                        onClick={() => {
                                                            if (!canSelect && !isSelected) return;
                                                            if (isSelected) {
                                                                setWaitlistSelectedSlots(prev => prev.filter(s => !(s.day === day && s.period === period.id)));
                                                            } else if (waitlistSelectedSlots.length < freq) {
                                                                setWaitlistSelectedSlots(prev => [...prev, { day, period: period.id }]);
                                                            }
                                                        }}
                                                        style={{
                                                            padding: '6px 2px',
                                                            textAlign: 'center',
                                                            borderRadius: '4px',
                                                            cursor: canSelect || isSelected ? 'pointer' : 'default',
                                                            border: isSelected ? '2px solid #16a34a' : isRequested ? '1px solid #d97706' : '1px solid #e5e7eb',
                                                            backgroundColor: isDisabled ? '#f3f4f6' : isSelected ? '#dcfce7' : isRequested ? (isFull ? '#fef3c7' : '#fffbeb') : '#fff',
                                                            color: isDisabled ? '#9ca3af' : isSelected ? '#16a34a' : '#333',
                                                            fontWeight: isSelected ? 700 : 400,
                                                            opacity: !isRequested && !isDisabled ? 0.4 : 1
                                                        }}
                                                    >
                                                        {isDisabled ? '-' : isFull ? (isSelected ? '✓' : '만석') : (isSelected ? '✓' : `${MAX_CAPACITY - occ}`)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                                <p style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '6px' }}>
                                    테두리 표시된 셀 = 학생이 선택한 가능 시간
                                </p>
                            </div>

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
                                <button className="cns-modal-btn cancel" onClick={() => { setWaitlistApproveReg(null); setWaitlistSelectedSlots([]); }}>취소</button>
                                <button
                                    className="cns-modal-btn save"
                                    onClick={handleWaitlistApproveConfirm}
                                    disabled={waitlistSelectedSlots.length !== freq}
                                >
                                    승인 ({waitlistSelectedSlots.length}/{freq})
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* === 입학반 선택/변경 모달 === */}
            {entranceModal && (() => {
                const { reg, mode } = entranceModal;
                const requestLabel = reg.entranceClassDate
                    || (reg.entranceInquiry ? `${formatEntranceDate(reg.entranceInquiry)} (문의 날짜)` : '미지정');
                return (
                    <div className="cns-modal-overlay" onClick={() => !entSaving && setEntranceModal(null)}>
                        <div className="cns-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
                            <h3>{mode === 'approve' ? '입학반 선택 후 승인' : '입학반 변경'}</h3>
                            <p style={{ fontSize: '0.9rem', color: '#666', margin: '4px 0 14px' }}>
                                "{reg.name}" — 현재 입학반: <b>{requestLabel}</b>
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                                {mode === 'approve' && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                        <input type="radio" name="entKind" checked={entKind === 'request'} onChange={() => setEntKind('request')} />
                                        요청한 입학반 그대로 ({requestLabel})
                                    </label>
                                )}

                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                    <input type="radio" name="entKind" checked={entKind === 'existing'} onChange={() => setEntKind('existing')} />
                                    기존 입학반으로 변경
                                </label>
                                {entKind === 'existing' && (
                                    <select
                                        value={entEcId}
                                        onChange={(e) => setEntEcId(e.target.value)}
                                        className="cns-form-input"
                                        style={{ marginLeft: '24px', width: 'calc(100% - 24px)' }}
                                    >
                                        <option value="">입학반을 선택하세요</option>
                                        {entranceClasses.filter(ec => ec.isActive).map(ec => (
                                            <option key={ec.id} value={ec.id}>
                                                {formatEntranceDate(ec.date)} {ec.time}{ec.endTime ? ` ~ ${ec.endTime}` : ''} ({ec.currentCount || 0}/{ec.maxCapacity}명)
                                            </option>
                                        ))}
                                    </select>
                                )}

                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                    <input type="radio" name="entKind" checked={entKind === 'new'} onChange={() => setEntKind('new')} />
                                    새 날짜로 입학반 생성 (10:00 ~ 13:00)
                                </label>
                                {entKind === 'new' && (
                                    <input
                                        type="date"
                                        value={entDate}
                                        onChange={(e) => setEntDate(e.target.value)}
                                        className="cns-form-input"
                                        style={{ marginLeft: '24px', width: 'calc(100% - 24px)' }}
                                    />
                                )}
                            </div>

                            {mode === 'edit' && (
                                <p style={{ fontSize: '0.78rem', color: '#92400e', marginBottom: '12px', lineHeight: 1.5 }}>
                                    변경 시 시트의 시작/종료날짜가 재계산되고, 예약된 입학반 리마인더 문자도 새 날짜로 다시 예약됩니다.
                                </p>
                            )}

                            <div className="cns-modal-actions">
                                <button className="cns-modal-btn cancel" disabled={entSaving} onClick={() => setEntranceModal(null)}>취소</button>
                                <button className="cns-modal-btn save" disabled={entSaving} onClick={handleEntranceModalConfirm}>
                                    {entSaving ? '처리 중...' : (mode === 'approve' ? '이 입학반으로 승인' : '변경 저장')}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* === 입학반 리마인더 예약 변경 모달 === */}
            {reminderModal && (
                <div className="cns-modal-overlay" onClick={() => !entSaving && setReminderModal(null)}>
                    <div className="cns-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <h3>입학반 리마인더 예약 변경</h3>
                        <p style={{ fontSize: '0.9rem', color: '#666', margin: '4px 0 12px' }}>
                            "{reminderModal.name}" — 입학반: <b>{reminderModal.entranceClassDate || formatEntranceDate(reminderModal.entranceDate)}</b>
                        </p>
                        <div className="cns-form-field">
                            <label>예약 발송 시각</label>
                            <input
                                type="datetime-local"
                                value={reminderAt}
                                onChange={(e) => setReminderAt(e.target.value)}
                                className="cns-form-input"
                            />
                        </div>
                        <p style={{ fontSize: '0.78rem', color: '#92400e', margin: '8px 0 4px', lineHeight: 1.5 }}>
                            기존 예약을 취소하고 이 시각으로 다시 예약합니다. 시각이 임박/경과했으면 즉시 발송됩니다.
                        </p>
                        <div className="cns-modal-actions">
                            <button className="cns-modal-btn cancel" disabled={entSaving} onClick={() => setReminderModal(null)}>취소</button>
                            <button className="cns-modal-btn save" disabled={entSaving} onClick={handleReminderReschedule}>
                                {entSaving ? '처리 중...' : '예약 변경'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* === 시간표 편집 모달 === */}
            {editSlotsReg && (
                <div className="cns-modal-overlay" onClick={() => setEditSlotsReg(null)}>
                    <div className="cns-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <h3>시간표 편집</h3>
                        <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '12px' }}>
                            "{editSlotsReg.name}" - 주{editSlotsReg.weeklyFrequency}회 | {editSlots.length}개 선택됨
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${DAYS.length}, 1fr)`, gap: '2px', fontSize: '0.75rem' }}>
                            <div></div>
                            {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontWeight: 600, padding: '4px' }}>{d}</div>)}
                            {PERIODS.filter(p => p.type !== 'free').map(period => (
                                <div key={period.id} style={{ display: 'contents' }}>
                                    <div style={{ fontSize: '0.7rem', padding: '4px 2px', color: '#666' }}>{period.name}</div>
                                    {DAYS.map(day => {
                                        const key = `${day}-${period.id}`;
                                        const isDisabled = disabledClasses.includes(key);
                                        const occ = slotOccupancy[key] || 0;
                                        const remaining = MAX_CAPACITY - occ;
                                        const isFull = remaining <= 0;
                                        const isSelected = editSlots.some(s => s.day === day && s.period === period.id);

                                        return (
                                            <div
                                                key={key}
                                                onClick={() => { if (!isDisabled) handleEditSlotToggle(day, period.id); }}
                                                style={{
                                                    padding: '6px 2px',
                                                    textAlign: 'center',
                                                    borderRadius: '4px',
                                                    cursor: isDisabled ? 'default' : 'pointer',
                                                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--hairline)',
                                                    backgroundColor: isDisabled ? 'var(--canvas-tint)' : isSelected ? 'var(--accent-10)' : isFull ? '#fef3c7' : '#fff',
                                                    color: isDisabled ? 'var(--text-muted)' : isSelected ? 'var(--accent)' : isFull ? '#92400e' : '#333',
                                                    fontWeight: isSelected ? 700 : 400
                                                }}
                                            >
                                                {isDisabled ? '-' : isSelected ? '✓' : isFull ? '마감' : remaining}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '8px' }}>
                            마감된 시간도 선택 가능합니다. 자유롭게 편집하세요.
                        </p>
                        <div className="cns-modal-actions" style={{ marginTop: '16px' }}>
                            <button className="cns-modal-btn cancel" onClick={() => setEditSlotsReg(null)}>취소</button>
                            <button className="cns-modal-btn save" onClick={handleEditSlotsSave}>저장</button>
                        </div>
                    </div>
                </div>
            )}

            {/* === 입학반 컨텍스트에서 열린 직접 등록 모달 === */}
            {directRegEntrance && (
                <StudentRegistrationModal
                    onClose={() => setDirectRegEntrance(null)}
                    onSuccess={async () => {
                        setDirectRegEntrance(null);
                        await loadEntranceClasses();
                    }}
                    initialEntranceId={directRegEntrance.id}
                />
            )}
        </div>
    );
};

export default CoachNewStudents;
