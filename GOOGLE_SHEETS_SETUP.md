# 구글 시트 API 서비스 계정 인증 설정 가이드

이 프로젝트는 Firebase Cloud Functions를 통해 구글 시트 API를 사용합니다. 서비스 계정 인증 방식을 사용하여 토큰 만료 문제를 해결했습니다.

## 📋 목차

1. [아키텍처 개요](#아키텍처-개요)
2. [초기 설정](#초기-설정)
3. [로컬 개발](#로컬-개발)
4. [프로덕션 배포](#프로덕션-배포)
5. [문제 해결](#문제-해결)

## 🏗️ 아키텍처 개요

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────┐
│   React     │ ────────▶│ Firebase         │ ────────▶│ Google       │
│   Frontend  │  fetch() │ Cloud Functions  │  API     │ Sheets API   │
│             │ ◀──────── │ (서비스 계정)     │ ◀──────── │              │
└─────────────┘         └──────────────────┘         └──────────────┘
```

- **프론트엔드**: React 앱이 Firebase Functions API를 호출
- **백엔드**: Firebase Functions가 서비스 계정으로 구글 시트 API 호출
- **보안**: 서비스 계정 키는 서버에서만 사용되어 안전함

## 🚀 초기 설정

### 1. 서비스 계정 키 파일 확인

프로젝트 루트에 `timetable-manager-483823-71c27367cd6a.json` 파일이 있어야 합니다.

⚠️ **중요**: 이 파일은 `.gitignore`에 추가되어 있어 Git에 커밋되지 않습니다.

### 2. 구글 시트 공유 설정

서비스 계정에 구글 시트 접근 권한을 부여해야 합니다:

1. `timetable-manager-483823-71c27367cd6a.json` 파일을 열어 `client_email` 찾기
2. 구글 시트를 열고 해당 이메일 주소와 공유
3. 편집 권한 부여

### 3. 환경 변수 설정

`.env` 파일에 다음 변수가 설정되어 있는지 확인:

```env
# Google Sheets ID
VITE_GOOGLE_SHEETS_ID=1gZvM6GqiEZRqhpkzTTbX93cl6vaf15pA3yII_t6uIgo

# Firebase Functions URL (로컬/프로덕션에 따라 변경)
VITE_FUNCTIONS_URL=http://127.0.0.1:5001/timetable-manager-483823/us-central1
```

## 💻 로컬 개발

### 1. Dependencies 설치

```bash
# 루트 프로젝트 dependencies
npm install

# Firebase Functions dependencies
cd functions
npm install
cd ..
```

### 2. Firebase Emulator 실행

```bash
# Firebase CLI 설치 (전역)
npm install -g firebase-tools

# Firebase 로그인
firebase login

# Emulator 시작
firebase emulators:start --only functions
```

Firebase Emulator가 실행되면 다음 주소에서 Functions를 사용할 수 있습니다:
- `http://127.0.0.1:5001/timetable-manager-483823/us-central1/readSheet`
- `http://127.0.0.1:5001/timetable-manager-483823/us-central1/writeSheet`
- `http://127.0.0.1:5001/timetable-manager-483823/us-central1/appendSheet`
- `http://127.0.0.1:5001/timetable-manager-483823/us-central1/batchUpdateSheet`
- `http://127.0.0.1:5001/timetable-manager-483823/us-central1/getSheetInfo`

### 3. React 앱 실행

새 터미널에서:

```bash
npm run dev
```

이제 `http://localhost:5173`에서 앱을 사용할 수 있습니다.

## 🌐 프로덕션 배포

### 1. Firebase Functions 배포

```bash
# Functions만 배포
firebase deploy --only functions

# 또는 전체 배포
firebase deploy
```

### 2. 환경 변수 업데이트

배포 후 `.env` 파일의 `VITE_FUNCTIONS_URL`을 프로덕션 URL로 변경:

```env
VITE_FUNCTIONS_URL=https://us-central1-timetable-manager-483823.cloudfunctions.net
```

### 3. React 앱 빌드 및 배포

```bash
# 프로덕션 빌드
npm run build

# 빌드된 파일은 dist/ 폴더에 생성됨
# Firebase Hosting이나 다른 호스팅 서비스에 배포
```

## 🔍 API 엔드포인트

### GET /readSheet
구글 시트 데이터 읽기

**쿼리 파라미터:**
- `range`: A1 notation (예: "등록생 목록(26년1월)!A:Z")

**응답:**
```json
{
  "success": true,
  "values": [["이름", "주횟수", ...], [...]]
}
```

### POST /writeSheet
구글 시트 데이터 쓰기

**요청 본문:**
```json
{
  "range": "등록생 목록(26년1월)!A1",
  "values": [["데이터1", "데이터2"]]
}
```

**응답:**
```json
{
  "success": true,
  "updatedCells": 2,
  "updatedRange": "등록생 목록(26년1월)!A1:B1"
}
```

### POST /appendSheet
구글 시트에 데이터 추가

**요청 본문:**
```json
{
  "range": "등록생 목록(26년1월)!A:Z",
  "values": [["새 데이터1", "새 데이터2"]]
}
```

### POST /batchUpdateSheet
여러 셀 일괄 업데이트

**요청 본문:**
```json
{
  "data": [
    { "range": "등록생 목록(26년1월)!A1", "values": [["값1"]] },
    { "range": "등록생 목록(26년1월)!B1", "values": [["값2"]] }
  ]
}
```

### GET /getSheetInfo
스프레드시트 정보 가져오기

**응답:**
```json
{
  "success": true,
  "sheets": ["등록생 목록(26년1월)", "등록생 목록(26년2월)", ...]
}
```

## 🔧 문제 해결

### Firebase Emulator가 시작되지 않음

```bash
# Firebase CLI 재설치
npm uninstall -g firebase-tools
npm install -g firebase-tools

# 로그인 확인
firebase login
```

### CORS 에러 발생

Firebase Functions는 `cors: true` 옵션이 설정되어 있습니다. 로컬 개발 시 CORS 문제가 발생하면:

1. Firebase Emulator를 재시작
2. 브라우저 캐시 삭제
3. `.env` 파일의 URL 확인

### 서비스 계정 키 파일을 찾을 수 없음

```bash
# functions/index.js에서 키 파일 경로 확인
# 현재 설정: ../timetable-manager-483823-71c27367cd6a.json

# 파일이 프로젝트 루트에 있는지 확인
ls -la timetable-manager-483823-71c27367cd6a.json
```

### 구글 시트 접근 권한 에러

1. 서비스 계정 이메일 확인:
```bash
cat timetable-manager-483823-71c27367cd6a.json | grep client_email
```

2. 구글 시트에서 해당 이메일과 공유 (편집 권한)

### Functions 배포 에러

```bash
# Firebase 프로젝트 확인
firebase projects:list

# 올바른 프로젝트 선택
firebase use timetable-manager-483823

# Functions만 배포
firebase deploy --only functions
```

## 📝 참고 사항

- 서비스 계정 방식은 OAuth 인증과 달리 토큰 만료가 없어 안정적입니다
- 서비스 계정 키는 절대 Git에 커밋하지 마세요
- 프로덕션 환경에서는 환경 변수를 통해 키를 관리하는 것이 더 안전합니다
- Firebase Functions는 무료 티어에서 일일 호출 제한이 있으니 사용량을 모니터링하세요

## 🔐 보안 권장사항

1. **서비스 계정 키 관리**
   - 키 파일은 `.gitignore`에 추가
   - 프로덕션에서는 Firebase 환경 변수 사용 권장

2. **구글 시트 권한 최소화**
   - 필요한 시트만 서비스 계정과 공유
   - 편집 권한이 필요하지 않으면 읽기 전용 권한 부여

3. **API 보호**
   - 프로덕션 환경에서는 Firebase Authentication과 통합 권장
   - Rate limiting 구현 고려

## 📚 추가 리소스

- [Firebase Cloud Functions 문서](https://firebase.google.com/docs/functions)
- [Google Sheets API 문서](https://developers.google.com/sheets/api)
- [서비스 계정 인증](https://cloud.google.com/iam/docs/service-accounts)
