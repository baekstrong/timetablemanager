import { BOARD_CATEGORIES, CATEGORY_MAP } from '../../data/boardConstants';

const formatDate = (createdAt) => {
    if (!createdAt) return '';
    const date = createdAt?.toDate?.() ?? new Date(createdAt);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}.${day}`;
};

const PostList = ({
    posts,
    loading,
    error,
    user,
    onPostClick,
    onWriteClick,
    onRetry,
    selectedCategory,
    onCategoryChange,
}) => {
    return (
        <div>
            {/* Category tabs */}
            <div className="board-tabs">
                {BOARD_CATEGORIES.map((category) => (
                    <button
                        key={category.key}
                        className={`board-tab${selectedCategory === category.key ? ' active' : ''}`}
                        onClick={() => onCategoryChange(category.key)}
                    >
                        {category.icon ? `${category.icon} ` : ''}{category.label}
                    </button>
                ))}
            </div>

            {/* States */}
            {loading && (
                <div className="board-empty">게시글을 불러오는 중...</div>
            )}

            {!loading && error && (
                <div className="board-error">
                    <div>{error}</div>
                    <button className="board-retry-btn" onClick={onRetry}>
                        다시 시도
                    </button>
                </div>
            )}

            {!loading && !error && posts.length === 0 && (
                <div className="board-empty">게시글이 없습니다.</div>
            )}

            {/* Post list */}
            {!loading && !error && posts.map((post) => {
                const isPinned = post.pinned && post.category === 'notice';
                const categoryInfo = CATEGORY_MAP[post.category];

                return (
                    <div
                        key={post.id}
                        className={`post-card${isPinned ? ' pinned' : ''}`}
                        onClick={() => onPostClick(post.id)}
                    >
                        <div className="post-card-header">
                            {categoryInfo && (
                                <span
                                    className="post-category-badge"
                                    data-category={post.category}
                                >
                                    {categoryInfo.icon} {categoryInfo.label}
                                </span>
                            )}
                            <span
                                className="post-card-title"
                                style={{ fontWeight: 600, fontSize: '0.9rem' }}
                            >
                                {post.title}
                            </span>
                        </div>
                        <div className="post-card-meta">
                            <span>
                                <span style={post.isCoach ? { color: '#667eea', fontWeight: 600 } : {}}>
                                    {post.author}
                                </span>
                                {' · '}
                                {formatDate(post.createdAt)}
                            </span>
                            <span>
                                {post.likes?.length > 0 && `❤️ ${post.likes.length}`}
                                {post.likes?.length > 0 && post.commentCount > 0 && ' · '}
                                {post.commentCount > 0 && `💬 ${post.commentCount}`}
                            </span>
                        </div>
                    </div>
                );
            })}

            {/* Write button */}
            <div className="write-btn">
                <button onClick={onWriteClick}>✏️ 글쓰기</button>
            </div>
        </div>
    );
};

export default PostList;
