# 커뮤니티 게시판 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 공지사항(Dashboard)을 카테고리 기반 커뮤니티 게시판으로 전환한다.

**Architecture:** Dashboard.jsx 내에서 `viewMode` state로 목록/상세를 전환. Firebase Firestore `posts` 컬렉션 + `comments` 서브컬렉션 사용. 기존 알림 배너는 그대로 유지하고 공지사항 영역만 게시판으로 교체.

**Tech Stack:** React 19, Firebase Firestore (client SDK), Vite 7

**Spec:** `docs/superpowers/specs/2026-03-21-community-board-design.md`

---

## 파일 구조

| 작업 | 파일 | 역할 |
|---|---|---|
| Create | `src/data/boardConstants.js` | 카테고리 상수 배열 |
| Create | `src/components/board/PostList.jsx` | 카테고리 탭 + 글 목록 |
| Create | `src/components/board/PostDetail.jsx` | 글 상세 + 댓글 + 좋아요 |
| Create | `src/components/board/PostForm.jsx` | 글 작성/수정 모달 |
| Create | `src/components/board/CommentItem.jsx` | 댓글 한 줄 컴포넌트 |
| Create | `src/components/board/Board.css` | 게시판 스타일 |
| Modify | `src/services/firebaseService.js` | 게시판 CRUD 함수 추가 |
| Modify | `src/components/Dashboard.jsx` | 공지사항 → 게시판 교체 |
| Modify | `CLAUDE.md` | Firestore 컬렉션, 디렉토리 구조 업데이트 |

---

### Task 1: 카테고리 상수 정의

**Files:**
- Create: `src/data/boardConstants.js`

- [ ] **Step 1: 상수 파일 생성**

```js
export const BOARD_CATEGORIES = [
    { key: 'all', label: '전체', icon: '' },
    { key: 'notice', label: '공지', icon: '📢', coachOnly: true },
    { key: 'free', label: '자유', icon: '💬' },
    { key: 'exercise', label: '운동', icon: '💪' },
    { key: 'question', label: '질문', icon: '❓' },
];

export const CATEGORY_MAP = Object.fromEntries(
    BOARD_CATEGORIES.filter(c => c.key !== 'all').map(c => [c.key, c])
);

export const POST_LIMITS = {
    TITLE_MAX: 100,
    CONTENT_MAX: 5000,
    COMMENT_MAX: 1000,
    PAGE_SIZE: 20,
};
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공 (새 파일 추가만이라 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/data/boardConstants.js
git commit -m "게시판 카테고리 상수 및 입력 제한 정의"
```

---

### Task 2: Firebase 서비스 함수 추가

**Files:**
- Modify: `src/services/firebaseService.js` (파일 끝에 추가)

기존 헬퍼 함수(`safeRead`, `safeWrite`, `createDoc`, `queryDocs`, `updateDocStatus`)를 재사용한다. `arrayUnion`/`arrayRemove`와 `increment`, `writeBatch`를 import에 추가해야 한다.

- [ ] **Step 1: import 확장**

`src/services/firebaseService.js` 상단 import에 추가:

```js
import {
    // ... 기존 import ...
    getDoc,
    arrayUnion,
    arrayRemove,
    increment,
    writeBatch,
} from 'firebase/firestore';
```

- [ ] **Step 2: 게시글 CRUD 함수 추가**

파일 끝(`// ============================================` 주석 스타일에 맞춰)에 추가:

```js
// ============================================
// BOARD - POSTS
// ============================================

export const createPost = async (data) => {
    return safeWrite(async () => {
        const result = await createDoc('posts', {
            ...data,
            likes: [],
            commentCount: 0,
            deleted: false,
            updatedAt: serverTimestamp(),
        });
        return result;
    });
};

export const getPosts = async (category = null, limitCount = 20) => {
    return safeRead([], async () => {
        // 복합 인덱스 없이 동작하도록 클라이언트 필터링 사용
        const constraints = category && category !== 'all'
            ? [where('category', '==', category)]
            : [];
        const posts = await queryDocs('posts', ...constraints);
        // deleted 필터링 (클라이언트)
        const filtered = posts.filter(p => !p.deleted);
        // pinned 공지만 상단, 나머지 최신순
        return filtered.sort((a, b) => {
            const aPinned = a.pinned && a.category === 'notice';
            const bPinned = b.pinned && b.category === 'notice';
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        }).slice(0, limitCount);
    });
};

export const getPost = async (postId) => {
    return safeRead(null, async () => {
        const docRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        return { id: docSnap.id, ...docSnap.data() };
    });
};

export const updatePost = async (postId, data) => {
    return safeWrite(async () => {
        await updateDocStatus('posts', postId, data);
    });
};

export const deletePost = async (postId) => {
    return safeWrite(async () => {
        await updateDocStatus('posts', postId, { deleted: true });
    });
};

export const toggleLike = async (postId, username) => {
    return safeWrite(async () => {
        const postRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(postRef);
        if (!docSnap.exists()) throw new Error('게시글을 찾을 수 없습니다.');
        const likes = docSnap.data().likes || [];
        const isLiked = likes.includes(username);
        await updateDoc(postRef, {
            likes: isLiked ? arrayRemove(username) : arrayUnion(username),
        });
        return !isLiked;
    });
};
```

