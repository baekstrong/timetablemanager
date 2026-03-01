import { useState, useEffect, useMemo } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getDisabledClasses, createNewStudentRegistration, getEntranceClasses, getFAQs, getNewStudentRegistrations } from '../services/firebaseService';
import { sendRegistrationNotifications } from '../services/smsService';
import { PERIODS, DAYS, MAX_CAPACITY, PRICING, ENTRANCE_FEE } from '../data/mockData';
import './NewStudentRegistration.css';

/**
 * Parse schedule string from Google Sheets
 * Examples: "월5수5" → [{day: '월', period: 5}, {day: '수', period: 5}]
 */
const parseScheduleString = (scheduleStr) => {
    if (!scheduleStr || typeof scheduleStr !== 'string') return [];
    const result = [];
    const dayMap = { '월': '월', '화': '화', '수': '수', '목': '목', '금': '금' };
    const chars = scheduleStr.replace(/\s/g, '');
    let i = 0;
    while (i < chars.length) {
        const char = chars[i];
        if (dayMap[char]) {
            const day = char;
            i++;
            let periodStr = '';
            while (i < chars.length && /\d/.test(chars[i])) {
                periodStr += chars[i];
                i++;
            }
            if (periodStr) {
                const period = parseInt(periodStr);
                if (period >= 1 && period <= 6) {
                    result.push({ day, period });
                }
            }
        } else {
            i++;
        }
    }
    return result;
};

/**
 * Format date string: "2026-02-21" → "2026년 2월 21일(토)"
 */
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

const STEP_NAMES = ['가입', '주 횟수', '시간표', '입학반', '결제', '상담', '확인'];

