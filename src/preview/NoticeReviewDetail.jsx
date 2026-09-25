import { useEffect, useState } from 'react';

// 로컬 검토 전용. 실제 앱의 공지는 기존 PostDetail 경로를 사용한다.
export default function NoticeReviewDetail({ user, postId, services, onBack, readOnly = true }) {
    const [result, setResult] = useState(null);
    useEffect(() => {
        let cancelled = false;
        services.getPost(postId).then(post => {
            if (!cancelled) setResult({ id: postId, owner: user.username, post: post && !post.deleted && post.category === 'notice' ? post : null });
        }).catch(() => { if (!cancelled) setResult({ id: postId, owner: user.username, error: true }); });
        return () => { cancelled = true; };
    }, [postId, services, user.username]);
    const loaded = result?.id === postId && result?.owner === user.username;
    useEffect(() => {
        if (!readOnly && loaded && result.post) void services.markNoticeRead(user.username, result.post).catch(() => {});
    }, [readOnly, loaded, result, services, user.username]);
    return <article className="slr-unchanged">
        <button type="button" onClick={onBack}>← 내 수업</button>
        {!loaded ? <p role="status">공지를 불러오고 있어요.</p> : result.error ? <p role="alert">공지를 불러오지 못했어요.</p> : !result.post ? <p>공지를 찾을 수 없어요.</p> : <>
            <p>공지</p><h1>{result.post.title}</h1>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.post.content}</p>
            {result.post.images?.map((image, index) => <img key={image.url || index} src={image.url} alt={`공지 첨부 ${index + 1}`} style={{ maxWidth: '100%' }} />)}
        </>}
    </article>;
}
