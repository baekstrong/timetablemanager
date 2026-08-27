// 푸시 본문 생성 — firebase-admin에 의존하지 않아 테스트에서 그냥 import 된다 (_authLib.js와 같은 이유)
const cut = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * 본문은 전부 여기서 만든다 — 클라이언트가 임의 문구를 남에게 밀어넣지 못하게.
 * 코치 공지만 자유 텍스트이고, 그건 isCoach로 막는다.
 * @returns {{names: string[], title: string, body: string, tag: string} | null}
 */
function buildMessage(req, caller) {
  switch (req.type) {
    case 'notice':
      if (!caller.isCoach) return null;
      if (!Array.isArray(req.names) || req.names.length === 0) return null;
      return {
        names: req.names,
        title: `📢 ${cut(req.title, 60)}`,
        body: cut(req.content, 120),
        tag: 'notice',
      };
    case 'comment':
    case 'reply':
      if (!req.to) return null;
      return {
        names: [req.to],
        title: `${caller.name}님이 ${req.type === 'reply' ? '답글' : '댓글'}을 남겼습니다`,
        body: cut(req.preview, 80),
        tag: 'board',
      };
    case 'makeupSeat':
      if (!req.to) return null;
      return {
        names: [req.to],
        title: `보강 자리가 났습니다 — ${cut(req.dateText, 20)} ${cut(req.periodLabel, 20)}`,
        body: '1시간 내에 앱 시간표에서 [보강승인중] 칸을 눌러 수락해주세요. 미응답 시 다음 대기자에게 넘어갑니다.',
        tag: 'makeup-seat',
      };
    default:
      return null;
  }
}

module.exports = { buildMessage };
