# 전체 디자인 리팩토링 — 플랫 + 단일 코발트 액센트

작성일: 2026-06-10
참고 디자인: Channel Talk / Bezier Design System (DESIGN.md)

## 목표

근력학교 수강 관리 앱 전체의 비주얼을 현재의 **보라 그라데이션 + 그림자** 테마에서
**완전 플랫 + 단일 코발트(#329BE7) 액센트** 디자인 시스템으로 전환한다.

- 그라데이션 0개 (body 배경 포함 전부 플랫)
- 단일 브랜드 액센트: 코발트 `#329BE7` (큰 면적 배경엔 안 씀, 액센트로만)
- 그림자는 모달/팝오버에만, 카드 깊이는 보더+표면 틴트로 표현
- 본문 텍스트는 반투명 검정 `rgba(0,0,0,0.85)` (순수 #000 금지)
- 상태색(파랑·노랑·초록·빨강)은 "상태 표시"에만, 장식 금지
- 라디우스는 사다리 값에서만 선택 (보간 금지)

## 현황 (조사 결과)

- CSS 약 25개 파일, 총 ~8,500줄
- 보라/그라데이션(`#667eea`/`#764ba2`/`linear-gradient`)이 **약 30개 파일·202곳**에 분산
- 전역 토큰은 `src/index.css`의 `:root`에 일부만 정의 (대부분 컴포넌트에서 색 하드코딩)
- 시간표는 `src/components/schedule/` 하위 컴포넌트 + `scheduleStyles.js`(JS 스타일 객체)로 분리됨 → CSS뿐 아니라 JS 스타일도 토큰화 필요
- 일부 JSX에 인라인 하드코딩 색 존재 (예: `PostList.jsx` 작성자색 `#667eea`)

## 결정 사항

| 항목 | 결정 |
|---|---|
| 범위/순서 | 토큰 먼저 정립 → 화면 묶음별 단계(phase) 적용 |
| 브랜드 색 | 코발트 `#329BE7` 그대로 |
| 평탄도 | 완전 플랫 (그라데이션·장식 그림자 전부 제거) |
| 포함 표면 | React 본체 전체 + 로그인 + 신규등록 위자드 + 관리 유틸 + 훈련일지 서브앱 |

## 디자인 토큰 (Phase 0에서 `src/index.css :root`에 정립)

```css
:root {
  /* 브랜드 — 단일 코발트 + 알파 사다리 */
  --accent: #329BE7;        --accent-hover: #327AB8;   --accent-light: #47C8FF;
  --accent-30: #329BE74D;   --accent-20: #329BE733;    --accent-10: #329BE71A;

  /* 표면 (플랫) */
  --canvas: #FFFFFF;  --surface: #FCFCFC;  --canvas-tint: #F7F7F8;  --hairline: #EFEFF0;

  /* 텍스트 — 반투명 검정 (#000 금지) */
  --text: rgba(0,0,0,0.85);  --text-secondary: rgba(0,0,0,0.6);  --text-muted: #A7A7AA;
  --cta-dark: #242428;

  /* 상태색 — "상태"에만 */
  --success: #31A552;  --caution: #EDBC40;  --error: #E94E58;  --info: #5E56F0;

  /* 라디우스 사다리 (보간 금지) */
  --r-chip: 8px;  --r-md: 12px;  --r-cta: 18px;  --r-card: 20px;  --r-band: 32px;  --r-full: 9999px;

  /* 간격 */
  --sp-xs: 4px;  --sp-sm: 8px;  --sp-md: 16px;  --sp-lg: 24px;  --sp-xl: 32px;  --sp-xxl: 48px;

  /* 모션 */
  --ease: cubic-bezier(0.3,0,0,1);  --dur-s: 150ms;  --dur-m: 300ms;  --dur-l: 450ms;

  /* 폰트 — Inter + Noto KR */
  --font: 'Inter','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
}
```

기존 `--primary-gradient` / `--secondary-gradient` / `--accent-gradient` / `--text-gradient` 유틸은 폐기한다.

## 컴포넌트 변환 규칙 (Phase 1~8 공통 적용 기준)

1. 모든 `linear-gradient` 배경 → 플랫 `--canvas`/`--surface`/`--canvas-tint`
2. 보라 `#667eea`/`#764ba2` → 코발트 `--accent` (단, 액센트로만 — 큰 면적엔 표면색)
3. 본문색 → `--text`, 보조 → `--text-secondary`, 흐린 → `--text-muted`
4. 장식 `box-shadow` → `1px solid var(--hairline)` 보더 + 표면 틴트. 그림자는 모달/팝오버에만
5. 제각각인 `border-radius` → 사다리 값으로 스냅 (8/12/18/20/32)
6. 버튼: 인-프로덕트 주요 액션 = 코발트(`--accent`), 본문 내 강조 제출 = 다크(`--cta-dark`),
   보조 = `rgba(0,0,0,0.05)`, 텍스트형 고스트 = 투명 + `--accent`
7. 입력 포커스 = `--accent` 보더 + `0 0 0 3px var(--accent-30)` 링
8. 상태색은 홀딩/결석/성공/신규 등 상태 칩에만. 칩은 `{색}1A` 배경 + `{색}4D` 보더 패턴
9. JSX/JS 스타일 객체의 인라인 하드코딩 색도 함께 토큰으로 정리

## 단계별 계획 (phase)

각 phase = 독립 브랜치 + PR + `npm run build`/`npm run lint` 통과 + 해당 화면 스크린샷 확인 후 머지.

| Phase | 범위 (파일) | 핵심 작업 |
|---|---|---|
| **0. 토대** | `index.css`, `App.css` | 토큰 `:root` 정립, body 플랫 흰 배경, 그라데이션 유틸·스크롤바 정리 |
| **1. 진입 화면** | `Login.css`, `BottomNav.css`, `Dashboard.css` + `Dashboard.jsx` | 로그인·하단탭·대시보드 |
| **2. 시간표 코어** | `WeeklySchedule.css`, `schedule/scheduleStyles.js`, `TimeTable.css`, `MonthSelector.css` + schedule 하위 jsx | 슬롯·상태칩·월선택, JS 스타일 객체 토큰화 |
| **3. 게시판** | `board/Board.css`, `PostList.jsx`, `PostForm.jsx`, `PostDetail.jsx` | 글/댓글/카테고리칩/작성자색 |
| **4. 코치 관리** | `StudentManager`, `HoldingManager`, `StudentRegistrationModal`, `CoachNewStudents`, `HolidayManager` (css+jsx) | 관리 화면 모달·폼·버튼 |
| **5. 학생 상세** | `StudentInfo`, `Ranking`, `PRSubmitModal`, `ContractView`, `ContractHistory` | 내정보·랭킹·PR·계약, 차트색 코발트 계열 |
| **6. 외부 등록** | `NewStudentRegistration.css` (+jsx) | 신규 7단계 위자드 |
| **7. 관리 유틸** | `GoogleSheetsSync.css`, `GoogleSheetsEmbed.css`, `GoogleSheetsTest.css` | Sheets 동기화·테스트 화면 |
| **8. 훈련일지** | `public/training-log/` (Tailwind CDN + `style.css`) | Tailwind theme에 코발트 매핑, 별도 접근 |

## 검증

- phase마다 `npm run build` + `npm run lint` 통과 확인
- 해당 화면 스크린샷으로 시각 회귀 확인 (보라 잔존·그라데이션 잔존 없는지)
- phase 단위가 작아 문제 시 화면 단위로 되돌리기 쉬움
- 전 phase 완료 후 전체 grep으로 `667eea`/`764ba2`/`linear-gradient` 0건 확인

## 범위 외 (YAGNI)

- 레이아웃·정보구조 변경 없음 (색·표면·라디우스·그림자만 — 비주얼 토큰 교체)
- 컴포넌트 분리/리팩토링 없음 (이미 진행된 schedule 분리 외 추가 구조 변경 안 함)
- 다크 테마는 이번 범위 아님 (토큰 구조는 추후 다크 확장 가능하게 둠)

## 미해결/추후

- `design-preview/` 목업 폴더는 작업 후 제거하거나 `.gitignore` 처리
- Phase 8 훈련일지는 Tailwind CDN 설정 방식 확인 필요 (config 인라인 vs 커스텀 CSS)
