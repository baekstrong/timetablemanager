# AGENTS.md — 근학 앱 운영 규칙

## 프로젝트 정체성
- 근학 앱 / 근력학교 앱 = `timetablemanager`
- 운영 URL: https://baekstrong.github.io/timetablemanager/
- 로컬 repo: `/Users/baeggwanjangjadonghwa/workspace/repos/timetablemanager`

## 최신 상태 유지
- ops cron `ops 근력학교 repo weekly pull 매주 월 03:20`가 매주 월요일 03:20 KST에 `git pull --ff-only`로 로컬 repo를 최신화한다.
- 자동 pull은 fast-forward만 허용한다. 충돌/실패 시 백관장에게 보고하고 임의 merge는 하지 않는다.

## pending 운영
- 근력학교 앱 pending은 repo 내부 `ops/pending/{inbox,weekly,monthly}.md`에서 관리한다.
- Hermes dashboard의 Pending 영역은 이 경로를 `근력학교 앱` 프로젝트 scope로 읽는다.

## 버그 픽스 필수 절차
- 근학 앱 버그를 수정하기 전에는 항상 먼저 다음 명령으로 최신 상태를 맞춘다.

```bash
git -C /Users/baeggwanjangjadonghwa/workspace/repos/timetablemanager pull --ff-only
```

- pull 실패, 로컬 변경 충돌, fast-forward 불가 상태면 수정하지 말고 원인과 필요한 선택지만 보고한다.
- 버그 원인 분석/수정안 제안은 가능하지만 실제 수정·push·배포는 백관장 승인 후 진행한다.

## 외부 대응
- 게시판/댓글 단순 문의는 관리자봇으로 짧게 답할 수 있다.
- 공지, 공개 발신, 배포, 데이터 변경은 승인 범위를 확인한 뒤 진행한다.