- [ ] **Step 3: 댓글 CRUD 함수 추가**

```js
// ============================================
// BOARD - COMMENTS
// ============================================

export const getComments = async (postId) => {
    return safeRead([], async () => {
        const commentsRef = collection(db, 'posts', postId, 'comments');
        // 복합 인덱스 없이 동작하도록 deleted는 클라이언트 필터링
        const q = query(commentsRef, orderBy('createdAt', 'asc'));
        const snapshot = await getDocs(q);
        return snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(c => !c.deleted);
    });
};

export const createComment = async (postId, data) => {
    return safeWrite(async () => {
        const batch = writeBatch(db);
        const commentRef = doc(collection(db, 'posts', postId, 'comments'));
        batch.set(commentRef, {
            ...data,
            deleted: false,
            createdAt: serverTimestamp(),
        });
        const postRef = doc(db, 'posts', postId);
        batch.update(postRef, { commentCount: increment(1) });
        await batch.commit();
        return { success: true, id: commentRef.id };
    });
};

export const deleteComment = async (postId, commentId) => {
    return safeWrite(async () => {
        const batch = writeBatch(db);
        const commentRef = doc(db, 'posts', postId, 'comments', commentId);
        batch.update(commentRef, { deleted: true });
        const postRef = doc(db, 'posts', postId);
        batch.update(postRef, { commentCount: increment(-1) });
        await batch.commit();
    });
};
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 5: 커밋**

```bash
git add src/services/firebaseService.js
git commit -m "게시판 Firebase 서비스 함수 추가 (posts, comments CRUD)"
```

---

### Task 3: Board.css 스타일 생성

**Files:**
- Create: `src/components/board/Board.css`

- [ ] **Step 1: 게시판 CSS 작성**

기존 `Dashboard.css`의 스타일 컨벤션(font-size, border-radius, color scheme)을 따른다. 카테고리 탭, 글 목록 카드, 글 상세, 댓글, 글쓰기 모달의 스타일을 정의한다. 주요 클래스:

- `.board-tabs` — 카테고리 탭 가로 스크롤
- `.board-tab`, `.board-tab.active` — 탭 항목
- `.post-card` — 글 목록 카드
- `.post-category-badge` — 카테고리 뱃지 (색상은 data-category로 구분)
- `.post-detail` — 글 상세 컨테이너
- `.post-detail-content` — 본문 영역 (white-space: pre-wrap)
- `.post-actions` — 좋아요/수정/삭제 버튼 영역
- `.comment-list` — 댓글 목록
- `.comment-item` — 댓글 한 줄
- `.comment-author-coach` — 코치 닉네임 강조
- `.comment-input-area` — 댓글 입력 영역
- `.post-form-modal` — 글 작성 모달 (기존 공지 모달과 동일한 오버레이 패턴)
- `.write-btn` — 글쓰기 플로팅 버튼

- [ ] **Step 2: 커밋**

```bash
git add src/components/board/Board.css
git commit -m "게시판 CSS 스타일 추가"
```

---

### Task 4: PostList 컴포넌트

**Files:**
- Create: `src/components/board/PostList.jsx`

- [ ] **Step 1: PostList 컴포넌트 작성**

Props: `{ posts, loading, error, user, onPostClick, onWriteClick, onRetry, selectedCategory, onCategoryChange }`

구현:
- `BOARD_CATEGORIES`에서 카테고리 탭 렌더링
- `selectedCategory` 필터링은 부모(Dashboard)에서 처리하므로, 여기서는 받은 `posts`를 그대로 렌더링
- 각 글: 카테고리 뱃지(CATEGORY_MAP으로 색상/아이콘), 제목, 작성자(코치면 색상 강조), 날짜(`createdAt` 포맷), 좋아요 수(`likes.length`), 댓글 수(`commentCount`)
- 로딩 중이면 스피너, 에러 시 "불러오기 실패" + 재시도 버튼(`onRetry`), 글 없으면 빈 상태 표시
- 하단 글쓰기 버튼: 클릭 시 `onWriteClick()`

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/board/PostList.jsx
git commit -m "PostList 컴포넌트: 카테고리 탭 + 글 목록"
```

