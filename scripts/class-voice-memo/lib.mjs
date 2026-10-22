// 수업 음성 메모 자동화의 순수 함수 (파일·네트워크 없음 — 테스트에서 그대로 import)
import { PERIODS } from '../../src/data/mockData.js';

const END_MINUTES = { 1: 11 * 60 + 30, 2: 13 * 60 + 30, 3: 17 * 60, 4: 19 * 60 + 30, 5: 21 * 60 + 20, 6: 23 * 60 + 10 };

// 음성 메모 파일명 "20261022 120128-3B605E49.m4a" → 녹음 시작 시각(로컬)
export function parseRecordingStart(fileName) {
    const m = /^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})/.exec(fileName);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
}

// 시작 15분 전 ~ 수업 종료 사이에 녹음을 시작했으면 그 교시. 밖이면 null(교시 확인 필요).
export function periodFor(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return null;
    const minutes = date.getHours() * 60 + date.getMinutes();
    const p = PERIODS.find(p => {
        const start = p.startHour * 60 + p.startMinute;
        return minutes >= start - 15 && minutes <= END_MINUTES[p.id];
    });
    return p ? p.id : null;
}

export const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// whisper가 조용한 구간에서 같은 줄을 반복하는 환각 제거 (VAD로 대부분 막히지만 남는 것 정리)
export function dropRepeats(text) {
    const out = [];
    for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
        if (out[out.length - 1] !== line) out.push(line);
    }
    return out.join('\n');
}
