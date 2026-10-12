import { getActiveWaitlistRequests, getHolidays, acceptWaitlistRequest } from './firebaseService';
import { processScheduleTransfer } from './googleSheetsService';
import { buildUpdatedSchedule, parseScheduleString } from '../utils/scheduleUtils';

export async function acceptScheduleTransfer(studentName, requestId, student) {
    const requests = await getActiveWaitlistRequests(studentName);
    const request = requests.find(item => item.id === requestId && item.status === 'notified');
    if (!request) throw new Error('코치 승인 상태가 변경되었습니다. 새로고침 후 확인해주세요.');
    if (!student || student['이름'] !== studentName || !student['요일 및 시간']) {
        throw new Error('수강생 정보를 확인할 수 없습니다. 새로고침해주세요.');
    }
    const currentSlot = { ...request.currentSlot, period: Number(request.currentSlot.period) };
    const desiredSlot = { ...request.desiredSlot, period: Number(request.desiredSlot.period) };
    const currentSchedule = student['요일 및 시간'];
    const slots = parseScheduleString(currentSchedule);
    if (!slots.some(slot => slot.day === currentSlot.day && slot.period === currentSlot.period)) {
        throw new Error('현재 시간표가 대기 신청 당시와 다릅니다. 코치에게 문의해주세요.');
    }
    if (slots.some(slot => slot.day === desiredSlot.day && slot.day !== currentSlot.day)) {
        throw new Error('변경할 요일에 이미 수업이 있습니다. 코치에게 문의해주세요.');
    }
    const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, desiredSlot);
    const holidays = await getHolidays();
    const result = await processScheduleTransfer(studentName, newSchedule, holidays, {
        preferredSheetName: student._foundSheetName,
        preferredRowIndex: student._rowIndex,
    });
    // 시트 저장이 끝난 뒤에만 수강생 승인 완료로 처리한다.
    await acceptWaitlistRequest(request.id);
    return { ...result, currentSchedule, newSchedule };
}
