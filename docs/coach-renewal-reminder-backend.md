# 코치 재등록 안내 서버

2026-10-16 사용자 승인 범위: 해당 수업 30분 전 마지막 수업·미재등록 대상을 코치에게 묶어 알린다. 수강생 문자·공지 발행·운영 등록 수정은 포함하지 않는다.

## 일일 판정과 API

`GET /.netlify/functions/coach-renewal`은 기존 Firebase ID 토큰을 매번 검증하고 코치만 허용한다. 응답은 `{date, lessons:[{period,startMinute,lastNames,delayedNames}]}`이다. 날짜·시간 경계는 KST이며 HTTP는 `private, no-store`다. 서버 warm 완료 결과는 60초 재사용하고 동시 조회를 공유한다. `refresh=1`은 완료 캐시를 버리며 기존 읽기가 진행 중이면 그 뒤의 새 읽기 1회를 공유한다. 강제 갱신 실패 후 이전 완료 캐시를 되살리지 않는다. 부분 조회 실패는 503이며 빈 명단 성공으로 바꾸지 않는다.

원본은 Sheets 최근 −6~+2개월의 B:O와 이전 시트의 일시정지 B:H, Firestore 보강·오늘 활성 결석·오늘 휴일·수업 비활성·날짜 범위 홀딩이다. 연락처 P:R은 조회하지 않는다. 현재 등록 선택·다음 등록 제외·보강 종료일 보정은 기존 앱 규칙을 따르며, 실제 참석 교시만 반환한다. 마지막 날에 보강과 정규 수업이 함께 있으면 실제로 참석하는 가장 늦은 교시만 마지막으로 본다. 보강 조회는 앱과 같은 이번 월요일~다음 금요일에 원래 수업 또는 보강일이 걸리는 범위를 사용한다.

## 앱이 닫혀 있을 때

독립 `coach-renewal-reminder` 함수는 UTC `*/10 0,2,8,10,12 * * 1-5`에 실행한다. KST 평일 각 수업 시작 30분 전부터 시작 전까지의 구간 밖에서는 DB·Sheets를 읽지 않는다. 유효 구간에는 같은 원본을 새로 확인하며 마지막·미재등록 명단을 알림 한 건으로 묶는다.

수신자는 정본 `users.isCoach=true`이면서 FCM 토큰이 있고 Firebase Auth 계정이 존재하고 비활성화되지 않은 코치다. 현 인증은 로그인 시 custom token에만 권한을 넣으므로 `UserRecord.customClaims`에 영구 권한이 있다고 가정하지 않는다. 같은 토큰은 한 번만 처리한다.

`coachRenewalDeliveries`의 날짜·교시·토큰 SHA256 키를 트랜잭션으로 먼저 확보한다. 학생·코치 이름과 토큰 원문은 영수증에 저장하지 않는다. 이미 확보한 영수증은 재실행에도 발송하지 않는다. 통신 결과가 불분명한 경우 중복 발송을 피하기 위해 자동 재발송하지 않으며, 이는 정확히 한 번 전달을 보장한다는 뜻이 아니다. 알림 TTL은 수업 시작까지다. 무효 토큰 정리는 저장값이 발송 시 토큰과 같을 때만 한다. 기존 계정별 단일 FCM 토큰 구조와 기기 알림 권한 조건을 유지한다.

## 검증과 배포

- 관련 신규 21테스트와 변경 파일 ESLint 통과. 강제 갱신 경합·실패·마지막 교시 순서·휴강/결석/홀딩·서버 중복 방지·코치 수신권한을 오프라인 검증했다.
- 10/16 운영 읽기 전용 대조: 등록 원본 236행, 대표 69명, 시간표가 남은 44명, 주간 보강 22건, 오늘 결석 1건, 오늘 범위 홀딩 2건. 금요일 비활성 1·2·6교시를 제외한 4·5교시 중 4교시 마지막 1명, 미재등록 0명. 코치 수신 기기 1개. 이름·토큰은 출력·파일로 보관하지 않았다.
- 운영 데이터·영수증 쓰기 0회, 실제 푸시 0회. 비밀 번들의 무발송 smoke에서 OPTIONS 200·비로그인 401·주말 읽기/발송 0을 확인했다.
- `node scripts/prepare-coach-renewal.mjs`는 두 함수를 Git 밖 `~/Library/Application Support/Codex/coach-renewal-reminder-2026-10-16/`에 번들·ZIP으로 준비하며 배포하지 않는다. 번들에는 관리자 자격증명이 들어 있으므로 mode600으로 보관하며 커밋하지 않는다. 기본 manifest는 `outputs/coach-renewal-review-2026-10-16/function-artifacts.json`이다.
- Netlify digest 배포 시 기존 정적 파일·함수 digest·설정·기존 예약을 유지하고 새 2함수와 manifest의 `function_schedules`만 추가한다. 코드의 `exports.config`만으로 수동 digest 배포에 예약이 등록됐다고 판단하지 않는다. 배포 후 published/ready, 함수별 digest, schedule, 기존 파일·함수 보존을 확인한다. 예약함수를 Run now로 시험하면 실제 발송될 수 있으므로 실행하지 않는다.

서버 배포와 예약 활성화 결과는 주 작업의 배포 기록에서 확인한다. 기준 문서: [Netlify 예약 함수](https://docs.netlify.com/build/functions/scheduled-functions/), [배포 API](https://open-api.netlify.com/#tag/deploy/operation/createSiteDeploy).
