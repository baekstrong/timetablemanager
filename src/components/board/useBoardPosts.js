import { useEffect, useRef, useState } from 'react';
import { getPostsPage } from '../../services/firebaseService';
import { POST_LIMITS } from '../../data/boardConstants';

export function useBoardPosts(readPage = getPostsPage) {
    const [selection, setSelection] = useState({ category: 'all', page: 1, revision: 0 });
    const [result, setResult] = useState(null);
    const cursors = useRef(null);
    const { category, page, revision } = selection;
    const scope = JSON.stringify([category, revision]);
    const key = JSON.stringify([category, page, revision]);
    const loaded = result?.key === key;

    useEffect(() => {
        if (loaded) return;
        let active = true;
        if (cursors.current?.scope !== scope) cursors.current = { scope, pages: { 1: null } };
        const pages = cursors.current.pages;
        async function load() {
            try {
                // 이전 페이지 커서만 보관한다. 삭제/수정 뒤에는 처음부터 다시 확인하고
                // 마지막 페이지가 사라졌으면 마지막 유효 페이지를 그대로 표시한다.
                for (let candidate = 1; candidate <= page; candidate += 1) {
                    if (candidate < page && pages[candidate + 1] !== undefined) continue;
                    const data = await readPage(category, POST_LIMITS.PAGE_SIZE, pages[candidate] ?? null);
                    if (!active) return;
                    for (const number of Object.keys(pages)) if (Number(number) > candidate) delete pages[number];
                    if (data.hasNextPage && data.nextCursor) pages[candidate + 1] = data.nextCursor;
                    if (candidate === page || !data.hasNextPage || !data.nextCursor) {
                        if (candidate !== page) setSelection(current => current.category === category && current.revision === revision && current.page === page
                            ? { ...current, page: candidate } : current);
                        setResult({ key: JSON.stringify([category, candidate, revision]), posts: data.posts, hasNextPage: data.hasNextPage, error: null });
                        return;
                    }
                }
            } catch (error) {
                if (!active) return;
                console.error('게시글 페이지 로드 실패:', error);
                setResult({ key, posts: [], hasNextPage: false, error: '게시글을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
            }
        }
        void load();
        return () => { active = false; };
    }, [category, page, revision, scope, key, loaded, readPage]);

    return {
        posts: loaded ? result.posts : [],
        loading: !loaded,
        error: loaded ? result.error : null,
        category,
        page,
        hasNextPage: loaded && result.hasNextPage,
        setCategory: next => setSelection(current => current.category === next && current.page === 1 ? current : { ...current, category: next, page: 1 }),
        setPage: next => setSelection(current => ({ ...current, page: Math.max(1, Math.floor(Number(next)) || 1) })),
        refresh: ({ firstPage = false } = {}) => setSelection(current => ({ ...current, page: firstPage ? 1 : current.page, revision: current.revision + 1 })),
    };
}
