import { useState, useRef } from 'react';
import { BOARD_CATEGORIES, POST_LIMITS } from '../../data/boardConstants';
import { uploadMultipleImages } from '../../services/cloudinaryService';

const MAX_IMAGES = 5;

const PostForm = ({ user, editingPost, onSubmit, onClose }) => {
    const [category, setCategory] = useState(editingPost?.category || 'free');
    const [title, setTitle] = useState(editingPost?.title || '');
    const [content, setContent] = useState(editingPost?.content || '');
    const [pinned, setPinned] = useState(editingPost?.pinned || false);
    const [submitting, setSubmitting] = useState(false);

    // 이미지 관련 state
    const [existingImages, setExistingImages] = useState(editingPost?.images || []);
    const [newFiles, setNewFiles] = useState([]);       // File 객체들
    const [previews, setPreviews] = useState([]);        // 미리보기 URL들
    const [uploadProgress, setUploadProgress] = useState('');
    const fileInputRef = useRef(null);

    const totalImageCount = existingImages.length + newFiles.length;

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const remaining = MAX_IMAGES - totalImageCount;
        if (remaining <= 0) {
            alert(`사진은 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
            return;
        }

        const selected = files.slice(0, remaining);
        if (files.length > remaining) {
            alert(`${remaining}장만 추가할 수 있습니다. (최대 ${MAX_IMAGES}장)`);
        }

        // 미리보기 생성
        const newPreviews = selected.map(file => URL.createObjectURL(file));
        setNewFiles(prev => [...prev, ...selected]);
        setPreviews(prev => [...prev, ...newPreviews]);

        // input 초기화 (같은 파일 재선택 가능)
        e.target.value = '';
    };

    const removeExistingImage = (index) => {
        setExistingImages(prev => prev.filter((_, i) => i !== index));
    };

    const removeNewFile = (index) => {
        URL.revokeObjectURL(previews[index]);
        setNewFiles(prev => prev.filter((_, i) => i !== index));
        setPreviews(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (!title.trim() || !content.trim()) {
            alert('제목과 내용을 모두 입력해주세요.');
            return;
        }
        setSubmitting(true);
        try {
            // 새 이미지 업로드
            let uploadedImages = [];
            if (newFiles.length > 0) {
                setUploadProgress('사진 업로드 중...');
                uploadedImages = await uploadMultipleImages(newFiles, (done, total) => {
                    setUploadProgress(`사진 업로드 중... (${done}/${total})`);
                });
            }

            const allImages = [
                ...existingImages,
                ...uploadedImages,
            ];

            await onSubmit({
                category,
                title: title.trim(),
                content: content.trim(),
                pinned: category === 'notice' ? pinned : false,
                author: user.username,
                isCoach: user.role === 'coach',
                images: allImages,
            });

            // 미리보기 URL 정리
            previews.forEach(url => URL.revokeObjectURL(url));
        } finally {
            setSubmitting(false);
            setUploadProgress('');
        }
    };

    return (
        <div className="post-form-overlay">
            <div className="post-form-modal" onClick={e => e.stopPropagation()}>
                <h3>{editingPost ? '글 수정' : '글 작성'}</h3>

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

                {/* Image upload */}
                <div className="post-form-images">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />
                    <button
                        type="button"
                        className="post-form-image-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={totalImageCount >= MAX_IMAGES}
                    >
                        {totalImageCount >= MAX_IMAGES
                            ? `사진 ${MAX_IMAGES}장 최대`
                            : `사진 추가 (${totalImageCount}/${MAX_IMAGES})`}
                    </button>

                    {/* 미리보기 */}
                    {(existingImages.length > 0 || previews.length > 0) && (
                        <div className="post-form-image-previews">
                            {existingImages.map((img, i) => (
                                <div key={`existing-${i}`} className="post-form-image-thumb">
                                    <img src={img.url} alt="" />
                                    <button
                                        className="post-form-image-remove"
                                        onClick={() => removeExistingImage(i)}
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                            {previews.map((url, i) => (
                                <div key={`new-${i}`} className="post-form-image-thumb">
                                    <img src={url} alt="" />
                                    <button
                                        className="post-form-image-remove"
                                        onClick={() => removeNewFile(i)}
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pinned checkbox (notice + coach only) */}
                {category === 'notice' && user.role === 'coach' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={pinned}
                            onChange={e => setPinned(e.target.checked)}
                        />
                        상단 고정
                    </label>
                )}

                {/* Upload progress */}
                {uploadProgress && (
                    <div style={{ fontSize: '0.85rem', color: '#667eea', marginBottom: '0.5rem', textAlign: 'center' }}>
                        {uploadProgress}
                    </div>
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
                        {submitting ? (uploadProgress || '저장 중...') : (editingPost ? '수정하기' : '작성하기')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PostForm;
