# AGENTS.md — 근력학교 수강 관리 시스템

## Codex 공통 연결 (2026-09-05)

- 한국어로 작업한다. 이 프로젝트의 `CLAUDE.md`를 읽어 공통 운영 규칙을 적용하고, 작업에 필요한 문서만 추가로 읽는다. Claude 전용 훅·슬래시 명령·아티팩트 도구가 Codex에서도 실행된다고 가정하지 않는다. 같은 절차를 사용 가능한 도구와 로컬 스크립트로 수행한다.
- `~/.claude/wiki/WIKI.md`와 `index.md`를 먼저 읽고 아래 관련 위키를 참조한다. 작업 자료·결정 이유·산출물 경로·해결법·미완료 사항을 해당 주제 페이지와 `log.md`에 기록한다. 위키 동기화는 전역 `~/.codex/AGENTS.md`를 따른다.
- 경로는 현재 프로젝트 루트 기준으로 계산한다. 다른 맥의 `/Users/baeggwanjangjadonghwa/...` 경로와 cron은 이 맥의 실행 경로·설치 상태가 아니다. 외부 자료가 없으면 위키와 저장소에서 먼저 찾고, 없을 때만 필요한 자료를 요청한다.
- 명시적인 사용자 작업 요청을 실행 승인으로 사용한다. 이미 승인된 로컬 수정·검증을 재승인 때문에 멈추지 않는다. 공개 발행·메시지 전송·운영 데이터 변경은 현재 대화에서 승인된 범위만 수행한다.
- Git 저장소에서는 시작 시 상태를 확인하고 깨끗하면 `git pull --ff-only`한다. 다른 작업자의 미커밋 변경을 보존하고, 이번 작업 파일만 명시적으로 stage한다. 커밋·push는 프로젝트의 기존 규칙을 따르며, 강제 push나 일괄 `git add -A`로 다른 변경을 섞지 않는다.
- 문서만 바꿀 때는 링크·경로·명령 존재와 diff를 검증한다. 코드·콘텐츠를 바꿀 때는 아래의 해당 검증을 수행하고 실제 실행 결과를 보고한다. 키·토큰·개인정보 원문을 지침이나 위키에 복사하지 않는다.

## 작업 기준

- 현재 폴더가 `timetablemanager` 작업 루트다. 다른 맥의 운영 checkout을 수정하지 않는다.
- React/Vite 메인 앱은 `src/`, 별도 훈련일지 앱은 `public/training-log/`, 로컬 백엔드는 `functions/`, 서버리스 함수는 `netlify/functions/`에 있다.
- `CLAUDE.md`에서 작업 대상의 비즈니스 로직·날짜 형식·Sheets/Firestore 이중 쓰기 규칙을 확인한다. 긴 문서는 목차를 확인한 뒤 관련 절을 읽는다.
- 디자인은 기존 `src/index.css` 토큰과 단일 코발트·플랫 원칙을 따른다.
- pending은 `ops/pending/{inbox,weekly,monthly}.md`에 유지한다. 다른 맥의 Hermes 자동화 설치 여부는 별도로 확인한다.
- 운영 버그 수정 및 배포는 사용자가 요청한 범위에 한한다. GitHub Pages 배포가 main push로 실행되므로 push 전 변경 내용과 배포 영향을 확인한다.

## 실행·검증

- 개발: `npm run dev`, 백엔드: `npm run backend`.
- 로직 변경: 관련 Vitest 테스트(`npm test -- <테스트 경로>`), 필요 범위 `npm run lint`, 배포 산출물 변경 시 `npm run build`.
- 훈련일지에 Tailwind 클래스를 추가하면 `npm run build:tl-css`를 실행하고 생성 CSS도 함께 검토한다.
- 실제 SMS·푸시 발송이나 운영 Sheets/Firestore 쓰기를 테스트 대신 실행하지 않는다.

관련 위키: `~/.claude/wiki/pages/geunryeok-school-app.md`, `student-operations.md`.
