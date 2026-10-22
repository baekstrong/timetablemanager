---
name: class-voice-memo
description: 수업 녹음에서 자동으로 만든 코치 전용 메모 변경안을 백관장에게 보여주고, 승인한 것만 저장한다. "수업 메모 확인", "/class-voice-memo", Mac 알림 "제안 N건"을 받았을 때 사용.
---

# 수업 메모 제안 확인·저장

자동화(`scripts/class-voice-memo/pipeline.mjs`, launchd)가 만든 제안을 코치와 함께 확정한다. 정본 규칙: `docs/class-voice-memo-review-2026-10-22.md`, 분석 규칙: `scripts/class-voice-memo/RULES.md`.

## 절차
1. 대기 중인 제안을 연다: `ls ~/Library/Application\ Support/ClassVoiceMemo/proposals/*.md` (하위 `done/` 제외). 없으면 "대기 중인 제안 없음"과 `pipeline.log` 마지막 몇 줄을 보여준다.
2. 제안마다 수강생별로 **현재 메모 → 바뀔 메모** 비교(diff, 🆕 표시)와 빠지는 내용, 확인 필요 사항을 그대로 보여준다. 저장 전 `firestore.mjs`의 최신 메모와 제안의 "현재 메모"가 다르면 알리고 다시 제안한다.
3. 코치의 답을 기다린다. 승인·수정 문구가 오기 전에는 저장하지 않는다. 코치가 문구를 직접 주면 **그 문구 그대로** 저장한다.
4. 승인된 수강생마다: 최종 메모를 임시 파일(스크래치패드)로 쓰고, 제안 때의 현재 메모도 파일로 써서
   `node scripts/class-voice-memo/save-note.mjs <이름> <새 메모 파일> --expect <현재 메모 파일>`
   결과의 "저장 완료 / 다른 수강생 N명 그대로"를 코치에게 전한다.
5. 그 제안의 모든 수강생을 처리(저장 또는 건너뜀)했으면 `node scripts/class-voice-memo/save-note.mjs --finish <제안.md>`로 보관하고 받아쓰기를 지운다. 임시 메모 파일도 지운다.
6. 코치가 고친 부분(용어, 뺀 내용, 추가한 처방)에서 분석 규칙에 반영할 점이 보이면 `RULES.md` 수정안을 제안한다(승인 후 반영·커밋).

## 절대 하지 않는 것
- 코치 전용 메모(`coachNotes/notes`) 외 저장: 운동 메모(`coachPinnedMemos`), 수강생 본인 메모(`pinnedMemos`)는 읽기만.
- 테스트 계정(`김기안`)에 저장.
- 음성 메모 원본 삭제(iCloud 동기화). 원본은 코치가 음성 메모 앱에서 지운다.
- 받아쓰기·메모 내용을 위키·커밋·채팅 밖 다른 곳에 옮겨 적기.
