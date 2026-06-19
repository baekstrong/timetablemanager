import { useState } from 'react';
import { BOARD_CATEGORIES, CATEGORY_MAP } from '../../data/boardConstants';
import TierBadge from '../TierBadge';

const SEARCH_MODES = [
    { key: 'title', label: '제목' },
];

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
    onPostClick,
    onWriteClick,
    onRetry,
    selectedCategory,
    onCategoryChange,
    currentPage,
    hasNextPage,
    onPageChange,
    tierMap = {},
}) => {
    const [searchMode, setSearchMode] = useState('title');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearch, setActiveSearch] = useState('');

    // 검색 필터링
    const filteredPosts = activeSearch
        ? posts.filter(post => {
            const q = activeSearch.toLowerCase();
            return post.title?.toLowerCase().includes(q);
        })
        : posts;

    const safePage = Math.max(1, currentPage || 1);
    const pagedPosts = filteredPosts;

    const handleSearch = () => {
        setActiveSearch(searchQuery.trim());
        onPageChange(1);
    };

    const handleClearSearch = () => {
        setSearchQuery('');
        setActiveSearch('');
        onPageChange(1);
    };

    return (
        <div style={{ position: 'relative', paddingBottom: '60px' }}>
            {/* Category tabs */}
            <div className="board-tabs">
                {BOARD_CATEGORIES.map((category) => (
                    <button
                        key={category.key}
                        className={`board-tab${selectedCategory === category.key ? ' active' : ''}`}
                        onClick={() => {
                            setSearchQuery('');
                            setActiveSearch('');
                            onCategoryChange(category.key);
                        }}
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

            {!loading && !error && filteredPosts.length === 0 && (
                <div className="board-empty">
                    {activeSearch ? `"${activeSearch}" 검색 결과가 없습니다.` : '게시글이 없습니다.'}
                    {activeSearch && (
                        <div style={{ marginTop: '8px' }}>
                            <button className="board-retry-btn" onClick={handleClearSearch}>검색 초기화</button>
                        </div>
                    )}
                </div>
            )}

            {/* Post list (current server page) */}
            {!loading && !error && pagedPosts.map((post) => {
                const isPinned = post.pinned && post.category === 'notice';
                const categoryInfo = CATEGORY_MAP[post.category];
                const postDate = post.createdAt?.toDate?.() ?? new Date(post.createdAt);
                const today = new Date();
                const isToday = postDate.getFullYear() === today.getFullYear()
                    && postDate.getMonth() === today.getMonth()
                    && postDate.getDate() === today.getDate();

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
                                {post.imageCount > 0 && <span style={{ marginLeft: '4px', fontSize: '0.75rem', opacity: 0.6 }}>({post.imageCount})</span>}
                                {isToday && <span className="post-new-badge" style={{ marginLeft: '4px', verticalAlign: 'middle' }}>N</span>}
                            </span>
                        </div>
                        <div className="post-card-meta">
                            <span>
                                {!post.isCoach && <TierBadge tier={tierMap[post.author]} />}
                                <span style={post.isCoach ? { color: 'var(--accent)', fontWeight: 600 } : {}}>
                                    {post.author}
                                </span>
                                {' · '}
                                {formatDate(post.createdAt)}
                            </span>
                            <span>
                                {post.likeCount > 0 && `❤️ ${post.likeCount}`}
                                {post.likeCount > 0 && post.commentCount > 0 && ' · '}
                                {post.commentCount > 0 && `💬 ${post.commentCount}`}
                            </span>
                        </div>
                    </div>
                );
            })}

            {/* Pagination */}
            {!loading && !error && !activeSearch && (safePage > 1 || hasNextPage) && (
                <div className="board-pagination">
                    <button
                        className="board-page-btn"
                        disabled={safePage <= 1}
                        onClick={() => onPageChange(safePage - 1)}
                    >
                        ‹ 이전
                    </button>
                    <span className="board-page-current">{safePage}</span>
                    <button
                        className="board-page-btn"
                        disabled={!hasNextPage}
                        onClick={() => onPageChange(safePage + 1)}
                    >
                        다음 ›
                    </button>
                </div>
            )}

            {/* Search */}
            {!loading && !error && (
                <div className="board-search">
                    <div className="board-search-modes">
                        {SEARCH_MODES.map((mode) => (
                            <button
                                key={mode.key}
                                className={`board-tab${searchMode === mode.key ? ' active' : ''}`}
                                onClick={() => setSearchMode(mode.key)}
                                style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                            >
                                {mode.label}
                            </button>
                        ))}
                    </div>
                    <div className="board-search-input-row">
                        <input
                            type="text"
                            className="board-search-input"
                            placeholder="검색어를 입력하세요..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                        />
                        <button className="board-search-btn" onClick={handleSearch}>검색</button>
                        {activeSearch && (
                            <button className="board-search-clear-btn" onClick={handleClearSearch}>초기화</button>
                        )}
                    </div>
                </div>
            )}

            {/* Write button - fixed at bottom */}
            <div className="write-btn-fixed">
                <button onClick={onWriteClick}>✏️ 글쓰기</button>
            </div>
        </div>
    );
};

export default PostList;
