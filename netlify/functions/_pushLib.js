// 푸시 본문 생성 — firebase-admin에 의존하지 않아 테스트에서 그냥 import 된다 (_authLib.js와 같은 이유)
const cut = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

const PERIOD_LABELS = { 1: '1교시', 2: '2교시', 3: '3교시(자율)', 4: '4교시', 5: '5교시', 6: '6교시' };
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateText(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr || '');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
}

/**
 * 이 요청을 보내도 되는지 확인하려면 어떤 문서를 읽어야 하는가.
 * 핸들러가 이 경로를 읽어 buildMessage에 record로 넘긴다. null이면 조회 불필요(공지).
 */
function verifyPathFor(req) {
  switch (req.type) {
    case 'comment':
      return req.postId ? ['posts', req.postId] : undefined;
    case 'reply':
      return req.postId && req.parentId ? ['posts', req.postId, 'comments', req.parentId] : undefined;
    case 'makeupSeat':
      return req.waitlistId ? ['makeupWaitlists', req.waitlistId] : undefined;
    default:
      return null; // 조회 불필요
  }
}

/**
 * 본문은 전부 여기서 만든다 — 클라이언트가 준 텍스트는 코치 공지 말고는 쓰지 않는다.
 * 대상(names)도 클라이언트 말이 아니라 조회한 문서에서 뽑는다.
 * @param {object} req    클라이언트 요청
 * @param {{name:string,isCoach:boolean}} caller  ID 토큰 클레임
 * @param {object|null} record  verifyPathFor가 가리킨 문서 데이터 (없으면 null)
 * @returns {{names: string[], title: string, body: string, tag: string, url: string, ttl: number} | null}
 */
function buildMessage(req, caller, record) {
  switch (req.type) {
    case 'notice':
      // 자유 텍스트는 여기뿐 — 코치만.
      if (!caller.isCoach) return null;
      if (!Array.isArray(req.names) || req.names.length === 0) return null;
      return {
        names: req.names,
        title: `📢 ${cut(req.title, 60)}`,
        body: cut(req.content, 120),
        tag: 'notice',
        url: req.postId ? `./?post=${req.postId}` : './',
        ttl: 604800, // 1주 — 폰을 꺼두고 잔 사람도 켜면 받아야 한다
      };

    case 'comment':
    case 'reply': {
      // 대상은 실제 글/부모댓글 작성자. 본인에게는 안 보낸다.
      // ponytail: 호출자가 정말 댓글을 달았는지까지는 확인 안 함(문서 1개 더 읽어야 함).
      //           남는 위험은 "실재하는 글쓴이에게 자기 이름으로 반복 알림" — 문구가 고정이고
      //           발신자가 이름으로 드러나므로 여기서 끊는다. 악용 사례가 생기면 댓글 문서까지 대조.
      const author = record?.author;
      if (!author || record.deleted || author === caller.name) return null;
      return {
        names: [author],
        title: `${caller.name}님이 ${req.type === 'reply' ? '답글' : '댓글'}을 남겼습니다`,
        body: req.type === 'reply' ? '내 댓글에 답글이 달렸습니다.' : '내 글에 새 댓글이 달렸습니다.',
        tag: 'board',
        url: `./?post=${req.postId}`,
        ttl: 86400, // 하루 지나서 뜨는 댓글 알림은 의미가 없다
      };
    }

    case 'makeupSeat': {
      // 실제로 자리 안내가 나간(notified) 대기 항목에만. 날짜·교시도 그 문서에서 읽는다.
      if (!record || record.status !== 'notified' || !record.studentName) return null;
      const label = PERIOD_LABELS[record.period] || `${record.period}교시`;
      return {
        names: [record.studentName],
        title: `보강 자리가 났습니다 — ${formatDateText(record.date)} ${label}`,
        body: '1시간 내에 앱 시간표에서 [보강승인중] 칸을 눌러 수락해주세요. 미응답 시 다음 대기자에게 넘어갑니다.',
        tag: 'makeup-seat',
        url: './?page=schedule',
        ttl: 3600, // 수락 데드라인과 같게 — 늦게 도착하면 이미 다음 순번으로 넘어갔다
      };
    }

    default:
      return null;
  }
}

module.exports = { buildMessage, verifyPathFor };
