---
name: class-voice-memo
description: 수업 녹음에서 자동으로 만든 메모 제안(코치 전용 메모 + 수강생 체크리스트)을 확인 페이지로 열어 백관장이 체크한 것만 저장하게 한다. "수업 메모 확인", "/class-voice-memo", Mac 알림 "제안 N건"을 받았을 때, 또는 자동화가 이상할 때 사용.
---

# 수업 메모 제안 확인

정본: `docs/class-voice-memo-review-2026-10-22.md`, 분석 규칙: `scripts/class-voice-memo/RULES.md`.

## 기본: 확인 페이지
자동화(launchd `kr.geunryeok.class-voice-memo`)가 제안을 만들면 알림과 함께 브라우저로 **http://127.0.0.1:5179** 를 연다. 코치는 거기서 체크한 항목만 저장한다.
- 페이지가 안 열려 있거나 서버가 꺼졌으면(2시간 무요청 시 자동 종료) 띄운다:
  `node scripts/class-voice-memo/server.mjs &` 후 `open http://127.0.0.1:5179`
  (Claude 앱은 전체 디스크 접근 권한이 있어 Desktop의 프로젝트를 읽을 수 있다.)
- 대기 중 제안: `~/Library/Application Support/ClassVoiceMemo/proposals/*.json`(하위 `done/` 제외). 없으면 `pipeline.log` 마지막 몇 줄로 상태를 알려준다.

## 페이지가 하는 일 (server.mjs)
- 코치 전용 메모: 현재 → 제안 비교(빠지는 줄 빨강, 새 줄 초록, 새 단어 형광), "직접 고치기" 가능. 체크하고 `확인 완료`를 누르면 백업 후 `coachNotes/notes`의 그 수강생 키만 조건부 저장(페이지 연 뒤 바뀌었으면 거부) → 재조회로 확인.
- 수강생 체크리스트: 항목마다 체크·운동 이름·문장 수정. 체크하고 `확인 완료`를 누른 것만 `coachPinnedMemos/{이름}.memos`에 `{exercise, memo, pinnedBy:'백관장', createdAt, id, source:'voice-memo'}`로 추가(기존 항목은 원형 보존, 조건부 쓰기). 훈련일지에서 그 운동을 고르면 체크리스트로 보인다.
- `확인 완료`: 체크한 것을 저장한 뒤(체크 안 한 건 버림) 제안을 `done/`으로 옮기고 받아쓰기를 지운다.

## 절대 하지 않는 것
- 수강생 본인 메모(`pinnedMemos`) 쓰기. 테스트 계정(`김기안`) 저장.
- 음성 메모 원본 삭제(iCloud 동기화). 원본은 코치가 음성 메모 앱에서 지운다.
- 받아쓰기·메모 내용을 위키·커밋에 옮겨 적기.
- 코치가 체크하지 않은 항목 저장.

## 코치가 고친 부분
코치가 페이지에서 문구를 고쳐 저장하면, 반복되는 수정(용어, 빼는 내용, 추가하는 처방)을 `RULES.md`에 반영할 수정안을 제안한다(승인 후 반영·커밋).
