import { useEffect, useRef, useState } from 'react';
import { getComments, getPost, getPostsPage } from '../services/firebaseService';
import { BOARD_CATEGORIES, CATEGORY_MAP, POST_LIMITS } from '../data/boardConstants';
import { linkifyText } from '../utils/linkify';
import '../components/board/Board.css';
import './live-board-review.css';

// This preview intentionally imports only the existing board's read operations.
// Production PostDetail also marks notices read, so it is not mounted here.
const READ_SERVICES = { getComments, getPost, getPostsPage };

function formatDate(value, withTime = false) {
    const date = value?.toDate?.() ?? new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '';
    return date.toLocaleString('ko-KR', withTime
        ? { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { month: '2-digit', day: '2-digit' });
}

function CategoryBadge({ category }) {
    const info = CATEGORY_MAP[category];
    return info ? <span className="post-category-badge" data-category={category}>{info.icon} {info.label}</span> : null;
}

function commentOrder(comments) {
    const children = new Map();
    const ids = new Set(comments.map(comment => comment.id));
    for (const comment of comments) {
        const parent = ids.has(comment.parentId) ? comment.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(comment);
    }
    const rows = [];
    const visited = new Set();
    const visit = (comment, depth) => {
        if (visited.has(comment.id)) return;
        visited.add(comment.id);
        rows.push({ comment, depth });
        for (const child of children.get(comment.id) || []) visit(child, depth + 1);
    };
    for (const comment of children.get(null) || []) visit(comment, 0);
    for (const comment of comments) visit(comment, 0);
    return rows;
}

export function LiveBoardPostDetail({ user, postId, onBack, services = READ_SERVICES }) {
    const [result, setResult] = useState(null);
    const [reload, setReload] = useState(0);
    const key = JSON.stringify([user?.username || '', postId, reload]);
    const loaded = result?.key === key;
    useEffect(() => {
        let active = true;
        Promise.allSettled([services.getPost(postId), services.getComments(postId)]).then(([postResult, commentsResult]) => {
            if (!active) return;
            if (postResult.status === 'rejected') { setResult({ key, error: true }); return; }
            const value = postResult.value;
            const post = value?.id === postId && !value.deleted ? value : null;
            setResult({
                key, post,
                comments: post && commentsResult.status === 'fulfilled' ? (commentsResult.value || []).filter(comment => !comment.deleted) : [],
                commentsError: commentsResult.status === 'rejected',
            });
        });
        return () => { active = false; };
    }, [key, postId, services]);

    const post = loaded && result.post;
    return <section className="live-board-review live-board-detail">
        <button className="live-board-back" type="button" onClick={onBack}>← 뒤로</button>
        {!loaded ? <p className="board-empty" role="status">게시글을 불러오고 있어요.</p>
            : result.error ? <div className="board-error" role="alert"><p>게시글을 불러오지 못했어요.</p><button className="board-retry-btn" type="button" onClick={() => setReload(value => value + 1)}>다시 조회</button></div>
                : !post ? <p className="board-empty">삭제되었거나 찾을 수 없는 게시글이에요.</p>
                    : <article className="post-detail">
                        <div className="post-detail-meta"><CategoryBadge category={post.category} /><span className={post.isCoach ? 'live-board-coach' : ''}>{post.author}</span><time>{formatDate(post.createdAt, true)}</time></div>
                        <h1 className="post-detail-title">{post.title}</h1>
                        <div className="post-detail-content">{linkifyText(post.content)}</div>
                        {post.images?.length > 0 && <div className="post-detail-images">{post.images.map((image, index) => <a key={image.url || index} href={image.url} target="_blank" rel="noopener noreferrer"><img src={image.url} alt={`게시글 첨부 ${index + 1}`} /></a>)}</div>}
                        <div className="post-actions live-board-counts"><span>좋아요 {post.likes?.length || 0}</span><span>댓글 {result.comments.length}</span></div>
                        <section className="comments-section" aria-label="댓글">
                            <h2 className="comments-header">댓글</h2>
                            {result.commentsError ? <p role="status">댓글을 불러오지 못했어요. <button className="board-retry-btn" type="button" onClick={() => setReload(value => value + 1)}>다시 조회</button></p>
                                : result.comments.length === 0 ? <p className="live-board-empty-comments">등록된 댓글이 없습니다.</p>
                                    : <div className="comment-list">{commentOrder(result.comments).map(({ comment, depth }) => <article className="comment-item" key={comment.id} style={{ paddingLeft: Math.min(depth, 2) * 14 }}>
                                        <div className="comment-item-header"><span className={`comment-author ${comment.isCoach ? 'comment-author-coach' : ''}`}>{depth > 0 && '↳ '}{comment.author}</span><time className="comment-date">{formatDate(comment.createdAt, true)}</time></div>
                                        <div className="comment-content">{linkifyText(comment.content)}</div>
                                        {comment.image?.url && <a href={comment.image.url} target="_blank" rel="noopener noreferrer"><img className="live-board-comment-image" src={comment.image.url} alt="댓글 첨부" /></a>}
                                        {comment.likes?.length > 0 && <p className="live-board-comment-likes">좋아요 {comment.likes.length}</p>}
                                    </article>)}</div>}
                        </section>
                    </article>}
    </section>;
}

function LiveBoardList({ user, onOpen, services }) {
    const [category, setCategory] = useState('all');
    const [page, setPage] = useState(1);
    const [reload, setReload] = useState(0);
    const [result, setResult] = useState(null);
    const [selectedPostId, setSelectedPostId] = useState(null);
    const cursors = useRef({ 1: null });
    const key = JSON.stringify([user?.username || '', category, page, reload]);
    const loaded = result?.key === key;

    useEffect(() => {
        let active = true;
        services.getPostsPage(category, POST_LIMITS.PAGE_SIZE, cursors.current[page] ?? null).then(data => {
            if (!active) return;
            cursors.current[page + 1] = data.nextCursor;
            setResult({ key, posts: data.posts.filter(post => !post.deleted), hasNextPage: data.hasNextPage });
        }).catch(() => { if (active) setResult({ key, error: true, posts: [] }); });
        return () => { active = false; };
    }, [category, page, key, services]);

    const openPost = postId => {
        if (onOpen) onOpen(postId);
        else setSelectedPostId(postId);
        window.scrollTo(0, 0);
    };
    if (selectedPostId) return <LiveBoardPostDetail user={user} postId={selectedPostId} services={services} onBack={() => { setSelectedPostId(null); window.scrollTo(0, 0); }} />;

    return <section className="live-board-review">
        <div className="live-board-heading"><h1>게시판</h1><button className="live-board-refresh" type="button" disabled={!loaded} onClick={() => setReload(value => value + 1)}>새로고침</button></div>
        <div className="board-tabs" aria-label="게시글 카테고리">{BOARD_CATEGORIES.map(item => <button className={`board-tab${category === item.key ? ' active' : ''}`} type="button" key={item.key} aria-pressed={category === item.key} onClick={() => {
            if (item.key === category && page === 1) return;
            cursors.current = { 1: null }; setCategory(item.key); setPage(1);
        }}>{item.icon && `${item.icon} `}{item.label}</button>)}</div>
        {!loaded ? <p className="board-empty" role="status">게시글을 불러오고 있어요.</p>
            : result.error ? <div className="board-error" role="alert"><p>게시글을 불러오지 못했어요.</p><button className="board-retry-btn" type="button" onClick={() => setReload(value => value + 1)}>다시 조회</button></div>
                : result.posts.length === 0 ? <p className="board-empty">게시글이 없습니다.</p>
                    : <div className="live-board-posts">{result.posts.map(post => <button className={`post-card${post.pinned && post.category === 'notice' ? ' pinned' : ''}`} key={post.id} type="button" onClick={() => openPost(post.id)}>
                        <span className="post-card-header"><CategoryBadge category={post.category} /><span className="post-card-title">{post.title}{post.imageCount > 0 && <small> ({post.imageCount})</small>}</span></span>
                        <span className="post-card-meta"><span className={post.isCoach ? 'live-board-coach' : ''}>{post.author} · {formatDate(post.createdAt)}</span><span>{post.likeCount > 0 && `좋아요 ${post.likeCount}`}{post.likeCount > 0 && post.commentCount > 0 && ' · '}{post.commentCount > 0 && `댓글 ${post.commentCount}`}</span></span>
                    </button>)}</div>}
        {loaded && !result.error && (page > 1 || result.hasNextPage) && <nav className="board-pagination" aria-label="게시글 페이지"><button className="board-page-btn" type="button" disabled={page === 1} onClick={() => { setPage(value => value - 1); window.scrollTo(0, 0); }}>‹ 이전</button><span className="board-page-current">{page}</span><button className="board-page-btn" type="button" disabled={!result.hasNextPage} onClick={() => { setPage(value => value + 1); window.scrollTo(0, 0); }}>다음 ›</button></nav>}
    </section>;
}

export default function LiveBoardReview({ user, onOpen, services = READ_SERVICES }) {
    return <LiveBoardList key={user?.username || 'signed-in'} user={user} onOpen={onOpen} services={services} />;
}
