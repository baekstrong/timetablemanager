import { useState } from 'react';
import { POST_LIMITS } from '../../data/boardConstants';

const CommentItem = ({ comment, user, onDelete, onReply, replies = [], repliesByParent = {}, depth = 0 }) => {
    if (!comment) return null;

    const [showReplyInput, setShowReplyInput] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const getFormattedDate = (createdAt) => {
        if (!createdAt) return '-';
        const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}.${day} ${hours}:${minutes}`;
    };

    const handleDelete = () => {
        if (confirm('댓글을 삭제하시겠습니까?')) {
            onDelete(comment.id);
        }
    };

    const handleReplySubmit = async () => {
        if (!replyText.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onReply(comment.id, replyText.trim());
            setReplyText('');
            setShowReplyInput(false);
        } catch (err) {
            alert('답글 등록 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const canDelete = user && (user.username === comment.author || user.role === 'coach');

    return (
        <>
            <div className={`comment-item ${depth > 0 ? 'comment-reply' : ''}`}>
                <div className="comment-item-header">
                    <span className={`comment-author ${comment.isCoach ? 'comment-author-coach' : ''}`}>
                        {depth > 0 && <span style={{ color: '#9ca3af', marginRight: '4px' }}>↳</span>}
                        {comment.author}
                    </span>
                    <div className="comment-header-right">
                        <span className="comment-date">{getFormattedDate(comment.createdAt)}</span>
                        {(
                            <button
                                className="comment-reply-btn"
                                onClick={() => setShowReplyInput(!showReplyInput)}
                            >
                                답글
                            </button>
                        )}
                        {canDelete && (
                            <button className="comment-delete-btn" onClick={handleDelete}>
                                삭제
                            </button>
                        )}
                    </div>
                </div>
                <div className="comment-content">{comment.content}</div>

                {showReplyInput && (
                    <div className="comment-reply-input-area">
                        <textarea
                            className="comment-input"
                            maxLength={POST_LIMITS.COMMENT_MAX}
                            placeholder={`${comment.author}님에게 답글...`}
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            style={{ minHeight: '36px', fontSize: '0.85rem' }}
                        />
                        <div className="comment-reply-actions">
                            <button
                                className="comment-reply-cancel-btn"
                                onClick={() => { setShowReplyInput(false); setReplyText(''); }}
                            >
                                취소
                            </button>
                            <button
                                className="comment-submit-btn"
                                disabled={!replyText.trim() || submitting}
                                onClick={handleReplySubmit}
                                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                            >
                                {submitting ? '등록 중...' : '등록'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 대댓글 렌더링 */}
            {replies.map((reply) => (
                <CommentItem
                    key={reply.id}
                    comment={reply}
                    user={user}
                    onDelete={onDelete}
                    onReply={onReply}
                    replies={repliesByParent[reply.id] || []}
                    repliesByParent={repliesByParent}
                    depth={depth + 1}
                />
            ))}
        </>
    );
};

export default CommentItem;
