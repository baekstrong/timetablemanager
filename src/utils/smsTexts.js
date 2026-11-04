// 자동 안내 문자 본문(순수 함수). 앱과 Netlify sms 함수가 같이 쓴다.
// 로그인 없는 신규 신청·수강생 기기에서 오는 요청은 서버가 문서를 읽어 이 함수로 본문을 만든다 —
// 클라이언트가 보낸 문구·수신번호를 그대로 쓰면 누구나 학원 번호로 임의 문자를 보낼 수 있다(2026-11-04).

/** 신규 신청 접수 확인(신청자에게). */
export const registrationReceivedText = (name, isWaitlist = false) => (isWaitlist
    ? `[근력학교] ${name}님, 신규 수강 대기 신청 내역이 코치에게 전달되었습니다. 신청한 시간에 여석이 발생하면 연락드리겠습니다.`
    : `[근력학교] ${name}님, 신규 수강 신청 내역이 코치에게 전달되었습니다. 수강이 승인되면 연락 드리겠습니다.`);

const PAYMENT_LABELS = { naver: '네이버', card: '현장 카드 결제' };

/** 신규 신청 알림(코치에게). reg = 신청서 문서(name, phone, weeklyFrequency, scheduleString, ...). */
// 공개 신청서의 자유 입력은 길이 제한이 없어 문자 한 통이 끝없이 길어지지 않게 자른다(전체 내용은 앱에서 본다).
const clip = (value, max = 200) => { const text = String(value); return text.length > max ? `${text.slice(0, max)}…` : text; };

export function coachNewRegistrationText(reg) {
    const lines = [reg.isWaitlist ? '[근력학교] 신규 수강 대기 신청이 접수되었습니다.' : '[근력학교] 신규 수강 신청이 접수되었습니다.'];
    lines.push(`이름: ${clip(reg.name, 30)}`);
    if (reg.phone) lines.push(`연락처: ${reg.phone}`);
    if (reg.gender) lines.push(`성별: ${reg.gender}`);
    if (reg.occupation) lines.push(`직업: ${clip(reg.occupation)}`);
    lines.push(`주횟수: 주${reg.weeklyFrequency}회`);
    lines.push(`시간표: ${reg.scheduleString}`);
    lines.push(`결제방식: ${PAYMENT_LABELS[reg.paymentMethod] || '현장 계좌 이체'}`);
    if (reg.entranceClassDate) lines.push(`입학반: ${reg.entranceClassDate}`);
    if (reg.exerciseExperience) lines.push(`운동 경력: ${clip(reg.exerciseExperience)}`);
    if (reg.healthIssues) lines.push(`불편한 곳: ${clip(reg.healthIssues)}`);
    if (reg.exerciseGoal) lines.push(`운동 목적: ${clip(reg.exerciseGoal)}`);
    if (reg.wantsConsultation) lines.push('* 상담 요청');
    if (reg.question) lines.push(`질문: ${clip(reg.question)}`);
    return lines.join('\n');
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD' → '11/4(수)'. 서버(UTC)에서도 같은 결과가 나오게 날짜 문자열만으로 계산한다. */
export function makeupDateText(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return `${m}/${d}(${DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 보강 대기 자리 안내(대기자에게). "1시간 내" + "앱 시간표에서 수락"을 반드시 포함한다. */
export const makeupSeatText = (name, dateText, periodLabel) =>
    `[근력학교] ${name}님, 대기 신청하신 ${dateText} ${periodLabel} 수업에 자리가 났습니다.\n1시간 내에 앱 시간표에서 [보강승인중] 칸을 눌러 수락해주세요.\n미응답 시 다음 대기자에게 순번이 넘어갑니다.`;
