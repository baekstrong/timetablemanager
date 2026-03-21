const CommentItem = ({ comment, user, onDelete }) => {
    if (!comment) return null;

    // Firestore Timestamp 또는 일반 Date 객체 처리
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

    // 삭제 버튼 표시 조건: 댓글 작성자 또는 코치
    const canDelete = user && (user.username === comment.author || user.role === 'coach');

    return (
        <div className="comment-item">
            <div className="comment-item-header">
                <span className={`comment-author ${comment.isCoach ? 'comment-author-coach' : ''}`}>
                    {comment.author}
                </span>
                <span className="comment-date">{getFormattedDate(comment.createdAt)}</span>
                {canDelete && (
                    <button className="comment-delete-btn" onClick={handleDelete}>
                        삭제
                    </button>
                )}
            </div>
            <div className="comment-content">{comment.content}</div>
        </div>
    );
};

export default CommentItem;
