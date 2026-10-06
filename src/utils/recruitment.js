export const RECRUITMENT_STATUSES = {
    open: '접수중',
    inquiry: '문의만 가능',
    closed: '마감',
};

export function koreanDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

export const isRecruitmentMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '');
export function shiftMonth(month, offset = 1) {
    const [year, number] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, number - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const monthLabel = month => isRecruitmentMonth(month)
    ? `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월` : '';

export function monthEntrances(classes, month, today = koreanDate()) {
    return classes.filter(ec => ec.isActive && ec.date?.startsWith(`${month}-`) && ec.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

export function isEntranceAvailable(ec) {
    return Boolean(ec && ec.isActive && !ec.closed && Number(ec.maxCapacity) > Number(ec.currentCount || 0));
}

export function recruitmentOptions(configs, classes, today = koreanDate()) {
    const current = today.slice(0, 7);
    const last = shiftMonth(current, 12);
    const months = new Set([current, shiftMonth(current)]);
    configs.forEach(c => { if (isRecruitmentMonth(c.month) && c.month >= current && c.month <= last) months.add(c.month); });
    classes.forEach(ec => {
        const month = ec.date?.slice(0, 7);
        if (ec.isActive && isRecruitmentMonth(month) && month >= current && month <= last) months.add(month);
    });
    return [...months].sort().map(month => {
        const config = configs.find(c => c.month === month);
        const status = RECRUITMENT_STATUSES[config?.status] ? config.status : 'inquiry';
        const entrances = monthEntrances(classes, month, today);
        return { ...config, month, status, entrances, canApply: status === 'open' && entrances.some(isEntranceAvailable) };
    });
}

export function recruitmentInquiryRoute(choice, options, fallbackPhone = '') {
    const inquiry = choice?.status === 'closed'
        ? options.find(o => o.month > choice.month && o.status !== 'closed')
            || { month: shiftMonth(choice.month), inquiryPhone: fallbackPhone }
        : choice;
    return {
        inquiry,
        showInquiry: Boolean(inquiry && inquiry.status !== 'open'),
        nextOpen: Boolean(choice?.status === 'closed' && inquiry?.status === 'open'),
    };
}

export function isAdmissionDate(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRecruitmentSubmission(config, data, entrance, today = koreanDate()) {
    if (!isRecruitmentMonth(data.recruitmentMonth) || data.recruitmentMonth < today.slice(0, 7) ||
        !config || config.month !== data.recruitmentMonth || config.status !== 'open') {
        throw new Error('선택한 월의 신규 모집이 마감되었거나 아직 열리지 않았습니다. 모집 안내를 다시 확인해주세요.');
    }
    if (data.entranceInquiry) {
        if (!isAdmissionDate(data.entranceInquiry) || !data.entranceInquiry.startsWith(`${data.recruitmentMonth}-`) || data.entranceInquiry < today ||
            !data.entranceInquiryReason?.trim() || data.entranceClassId) {
            throw new Error('희망 입학반 날짜와 사유를 선택한 모집월 안에서 다시 확인해주세요.');
        }
    } else if (!isEntranceAvailable(entrance) || entrance.date !== data.entranceDate ||
        !entrance.date.startsWith(`${data.recruitmentMonth}-`) || entrance.date < today) {
        throw new Error('선택한 입학반이 변경되었거나 마감되었습니다. 입학반 일정을 다시 확인해주세요.');
    }
}

export const normalizeInquiryPhone = phone => String(phone || '').replace(/\D/g, '');
export const isInquiryPhone = phone => /^(01\d{8,9}|0[2-6]\d{7,9})$/.test(normalizeInquiryPhone(phone));
export const inquiryMessage = month => `안녕하세요. 근력학교 ${monthLabel(month)} 입학 문의드립니다.\n\n이름:\n희망 요일 / 시간:\n궁금한 점:`;
export function inquirySmsLink(phone, month, userAgent = '') {
    if (!isInquiryPhone(phone) || !isRecruitmentMonth(month)) return '';
    const separator = /iPhone|iPad|iPod/i.test(userAgent) ? '&' : '?';
    return `sms:${normalizeInquiryPhone(phone)}${separator}body=${encodeURIComponent(inquiryMessage(month))}`;
}