---

### Task 5: CommentItem 컴포넌트

**Files:**
- Create: `src/components/board/CommentItem.jsx`

- [ ] **Step 1: CommentItem 컴포넌트 작성**

Props: `{ comment, user, onDelete }`

구현:
- 작성자명 (comment.isCoach면 `.comment-author-coach` 클래스 + 보라색)
- 댓글 내용
- 작성 시간 (createdAt 포맷)
- 삭제 버튼: `user.username === comment.author || user.role === 'coach'`일 때만 표시

- [ ] **Step 2: 커밋**

```bash
git add src/components/board/CommentItem.jsx
git commit -m "CommentItem 컴포넌트: 댓글 표시 + 삭제"
```

---

### Task 6: PostDetail 컴포넌트

**Files:**
- Create: `src/components/board/PostDetail.jsx`

- [ ] **Step 1: PostDetail 컴포넌트 작성**

Props: `{ postId, user, onBack, onEdit }`

구현:
- `useEffect`로 `getPost(postId)` + `getComments(postId)` 호출
- 뒤로가기 버튼 → `onBack()`
- 카테고리 뱃지 + 작성자 + 날짜
- 글 제목, 본문 (pre-wrap)
- 좋아요 버튼: 클릭 시 `toggleLike(postId, user.username)` — 낙관적 UI (즉시 likes 배열 로컬 업데이트, 실패 시 롤백)
- 수정 버튼: `user.username === post.author`일 때 → `onEdit(post)`
- 삭제 버튼: `user.username === post.author || user.role === 'coach'`일 때 → confirm → `deletePost(postId)` → `onBack()`
- 댓글 목록: `comments.map(c => <CommentItem>)`
- 댓글 입력: textarea + 전송 버튼, 1000자 제한, `createComment(postId, { content, author, isCoach })` 호출 후 댓글 목록 리로드

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/board/PostDetail.jsx
git commit -m "PostDetail 컴포넌트: 글 상세 + 댓글 + 좋아요"
```

---

### Task 7: PostForm 컴포넌트

**Files:**
- Create: `src/components/board/PostForm.jsx`

- [ ] **Step 1: PostForm 모달 컴포넌트 작성**

Props: `{ user, editingPost, onSubmit, onClose }`

구현:
- 모달 오버레이 (기존 Dashboard 공지 모달과 동일 패턴)
- 카테고리 선택: `BOARD_CATEGORIES`에서 `key !== 'all'`만 표시, 수강생이면 `coachOnly` 카테고리 비활성화
- 제목 input (100자 제한)
- 내용 textarea (5000자 제한)
- 공지 카테고리 선택 + 코치일 때 '상단 고정' 체크박스
- 수정 모드(`editingPost` 존재): 기존 데이터로 폼 채움, 카테고리 변경 불가
- 제출 시 `author: user.username`, `isCoach: user.role === 'coach'`를 포함하여 `onSubmit({ category, title, content, pinned, author, isCoach })` 호출
- 유효성 검사: 제목/내용 빈값 체크, 길이 제한 체크

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/board/PostForm.jsx
git commit -m "PostForm 컴포넌트: 글 작성/수정 모달"
```

---

### Task 8: Dashboard.jsx 통합

**Files:**
- Modify: `src/components/Dashboard.jsx`

이 태스크가 핵심이다. 기존 공지사항 코드를 제거하고 게시판 컴포넌트로 교체한다.

- [ ] **Step 1: import 변경**

기존 공지사항 관련 import 제거:
- `getAnnouncements`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement` 제거

새 import 추가:
```js
import { createPost, getPosts, updatePost, deletePost } from '../services/firebaseService';
import { BOARD_CATEGORIES, POST_LIMITS } from '../data/boardConstants';
import PostList from './board/PostList';
import PostDetail from './board/PostDetail';
import PostForm from './board/PostForm';
import './board/Board.css';
```

- [ ] **Step 2: state 변경**

기존 공지 관련 state 제거:
- `notices`, `showModal`, `editingNotice`, `formData`, `submitting` 제거
- `loadAnnouncements`, `handleCreate`, `handleEdit`, `handleDelete`, `handleSubmit` 함수 제거

새 state 추가:
```js
const [posts, setPosts] = useState([]);
const [postsLoading, setPostsLoading] = useState(true);
const [selectedCategory, setSelectedCategory] = useState('all');
const [viewMode, setViewMode] = useState('list'); // 'list' | 'detail'
const [selectedPostId, setSelectedPostId] = useState(null);
const [postsError, setPostsError] = useState(null);
const [showPostForm, setShowPostForm] = useState(false);
const [editingPost, setEditingPost] = useState(null);
```

- [ ] **Step 3: 데이터 로딩 + 핸들러 함수**

```js
// 게시글 로드
const loadPosts = async (category = selectedCategory) => {
    try {
        setPostsLoading(true);
        setPostsError(null);
        const data = await getPosts(category, POST_LIMITS.PAGE_SIZE);
        setPosts(data);
    } catch (error) {
        console.error('Failed to load posts:', error);
        setPostsError('게시글을 불러오는데 실패했습니다.');
    } finally {
        setPostsLoading(false);
    }
};

