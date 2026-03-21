import { useState, useEffect } from 'react';
import { getPost, toggleLike, deletePost, getComments, createComment, deleteComment } from '../../services/firebaseService';
import { CATEGORY_MAP, POST_LIMITS } from '../../data/boardConstants';
import CommentItem from './CommentItem';

const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
};

const PostDetail = ({ postId, user, onBack, onEdit }) => {
    const [post, setPost] = useState(null);
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [commentText, setCommentText] = useState('');
    const [submittingComment, setSubmittingComment] = useState(false);

    const loadData = async () => {
        try {
            const [postData, commentsData] = await Promise.all([
                getPost(postId),
                getComments(postId),
            ]);
            setPost(postData);
            setComments(commentsData);
        } catch (err) {
            console.error('PostDetail loadData error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [postId]);

    const handleToggleLike = async () => {
        if (!post || !user) return;

        const alreadyLiked = post.likes?.includes(user.username);
        const newLikes = alreadyLiked
            ? (post.likes || []).filter((u) => u !== user.username)
            : [...(post.likes || []), user.username];

        // Optimistic UI update
        setPost((prev) => ({ ...prev, likes: newLikes }));

        try {
            await toggleLike(postId, user.username);
        } catch (err) {
            // Rollback on failure
            setPost((prev) => ({ ...prev, likes: post.likes || [] }));
            alert('좋아요 처리 중 오류가 발생했습니다.');
        }
    };

    const handleDelete = async () => {
        if (!confirm('게시글을 삭제하시겠습니까?')) return;
        try {
            await deletePost(postId);
            onBack();
        } catch (err) {
            alert('게시글 삭제 중 오류가 발생했습니다.');
        }
    };

    const handleDeleteComment = async (commentId) => {
        try {
            await deleteComment(postId, commentId);
            const updated = await getComments(postId);
            setComments(updated);
        } catch (err) {
            alert('댓글 삭제 중 오류가 발생했습니다.');
        }
    };

    const handleSubmitComment = async () => {
        if (!commentText.trim() || submittingComment) return;
        setSubmittingComment(true);
        try {
            await createComment(postId, {
                content: commentText,
                author: user.username,
                isCoach: user.role === 'coach',
            });
            setCommentText('');
            const updated = await getComments(postId);
            setComments(updated);
        } catch (err) {
            alert('댓글 등록 중 오류가 발생했습니다.');
        } finally {
            setSubmittingComment(false);
        }
    };

    const handleReply = async (parentId, content) => {
        await createComment(postId, {
            content,
            author: user.username,
            isCoach: user.role === 'coach',
            parentId,
        });
        const updated = await getComments(postId);
        setComments(updated);
    };

    // 댓글을 트리 구조로 변환
    const rootComments = comments.filter(c => !c.parentId);
    const repliesByParent = {};
    comments.filter(c => c.parentId).forEach(c => {
        if (!repliesByParent[c.parentId]) repliesByParent[c.parentId] = [];
        repliesByParent[c.parentId].push(c);
    });

    if (loading) {
        return <div style={{ padding: '24px', textAlign: 'center' }}>로딩 중...</div>;
    }

    if (!post) {
        return (
            <div style={{ padding: '24px', textAlign: 'center' }}>
                <button className="back-btn" onClick={onBack}>← 뒤로</button>
                <p>게시글을 찾을 수 없습니다.</p>
            </div>
        );
    }

    const liked = post.likes?.includes(user?.username);
    const isAuthor = user?.username === post.author;
    const canDelete = isAuthor || user?.role === 'coach';
    const category = CATEGORY_MAP[post.category];

    return (
        <div className="post-detail">
            <button className="back-btn" onClick={onBack}>← 뒤로</button>

            <div className="post-detail-content-section">
                <div className="post-detail-meta">
                    {category && (
                        <span
                            className="post-category-badge"
                            data-category={post.category}
                        >
                            {category.icon} {category.label}
                        </span>
                    )}
                    <span
                        className="post-detail-author"
                        style={post.isCoach ? { color: '#7c3aed', fontWeight: 600 } : {}}
                    >
                        {post.author}
                    </span>
                    <span className="post-detail-date">{formatDate(post.createdAt)}</span>
                    {isAuthor && (
                        <button className="post-action-btn" onClick={() => onEdit(post)} style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#6b7280' }}>
                            수정
                        </button>
                    )}
                    {canDelete && (
                        <button className="post-action-btn" onClick={handleDelete} style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            삭제
                        </button>
                    )}
                </div>

                <h2 className="post-detail-title">{post.title}</h2>

                <div
                    className="post-detail-content"
                    style={{ whiteSpace: 'pre-wrap' }}
                >
                    {post.content}
                </div>
            </div>

            <div className="post-actions" style={{ justifyContent: 'flex-start', gap: '16px' }}>
                <button
                    className={`post-action-btn${liked ? ' liked' : ''}`}
                    onClick={handleToggleLike}
                    style={{ fontSize: '1.08rem' }}
                >
                    {liked ? '❤️' : '🤍'} {(post.likes || []).length}
                </button>
                <span style={{ fontSize: '1.08rem', color: '#666' }}>💬 {comments.length}</span>
            </div>

            <div className="comments-section">
                <h3 className="comments-header">댓글</h3>
                <div className="comment-list">
                    {rootComments.map((c) => (
                        <CommentItem
                            key={c.id}
                            comment={c}
                            user={user}
                            onDelete={handleDeleteComment}
                            onReply={handleReply}
                            replies={repliesByParent[c.id] || []}
                            repliesByParent={repliesByParent}
                        />
                    ))}
                </div>

                <div className="comment-input-area">
                    <textarea
                        className="comment-input"
                        maxLength={POST_LIMITS.COMMENT_MAX}
                        placeholder="댓글을 입력하세요..."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                    />
                    <button
                        className="comment-submit-btn"
                        disabled={!commentText.trim() || submittingComment}
                        onClick={handleSubmitComment}
                    >
                        {submittingComment ? '등록 중...' : '등록'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PostDetail;