const NewStudentRegistration = () => {
    const [step, setStep] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // Step 1: 개인정보
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [phone1, setPhone1] = useState('010');
    const [phone2, setPhone2] = useState('');
    const [phone3, setPhone3] = useState('');
    const [gender, setGender] = useState('');
    const [occupation, setOccupation] = useState('');
    const [healthIssues, setHealthIssues] = useState('');
    const [exerciseGoal, setExerciseGoal] = useState('');

    // Step 2: 주횟수
    const [weeklyFrequency, setWeeklyFrequency] = useState(null);
    const [baseCost, setBaseCost] = useState(0);

    // Step 3: 시간표
    const [selectedSlots, setSelectedSlots] = useState([]);
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [pendingRegistrations, setPendingRegistrations] = useState([]);
    const { students, refresh } = useGoogleSheets();

    // 마운트 시 Google Sheets 데이터 최신화 (코치 시간표와 동일한 데이터 보장)
    useEffect(() => {
        refresh();
    }, []);

    // Step 4: 입학반
    const [entranceClasses, setEntranceClasses] = useState([]);
    const [selectedEntrance, setSelectedEntrance] = useState(null);

    // Step 5: 결제
    const [paymentMethod, setPaymentMethod] = useState('');

    // Step 6: 상담
    const [wantsConsultation, setWantsConsultation] = useState(false);

    // Step 7: FAQ + 질문
    const [faqs, setFaqs] = useState([]);
    const [question, setQuestion] = useState('');
    const [expandedFaq, setExpandedFaq] = useState(null);

    // Load disabled classes
    useEffect(() => {
        getDisabledClasses().then(setDisabledClasses).catch(() => {});
    }, []);

    // Load pending registrations to reflect their slots in occupancy
    useEffect(() => {
        getNewStudentRegistrations('pending')
            .then(setPendingRegistrations)
            .catch(() => {});
    }, []);

    // Load entrance classes when reaching step 4 (날짜가 지난 입학반 제외)
    useEffect(() => {
        if (step >= 3) {
            getEntranceClasses(true).then(classes => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const activeClasses = classes.filter(ec => {
                    if (!ec.date) return true;
                    const ecDate = new Date(ec.date + 'T23:59:59');
                    return ecDate >= today;
                });
                setEntranceClasses(activeClasses);
            }).catch(() => {});
        }
    }, [step]);

    // Load FAQs when reaching step 7
    useEffect(() => {
        if (step >= 6) {
            getFAQs(true).then(setFaqs).catch(() => {});
        }
    }, [step]);

    // Compute slot occupancy from Google Sheets data + pending registrations
    // 코치 시간표(transformGoogleSheetsData)와 동일하게 학생 이름 기준 중복 제거
    const slotOccupancy = useMemo(() => {
        const occupancy = {};
        const namesPerSlot = {}; // 슬롯별 학생 이름 Set (중복 방지)

        // 1. Google Sheets 학생 카운트 (이름 기준 중복 제거)
        if (students && students.length > 0) {
            students.forEach((student) => {
                const studentName = student['이름'];
                const scheduleStr = student['요일 및 시간'];
                if (!studentName || !scheduleStr) return;

                const schedules = parseScheduleString(scheduleStr);
                schedules.forEach(({ day, period }) => {
                    const key = `${day}-${period}`;
                    if (!namesPerSlot[key]) namesPerSlot[key] = new Set();
                    namesPerSlot[key].add(studentName);
                });
            });
        }

        // 2. pending 등록의 requestedSlots 카운트 추가
        pendingRegistrations.forEach(reg => {
            if (!reg.requestedSlots || !reg.name) return;
            reg.requestedSlots.forEach(({ day, period }) => {
                const key = `${day}-${period}`;
                if (!namesPerSlot[key]) namesPerSlot[key] = new Set();
                namesPerSlot[key].add(`__pending__${reg.name}`);
            });
        });

        // Set size → occupancy count
        Object.keys(namesPerSlot).forEach(key => {
            occupancy[key] = namesPerSlot[key].size;
        });

        return occupancy;
    }, [students, pendingRegistrations]);

    const handleSlotToggle = (day, period) => {
        const key = `${day}-${period}`;
        const exists = selectedSlots.find(s => s.day === day && s.period === period);

        if (exists) {
            setSelectedSlots(selectedSlots.filter(s => !(s.day === day && s.period === period)));
        } else {
            if (selectedSlots.length >= weeklyFrequency) return;
            setSelectedSlots([...selectedSlots, { day, period }]);
        }
    };

    const getScheduleString = () => {
        return selectedSlots
            .sort((a, b) => {
                const dayOrder = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
                return dayOrder !== 0 ? dayOrder : a.period - b.period;
            })
            .map(s => `${s.day}${s.period}`)
            .join('');
    };

    const entranceCost = ENTRANCE_FEE;
    const totalCost = baseCost + entranceCost;

    const canProceed = () => {
        switch (step) {
            case 0: return name.trim() && password.trim() && phone1.trim() && phone2.trim() && phone3.trim();
            case 1: return weeklyFrequency !== null;
            case 2: return selectedSlots.length === weeklyFrequency;
            case 3: return selectedEntrance !== null;
            case 4: return paymentMethod !== '';
            case 5: return true;
            case 6: return true;
            default: return false;
        }
    };

    const handleSubmit = async () => {
        if (submitting) return;
        setSubmitting(true);

        try {
            const entranceClass = entranceClasses.find(c => c.id === selectedEntrance);
            const phoneStr = `${phone1.trim()}-${phone2.trim()}-${phone3.trim()}`;
            const data = {
                name: name.trim(),
                password: password.trim(),
                phone: phoneStr,
                gender: gender,
                occupation: occupation.trim(),
                healthIssues: healthIssues.trim(),
                exerciseGoal: exerciseGoal.trim(),
                weeklyFrequency,
                baseCost,
                requestedSlots: selectedSlots,
                scheduleString: getScheduleString(),
                entranceClassId: selectedEntrance,
                entranceDate: entranceClass ? entranceClass.date : '',
                entranceClassDate: entranceClass ? `${formatEntranceDate(entranceClass.date)} ${entranceClass.time}${entranceClass.endTime ? ' ~ ' + entranceClass.endTime : ''}` : '',
                entranceCost,
                totalCost,
                paymentMethod,
                wantsConsultation,
                question: question.trim()
            };

            await createNewStudentRegistration(data);

            // 안내 문자 발송 (수강생 SMS 1 + 코치 SMS 1)
            // 실패해도 등록에 영향을 주지 않음
            try {
                const smsResults = await sendRegistrationNotifications(phoneStr, name.trim(), {
                    weeklyFrequency,
                    scheduleString: getScheduleString(),
                    paymentMethod,
                    entranceClassDate: data.entranceClassDate,
                    wantsConsultation
                });
                if (!smsResults.studentSMS || !smsResults.coachSMS) {
                    const failed = [];
                    if (!smsResults.studentSMS) failed.push('수강생');
                    if (!smsResults.coachSMS) failed.push('코치');
                    console.warn(`안내 문자 발송 실패: ${failed.join(', ')}`);
                }
            } catch (smsError) {
                console.error('안내 문자 발송 중 오류:', smsError);
            }

            setSubmitted(true);
        } catch (error) {
            alert('등록에 실패했습니다: ' + error.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="reg-wizard">
                <div className="reg-wizard-inner">
                    <div className="reg-success">
                        <div className="reg-success-icon">✓</div>
                        <h2>등록이 완료되었습니다!</h2>
                        <p>코치의 승인 후 안내 문자가 발송될 예정입니다.</p>
                        <p className="reg-success-info">
                            아이디: <strong>{name}</strong>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="reg-wizard">
            <div className="reg-wizard-inner">
                {/* Header */}
                <div className="reg-header">
                    <h1 className="reg-title">근력학교 등록</h1>
                    <div className="reg-steps">
                        {STEP_NAMES.map((s, i) => (
                            <div key={i} className={`reg-step-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
                                <span>{i < step ? '✓' : i + 1}</span>
                            </div>
                        ))}
                    </div>
                    <p className="reg-step-label">{STEP_NAMES[step]}</p>
                </div>

                {/* Step Content */}
                <div className="reg-body">
                    {/* Step 1: 가입 */}
                    {step === 0 && (
                        <div className="reg-step-content">
                            <p className="reg-description" style={{ backgroundColor: '#eff6ff', color: '#1e40af', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', lineHeight: '1.5' }}>
                                이곳에 입력한 이름과 비밀번호는 정규 수업 시 로그인 아이디와 비밀번호로 사용됩니다
                            </p>
                            <div className="reg-field">
                                <label>이름 <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="이름을 입력하세요"
                                    className="reg-input"
                                />
                            </div>
                            <div className="reg-field">
                                <label>비밀번호 <span className="required">*</span></label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="비밀번호를 설정하세요"
                                    className="reg-input"
                                />
                            </div>
                            <div className="reg-field">
                                <label>연락처 <span className="required">*</span></label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type="tel"
                                        value={phone1}
                                        onChange={(e) => setPhone1(e.target.value.replace(/\D/g, '').slice(0, 3))}
                                        className="reg-input"
                                        style={{ width: '70px', textAlign: 'center' }}
                                        maxLength={3}
                                    />
                                    <span>-</span>
                                    <input
                                        type="tel"
                                        value={phone2}
                                        onChange={(e) => setPhone2(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                        placeholder="0000"
                                        className="reg-input"
                                        style={{ flex: 1, textAlign: 'center' }}
                                        maxLength={4}
                                    />
                                    <span>-</span>
                                    <input
                                        type="tel"
                                        value={phone3}
                                        onChange={(e) => setPhone3(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                        placeholder="0000"
                                        className="reg-input"
                                        style={{ flex: 1, textAlign: 'center' }}
                                        maxLength={4}
                                    />
                                </div>
                            </div>
                            <div className="reg-field">
                                <label>성별 (선택)</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {['남', '여'].map(g => (
                                        <button
                                            key={g}
                                            type="button"
                                            className={`reg-input ${gender === g ? 'selected' : ''}`}
                                            style={{
                                                flex: 1,
                                                textAlign: 'center',
                                                cursor: 'pointer',
                                                backgroundColor: gender === g ? '#4f46e5' : '#fff',
                                                color: gender === g ? '#fff' : '#333',
                                                border: gender === g ? '2px solid #4f46e5' : '1px solid #ddd',
                                                borderRadius: '8px',
                                                padding: '10px',
                                                fontSize: '1rem'
                                            }}
                                            onClick={() => setGender(gender === g ? '' : g)}
                                        >
                                            {g}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="reg-field">
                                <label>직업 (선택)</label>
                                <input
                                    type="text"
                                    value={occupation}
                                    onChange={(e) => setOccupation(e.target.value)}
                                    placeholder="직업을 입력하세요"
                                    className="reg-input"
                                />
                            </div>
                            <div className="reg-field">
                                <label>불편한 곳 (선택)</label>
                                <input
                                    type="text"
                                    value={healthIssues}
                                    onChange={(e) => setHealthIssues(e.target.value)}
                                    placeholder="허리 디스크, 무릎 등"
                                    className="reg-input"
                                />
                            </div>
                            <div className="reg-field">
                                <label>운동 목적 (선택)</label>
                                <input
                                    type="text"
                                    value={exerciseGoal}
                                    onChange={(e) => setExerciseGoal(e.target.value)}
                                    placeholder="체력 향상, 다이어트 등"
                                    className="reg-input"
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: 주 횟수 */}
                    {step === 1 && (
                        <div className="reg-step-content">
                            <p className="reg-description">주 몇 회 수업을 원하시나요?</p>
                            <div className="reg-freq-cards">
                                {PRICING.map((p) => (
                                    <div
                                        key={p.frequency}
                                        className={`reg-freq-card ${weeklyFrequency === p.frequency ? 'selected' : ''}`}
                                        onClick={() => {
                                            setWeeklyFrequency(p.frequency);
                                            setBaseCost(p.baseCost);
                                            setSelectedSlots([]);
                                        }}
                                    >
                                        <div className="reg-freq-label">{p.label}</div>
                                        <div className="reg-freq-cost">{p.baseCost.toLocaleString()}원</div>
                                        <div className="reg-freq-total">
                                            입학반 비용 포함 {p.totalWithEntrance.toLocaleString()}원
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 3: 시간표 */}
                    {step === 2 && (
                        <div className="reg-step-content">
                            <p className="reg-description">
                                원하는 시간을 {weeklyFrequency}개 선택하세요
                                <span className="reg-slot-count">
                                    ({selectedSlots.length}/{weeklyFrequency})
                                </span>
                            </p>
                            <div className="reg-schedule-grid">
                                <div className="reg-grid-header">
                                    <div className="reg-grid-corner"></div>
                                    {DAYS.map(day => (
                                        <div key={day} className="reg-grid-day">{day}</div>
                                    ))}
                                </div>
                                {PERIODS.filter(p => p.type !== 'free').map(period => (
                                    <div key={period.id} className="reg-grid-row">
                                        <div className="reg-grid-period">
                                            <span className="reg-period-name">{period.name}</span>
                                            <span className="reg-period-time">{period.time}</span>
                                        </div>
                                        {DAYS.map(day => {
                                            const key = `${day}-${period.id}`;
                                            const isDisabled = disabledClasses.includes(key);
                                            const count = slotOccupancy[key] || 0;
                                            const remaining = MAX_CAPACITY - count;
                                            const isFull = remaining <= 0;
                                            const isSelected = selectedSlots.some(
                                                s => s.day === day && s.period === period.id
                                            );
                                            const canSelect = !isDisabled && !isFull && (isSelected || selectedSlots.length < weeklyFrequency);

                                            return (
                                                <div
                                                    key={key}
                                                    className={`reg-grid-cell ${isDisabled ? 'disabled' : ''} ${isFull ? 'full' : ''} ${isSelected ? 'selected' : ''} ${!canSelect && !isSelected ? 'locked' : ''}`}
                                                    onClick={() => {
                                                        if (isDisabled || isFull) return;
                                                        handleSlotToggle(day, period.id);
                                                    }}
                                                >
                                                    {isDisabled ? (
                                                        <span className="reg-cell-text">-</span>
                                                    ) : isFull ? (
                                                        <span className="reg-cell-text full-text">마감</span>
                                                    ) : (
                                                        <span className="reg-cell-text">{remaining}석</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 4: 입학반 */}
                    {step === 3 && (
                        <div className="reg-step-content">
                            <p className="reg-description">입학반 일정을 선택하세요</p>
                            <div className="reg-entrance-info">
                                <div className="reg-cost-row">
                                    <span>수업료 ({PRICING.find(p => p.frequency === weeklyFrequency)?.label})</span>
                                    <span>{baseCost.toLocaleString()}원</span>
                                </div>
                                <div className="reg-cost-row">
                                    <span>입학반 비용</span>
                                    <span>{entranceCost.toLocaleString()}원</span>
                                </div>
                                <div className="reg-cost-row total">
                                    <span>총 비용</span>
                                    <span>{totalCost.toLocaleString()}원</span>
                                </div>
                            </div>
                            {entranceClasses.length === 0 ? (
                                <div className="reg-empty">현재 열려있는 입학반이 없습니다.</div>
                            ) : (
                                <div className="reg-entrance-list">
                                    {entranceClasses.map(ec => (
                                        <div
                                            key={ec.id}
                                            className={`reg-entrance-card ${selectedEntrance === ec.id ? 'selected' : ''} ${ec.currentCount >= ec.maxCapacity ? 'full' : ''}`}
                                            onClick={() => {
                                                if (ec.currentCount >= ec.maxCapacity) return;
                                                setSelectedEntrance(ec.id);
                                            }}
                                        >
                                            <div className="reg-entrance-date">{formatEntranceDate(ec.date)}</div>
                                            <div className="reg-entrance-time">{ec.time}{ec.endTime ? ` ~ ${ec.endTime}` : ''}</div>
                                            {ec.description && <div className="reg-entrance-desc">{ec.description}</div>}
                                            <div className="reg-entrance-capacity">
                                                {ec.currentCount >= ec.maxCapacity
                                                    ? '마감'
                                                    : `${ec.maxCapacity - ec.currentCount}자리 남음`}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 5: 결제 */}
                    {step === 4 && (
                        <div className="reg-step-content">
                            <p className="reg-description">결제 방식을 선택하세요</p>
                            <div className="reg-payment-cards">
                                <div
                                    className={`reg-payment-card ${paymentMethod === 'naver' ? 'selected' : ''}`}
                                    onClick={() => setPaymentMethod('naver')}
                                >
                                    <div className="reg-payment-icon">N</div>
                                    <div className="reg-payment-label">네이버</div>
                                    <div className="reg-payment-desc">네이버페이로 결제합니다</div>
                                </div>
                                <div
                                    className={`reg-payment-card ${paymentMethod === 'card' ? 'selected' : ''}`}
                                    onClick={() => setPaymentMethod('card')}
                                >
                                    <div className="reg-payment-icon">💳</div>
                                    <div className="reg-payment-label">현장<br/>카드 결제</div>
                                    <div className="reg-payment-desc">방문하여 카드로 결제합니다</div>
                                </div>
                                <div
                                    className={`reg-payment-card ${paymentMethod === 'transfer' ? 'selected' : ''}`}
                                    onClick={() => setPaymentMethod('transfer')}
                                >
                                    <div className="reg-payment-icon">🏦</div>
                                    <div className="reg-payment-label">현장<br/>계좌 이체</div>
                                    <div className="reg-payment-desc">방문하여 계좌이체로 결제합니다</div>
                                </div>
                                <div
                                    className={`reg-payment-card ${paymentMethod === 'zeropay' ? 'selected' : ''}`}
                                    onClick={() => setPaymentMethod('zeropay')}
                                >
                                    <div className="reg-payment-icon">Z</div>
                                    <div className="reg-payment-label">제로페이<br/>(서울페이)</div>
                                    <div className="reg-payment-desc">제로페이로 결제합니다</div>
                                </div>
                            </div>
                            <div className="reg-payment-total">
                                결제 금액: <strong>{totalCost.toLocaleString()}원</strong>
                            </div>
                        </div>
                    )}

                    {/* Step 6: 상담 */}
                    {step === 5 && (
                        <div className="reg-step-content">
                            <p className="reg-description">코치와 상담을 원하시나요?</p>
                            <div className="reg-consult-cards">
                                <div
                                    className={`reg-consult-card ${wantsConsultation ? 'selected' : ''}`}
                                    onClick={() => setWantsConsultation(true)}
                                >
                                    <div className="reg-consult-icon">💬</div>
                                    <div className="reg-consult-label">네, 상담 원합니다</div>
                                    <div className="reg-consult-desc">등록 전 코치와 상담을 진행합니다</div>
                                </div>
                                <div
                                    className={`reg-consult-card ${!wantsConsultation ? 'selected' : ''}`}
                                    onClick={() => setWantsConsultation(false)}
                                >
                                    <div className="reg-consult-icon">✓</div>
                                    <div className="reg-consult-label">아니요, 바로 등록</div>
                                    <div className="reg-consult-desc">상담 없이 바로 등록합니다</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 7: 확인 + FAQ + 질문 */}
                    {step === 6 && (
                        <div className="reg-step-content">
                            <h3 className="reg-summary-title">등록 정보 확인</h3>
                            <div className="reg-summary">
                                <div className="reg-summary-row">
                                    <span>이름</span><span>{name}</span>
                                </div>
                                <div className="reg-summary-row">
                                    <span>연락처</span><span>{phone1}-{phone2}-{phone3}</span>
                                </div>
                                {gender && (
                                    <div className="reg-summary-row">
                                        <span>성별</span><span>{gender}</span>
                                    </div>
                                )}
                                {occupation && (
                                    <div className="reg-summary-row">
                                        <span>직업</span><span>{occupation}</span>
                                    </div>
                                )}
                                {healthIssues && (
                                    <div className="reg-summary-row">
                                        <span>불편한 곳</span><span>{healthIssues}</span>
                                    </div>
                                )}
                                {exerciseGoal && (
                                    <div className="reg-summary-row">
                                        <span>운동 목적</span><span>{exerciseGoal}</span>
                                    </div>
                                )}
                                <div className="reg-summary-row">
                                    <span>주 횟수</span><span>{PRICING.find(p => p.frequency === weeklyFrequency)?.label}</span>
                                </div>
                                <div className="reg-summary-row">
                                    <span>시간표</span><span>{getScheduleString()}</span>
                                </div>
                                <div className="reg-summary-row">
                                    <span>입학반</span>
                                    <span>{(() => { const ec = entranceClasses.find(c => c.id === selectedEntrance); return ec ? `${formatEntranceDate(ec.date)} ${ec.time}${ec.endTime ? ' ~ ' + ec.endTime : ''}` : ''; })()}</span>
                                </div>
                                <div className="reg-summary-row">
                                    <span>결제 방식</span>
                                    <span>{paymentMethod === 'naver' ? '네이버' : paymentMethod === 'card' ? '현장 카드 결제' : '현장 계좌 이체'}</span>
                                </div>
                                <div className="reg-summary-row total">
                                    <span>총 비용</span><span>{totalCost.toLocaleString()}원</span>
                                </div>
                                {wantsConsultation && (
                                    <div className="reg-summary-row">
                                        <span>상담</span><span>요청함</span>
                                    </div>
                                )}
                            </div>

                            {/* FAQ */}
                            {faqs.length > 0 && (
                                <div className="reg-faq-section">
                                    <h3 className="reg-faq-title">자주 묻는 질문</h3>
                                    {faqs.map(faq => (
                                        <div key={faq.id} className="reg-faq-item">
                                            <div
                                                className="reg-faq-question"
                                                onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                                            >
                                                <span>Q. {faq.question}</span>
                                                <span className={`reg-faq-arrow ${expandedFaq === faq.id ? 'open' : ''}`}>▼</span>
                                            </div>
                                            {expandedFaq === faq.id && (
                                                <div className="reg-faq-answer">A. {faq.answer}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 코치에게 질문 */}
                            <div className="reg-field" style={{ marginTop: '1rem' }}>
                                <label>코치에게 질문 (선택)</label>
                                <textarea
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder="궁금한 점이 있으면 입력해주세요"
                                    className="reg-input reg-textarea"
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="reg-footer">
                    {step > 0 && (
                        <button
                            className="reg-btn reg-btn-secondary"
                            onClick={() => setStep(step - 1)}
                        >
                            이전
                        </button>
                    )}
                    {step < 6 ? (
                        <button
                            className="reg-btn reg-btn-primary"
                            disabled={!canProceed()}
                            onClick={() => setStep(step + 1)}
                        >
                            다음
                        </button>
                    ) : (
                        <button
                            className="reg-btn reg-btn-submit"
                            disabled={submitting}
                            onClick={handleSubmit}
                        >
                            {submitting ? '등록 중...' : '등록하기'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NewStudentRegistration;