useEffect(() => { loadPosts(); }, []);

// 카테고리 변경
const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    loadPosts(category);
};

// 글 클릭 → 상세
const handlePostClick = (postId) => {
    setSelectedPostId(postId);
    setViewMode('detail');
};

// 상세 → 목록 복귀
const handleBackToList = () => {
    setViewMode('list');
    setSelectedPostId(null);
    loadPosts();
};

// 글 작성/수정 제출
const handlePostSubmit = async (formData) => {
    try {
        if (editingPost) {
            await updatePost(editingPost.id, {
                title: formData.title,
                content: formData.content,
                pinned: formData.pinned || false,
            });
        } else {
            await createPost(formData);
        }
        setShowPostForm(false);
        setEditingPost(null);
        await loadPosts();
    } catch (error) {
        alert('저장 실패: ' + error.message);
    }
};

// 수정 모달 열기
const handleEditPost = (post) => {
    setEditingPost(post);
    setShowPostForm(true);
    setViewMode('list');
};
```

- [ ] **Step 4: JSX 교체**

기존 `{/* 공지사항 섹션 */}` ~ 공지 모달까지의 JSX를 삭제하고, 같은 위치에:

```jsx
{/* 게시판 섹션 */}
{viewMode === 'list' ? (
    <PostList
        posts={posts}
        loading={postsLoading}
        error={postsError}
        user={user}
        selectedCategory={selectedCategory}
        onCategoryChange={handleCategoryChange}
        onPostClick={handlePostClick}
        onWriteClick={() => { setEditingPost(null); setShowPostForm(true); }}
        onRetry={() => loadPosts()}
    />
) : (
    <PostDetail
        postId={selectedPostId}
        user={user}
        onBack={handleBackToList}
        onEdit={handleEditPost}
    />
)}

{showPostForm && (
    <PostForm
        user={user}
        editingPost={editingPost}
        onSubmit={handlePostSubmit}
        onClose={() => { setShowPostForm(false); setEditingPost(null); }}
    />
)}
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add src/components/Dashboard.jsx
git commit -m "Dashboard 공지사항 → 커뮤니티 게시판 교체"
```

---

### Task 9: CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Firestore 컬렉션 테이블에 추가**

`posts` — 커뮤니티 게시판 (category: notice/free/exercise/question, soft delete)
`comments` — 게시글 댓글 (서브컬렉션: posts/{postId}/comments)

- [ ] **Step 2: 디렉토리 구조에 `board/` 추가**

```
├── board/
│   ├── PostList.jsx           # 게시판 글 목록 + 카테고리 탭
│   ├── PostDetail.jsx         # 글 상세 + 댓글 + 좋아요
│   ├── PostForm.jsx           # 글 작성/수정 모달
│   ├── CommentItem.jsx        # 댓글 컴포넌트
│   └── Board.css              # 게시판 스타일
```

- [ ] **Step 3: Dashboard 설명 업데이트**

`Dashboard.jsx` 설명을 "대시보드 (공지사항)" → "대시보드 (커뮤니티 게시판)" 으로 변경

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md 게시판 관련 문서 업데이트"
```

---

### Task 10: 통합 테스트 및 최종 확인

- [ ] **Step 1: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 2: 개발 서버에서 수동 테스트**

Run: `npm run dev` + `npm run backend`

체크리스트:
- 코치 로그인 → 게시판 목록 표시
- 카테고리 탭 전환 (전체/공지/자유/운동/질문)
- 글 작성 (공지 카테고리, 상단 고정)
- 글 작성 (자유 카테고리)
- 글 상세 진입 → 뒤로가기
- 좋아요 토글
- 댓글 작성
- 글 수정/삭제
- 댓글 삭제
- 수강생 로그인 → 공지 작성 불가 확인
- 수강생 자유 글 작성
- 기존 알림 배너 정상 표시 (종료일, 재등록 계약, 대기 신청)

- [ ] **Step 3: 최종 커밋 + 푸시**

```bash
git push
```
