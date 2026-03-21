import { useState } from 'react';
import { BOARD_CATEGORIES, POST_LIMITS } from '../../data/boardConstants';

const PostForm = ({ user, editingPost, onSubmit, onClose }) => {
    const [category, setCategory] = useState(editingPost?.category || 'free');
    const [title, setTitle] = useState(editingPost?.title || '');
    const [content, setContent] = useState(editingPost?.content || '');
    const [pinned, setPinned] = useState(editingPost?.pinned || false);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!title.trim() || !content.trim()) {
            alert('제목과 내용을 모두 입력해주세요.');
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit({
                category,
                title: title.trim(),
                content: content.trim(),
                pinned: category === 'notice' ? pinned : false,
                author: user.username,
                isCoach: user.role === 'coach',
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="post-form-overlay">
            <div className="post-form-modal" onClick={e => e.stopPropagation()}>
                <h3>📝 {editingPost ? '글 수정' : '글 작성'}</h3>

                {/* Category selector */}
                <div className="post-form-category-select">
                    {BOARD_CATEGORIES.filter(cat => cat.key !== 'all').map(cat => {
                        const isCoachOnly = cat.coachOnly === true;
                        const notCoach = user.role !== 'coach';
                        const disabledByRole = isCoachOnly && notCoach;
                        const disabledByEdit = !!editingPost;
                        const isDisabled = disabledByRole || disabledByEdit;

                        return (
                            <button
                                key={cat.key}
                                className={`board-tab${category === cat.key ? ' active' : ''}`}
                                disabled={isDisabled}
                                style={disabledByRole ? { opacity: 0.4 } : undefined}
                                onClick={() => {
                                    if (isDisabled) return;
                                    setCategory(cat.key);
                                    setPinned(false);
                                }}
                            >
                                {cat.icon} {cat.label}
                            </button>
                        );
                    })}
                </div>

                {/* Title input */}
                <input
                    type="text"
                    className="post-form-input"
                    placeholder="제목을 입력하세요"
                    value={title}
                    maxLength={POST_LIMITS.TITLE_MAX}
                    onChange={e => setTitle(e.target.value)}
                />
                <div style={{ fontSize: '0.8rem', color: '#999', textAlign: 'right', marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
                    {title.length}/{POST_LIMITS.TITLE_MAX}
                </div>

                {/* Content textarea */}
                <textarea
                    className="post-form-textarea"
                    placeholder="내용을 입력하세요"
                    value={content}
                    maxLength={POST_LIMITS.CONTENT_MAX}
                    onChange={e => setContent(e.target.value)}
                />
                <div style={{ fontSize: '0.8rem', color: '#999', textAlign: 'right', marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
                    {content.length}/{POST_LIMITS.CONTENT_MAX}
                </div>

                {/* Pinned checkbox (notice + coach only) */}
                {category === 'notice' && user.role === 'coach' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={pinned}
                            onChange={e => setPinned(e.target.checked)}
                        />
                        📌 상단 고정
                    </label>
                )}

                {/* Action buttons */}
                <div className="post-form-actions">
                    <button
                        style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem', cursor: 'pointer' }}
                        onClick={onClose}
                    >
                        취소
                    </button>
                    <button
                        style={{
                            padding: '8px 16px',
                            background: submitting || !title.trim() || !content.trim()
                                ? '#ccc'
                                : 'linear-gradient(135deg, #667eea, #764ba2)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            cursor: submitting || !title.trim() || !content.trim() ? 'not-allowed' : 'pointer',
                        }}
                        disabled={submitting || !title.trim() || !content.trim()}
                        onClick={handleSubmit}
                    >
                        {submitting ? '저장 중...' : (editingPost ? '수정하기' : '작성하기')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PostForm;
