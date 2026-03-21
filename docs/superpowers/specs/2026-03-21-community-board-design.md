# 커뮤니티 게시판 디자인 스펙

## 개요

기존 공지사항(Dashboard)을 커뮤니티 게시판으로 확장한다. 코치 공지사항, 종료일 알림, 재등록 계약서 등 기존 기능은 유지하면서, 수강생들이 자유롭게 소통할 수 있는 공간을 추가한다.

## 접근 방식

기존 Dashboard.jsx를 확장한다. 알림 배너(종료일, 재등록 계약, 대기 신청)는 게시판 위에 그대로 유지하고, 하단 공지사항 영역을 게시판으로 교체한다. 별도 페이지 없이 Dashboard 내에서 `viewMode` state로 목록/상세를 전환한다.

## 데이터 모델

### `posts` 컬렉션 (Firestore)

```
{
  id: auto,
  category: 'notice' | 'free' | 'exercise' | 'question',
  title: string,
  content: string,
  author: string,          // user.username
  isCoach: boolean,
  pinned: boolean,         // 공지 상단 고정
  likes: [string],         // 좋아요 누른 사용자 이름 배열
  commentCount: number,    // 댓글 수 캐시 (목록 표시용)
  deleted: boolean,        // soft delete
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### `comments` 서브컬렉션 (`posts/{postId}/comments`)

```
{
  id: auto,
  content: string,
  author: string,
  isCoach: boolean,
  deleted: boolean,
  createdAt: timestamp
}
```

기존 `announcements` 컬렉션은 건드리지 않는다. 새 `posts` 컬렉션을 사용하기 시작하면 기존 공지는 코치가 게시판에 다시 작성한다.

### 구현 노트

- `toggleLike`는 Firestore `arrayUnion`/`arrayRemove` 원자 연산 사용 (동시 쓰기 충돌 방지)
- `commentCount` 변경은 댓글 생성/삭제와 Firestore batch write로 묶어 처리
- `getComments`는 `deleted !== true` 필터링, `createdAt` 오름차순 정렬
- `getPosts`는 `deleted !== true` 필터링, 최대 20개씩 로드 (추후 "더보기" 가능)
- `pinned`는 `category === 'notice'`일 때만 의미 있음. 다른 카테고리에서는 무시
- `updatedAt`은 `updatePost` (글 수정) 시에만 갱신. 좋아요/댓글 변경 시에는 갱신하지 않음
- 입력 제한: 제목 100자, 본문 5000자, 댓글 1000자

## 카테고리

| 카테고리 | key | 아이콘 | 작성 권한 |
|---|---|---|---|
| 공지 | notice | 📢 | 코치만 |
| 자유 | free | 💬 | 모두 |
| 운동 | exercise | 💪 | 모두 |
| 질문 | question | ❓ | 모두 |

향후 카테고리 추가 가능하도록 상수 배열로 관리한다.

## 컴포넌트 구조

```
src/components/
├── Dashboard.jsx              # 알림 배너 + 게시판 영역 (viewMode로 list/detail 전환)
├── board/
│   ├── PostList.jsx           # 카테고리 탭 + 글 목록
│   ├── PostDetail.jsx         # 글 상세 + 댓글 목록 + 댓글 입력
│   ├── PostForm.jsx           # 글 작성/수정 모달
│   └── CommentItem.jsx        # 댓글 한 줄 컴포넌트
```

### Dashboard.jsx 변경

- 기존 알림 배너(종료일, 재등록 계약, 대기 신청, Google Sheets, 휴일설정) 그대로 유지
- 공지사항 섹션 → PostList 또는 PostDetail로 교체
- `viewMode` state: `'list'`(기본) | `'detail'`
- `selectedPostId` state: 상세 보기 대상

### PostList.jsx

- 카테고리 탭 (전체/공지/자유/운동/질문)
- 글 목록 (pinned 공지 상단 고정, 나머지 최신순)
- 각 글: 카테고리 뱃지, 제목, 작성자, 날짜, 좋아요 수, 댓글 수
- 글쓰기 버튼 (하단)
- 글 클릭 → `onPostClick(postId)` → Dashboard가 viewMode를 'detail'로 전환

### PostDetail.jsx

- 뒤로가기 버튼 → viewMode를 'list'로 복귀
- 글 내용 전체 표시
- 좋아요 버튼 (토글)
- 수정/삭제 버튼 (권한에 따라)
- 댓글 목록 (CommentItem)
- 댓글 입력 폼

### PostForm.jsx

- 모달 형태
- 카테고리 선택 (코치: 모든 카테고리, 수강생: 공지 제외)
- 제목, 내용 입력
- 공지 카테고리 선택 시 '상단 고정' 체크박스 (코치만)
- 수정 모드: 기존 데이터로 폼 채움

### CommentItem.jsx

- 작성자명 (코치일 경우 색상 강조)
- 댓글 내용
- 작성 시간
- 삭제 버튼 (본인 댓글 또는 코치)

## Firebase 서비스 함수

`firebaseService.js`에 추가:

| 함수 | 설명 |
|---|---|
| `createPost(data)` | 글 생성 |
| `getPosts(category?)` | 글 목록 (카테고리 필터, pinned 우선, 최신순) |
| `getPost(postId)` | 글 상세 |
| `updatePost(postId, data)` | 글 수정 |
| `deletePost(postId)` | soft delete |
| `toggleLike(postId, username)` | 좋아요 토글 (arrayUnion/arrayRemove 사용) |
| `getComments(postId)` | 댓글 목록 (deleted 제외, createdAt 오름차순) |
| `createComment(postId, data)` | 댓글 작성 + commentCount increment (batch) |
| `deleteComment(postId, commentId)` | 댓글 soft delete + commentCount decrement (batch) |

## 권한 규칙

| 동작 | 코치 | 수강생 |
|---|---|---|
| 공지 작성 | O | X |
| 자유/운동/질문 작성 | O | O |
| 본인 글 수정/삭제 | O | O |
| 타인 글 삭제 | O | X |
| 댓글 작성 | O | O |
| 본인 댓글 삭제 | O | O |
| 타인 댓글 삭제 | O | X |
| 좋아요 | O | O |

## 화면 흐름

1. Dashboard 로드 → 알림 배너 → PostList (기본)
2. 카테고리 탭 클릭 → 해당 카테고리 필터링
3. 글 클릭 → PostDetail 표시
4. 뒤로가기 → PostList 복귀
5. 글쓰기 버튼 → PostForm 모달
6. 수정 버튼 → PostForm 모달 (기존 데이터)

## 실명제

모든 글/댓글에 작성자 이름(user.username) 표시. 익명 기능 없음.

## 기존 기능 유지 사항

- 종료일 알림 배너 (isMyLastDay, isCourseExpired)
- 재등록 계약서 배너 (pendingContract)
- 대기 신청 배너 (studentWaitlist)
- Google Sheets 연동 (코치 전용)
- 휴일설정 버튼 (코치 전용)
- 로그아웃 버튼

## 에러 처리

- 글/댓글 작성 실패 시 `alert`로 에러 표시
- 좋아요는 낙관적 UI (즉시 반영 후 실패 시 롤백)
- 목록 로딩 실패 시 "불러오기 실패" 메시지 + 재시도 버튼

## 마이그레이션

- 기존 `announcements` 컬렉션은 삭제하지 않음
- `Dashboard.jsx`에서 `announcements` 관련 코드 제거, `posts` 관련 코드로 교체
- 기존 공지는 코치가 게시판에 재작성

## 문서 업데이트

- CLAUDE.md의 Firestore 컬렉션 테이블에 `posts`, `comments` 추가
- Dashboard 컴포넌트 설명 업데이트
- `board/` 디렉토리 구조 추가
