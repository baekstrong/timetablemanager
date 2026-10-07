import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 실제 화면 핸들러를 실행하되 조회·저장·푸시는 모두 모의한다.
// Node 테스트 환경에서 로딩 완료 상태와 답글 입력 상태만 주입한다.
const harness = vi.hoisted(() => ({ states: [], cursor: 0, setters: [] }));
vi.mock('react', async original => ({
    ...await original(),
    useState: initial => {
        const index = harness.cursor++;
        const setter = vi.fn();
        harness.setters.push(setter);
        return [index < harness.states.length ? harness.states[index] : typeof initial === 'function' ? initial() : initial, setter];
    },
    useRef: value => ({ current: value }),
    useEffect: () => {},
    useCallback: callback => callback,
}));
vi.mock('../../services/firebaseService', () => ({
    getPost: vi.fn(), toggleLike: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn(),
    getComments: vi.fn(), createComment: vi.fn(), updateComment: vi.fn(),
    deleteComment: vi.fn(), toggleCommentLike: vi.fn(),
}));
vi.mock('../../services/cloudinaryService', () => ({ uploadToCloudinary: vi.fn() }));
vi.mock('../../services/pushService', () => ({ pushComment: vi.fn(), pushReply: vi.fn() }));
vi.mock('../../services/noticeService', () => ({ markNoticeRead: vi.fn() }));

import { createComment, getComments } from '../../services/firebaseService';
import { pushComment, pushReply } from '../../services/pushService';
import CommentItem from './CommentItem';
import PostDetail from './PostDetail';

const postId = 'test-post';
const user = { username: '검토 학생', role: 'student' };
const post = { id: postId, author: '다른 학생', title: '게시판 검토', content: '본문', category: 'free', likes: [] };
const elements = node => Array.isArray(node) ? node.flatMap(elements)
    : React.isValidElement(node) ? [node, ...elements(node.props.children)] : [];
const injectStates = states => {
    harness.states = states;
    harness.cursor = 0;
    harness.setters = [];
};
const renderPost = ({ comments = [], actor = user, record = post, commentText = '' } = {}) => {
    // post, comments, loadedFor, commentText, submittingComment
    injectStates([record, comments, JSON.stringify([actor.username, postId]), commentText, false]);
    return elements(PostDetail({ postId, user: actor, onBack: vi.fn(), onEdit: vi.fn() }));
};
const submitReply = async (item, content = '답글 검토') => {
    // showReplyInput, replyText, submitting
    injectStates([true, content, false]);
    const nodes = elements(CommentItem(item.props));
    const submit = nodes.find(node => node.type === 'button' && node.props.className === 'comment-submit-btn');
    expect(submit.props.disabled).toBe(false);
    await submit.props.onClick();
};
const rootItem = nodes => nodes.find(node => node.type === CommentItem);
const expectSavedReply = (actor, parentId, content = '답글 검토') => {
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment).toHaveBeenCalledWith(postId, {
        content, author: actor.username, isCoach: actor.role === 'coach', parentId,
    });
    expect(getComments).toHaveBeenCalledWith(postId);
    expect(alert).not.toHaveBeenCalled();
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('React', React);
    vi.stubGlobal('alert', vi.fn());
    createComment.mockResolvedValue({ success: true, id: 'new-comment' });
    getComments.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('게시판 댓글·답글의 본인 알림 제외', () => {
    it('본인 댓글에 답글을 등록하면 댓글을 저장하고 푸시는 호출하지 않는다', async () => {
        const parent = { id: 'own-comment', author: user.username, content: '내 댓글' };
        await submitReply(rootItem(renderPost({ comments: [parent] })));
        expectSavedReply(user, parent.id);
        expect(pushReply).not.toHaveBeenCalled();
        expect(pushComment).not.toHaveBeenCalled();
    });

    it('다른 사람 댓글 아래의 본인 답글에도 답글을 저장하되 푸시는 호출하지 않는다', async () => {
        const parent = { id: 'other-comment', author: '다른 학생', content: '원 댓글' };
        const ownReply = { id: 'own-reply', author: user.username, content: '내 답글', parentId: parent.id };
        const root = rootItem(renderPost({ comments: [parent, ownReply] }));
        injectStates([]);
        const nested = elements(CommentItem(root.props)).find(node => node.type === CommentItem && node.props.comment.id === ownReply.id);
        await submitReply(nested);
        expectSavedReply(user, ownReply.id);
        expect(pushReply).not.toHaveBeenCalled();
        expect(pushComment).not.toHaveBeenCalled();
    });

    it('다른 학생에게 단 답글은 정확한 부모 댓글과 기록을 보내 한 번 알린다', async () => {
        const parent = { id: 'other-comment', author: '다른 학생', content: '원 댓글' };
        await submitReply(rootItem(renderPost({ comments: [parent] })));
        expectSavedReply(user, parent.id);
        expect(pushReply).toHaveBeenCalledOnce();
        expect(pushReply).toHaveBeenCalledWith(postId, parent.id, parent);
        expect(pushComment).not.toHaveBeenCalled();
    });

    it('학생이 코치 댓글에 답글을 달면 코치에게 알린다', async () => {
        const parent = { id: 'coach-comment', author: '검토 코치', isCoach: true, content: '코치 댓글' };
        await submitReply(rootItem(renderPost({ comments: [parent] })));
        expectSavedReply(user, parent.id);
        expect(pushReply).toHaveBeenCalledOnce();
        expect(pushReply).toHaveBeenCalledWith(postId, parent.id, parent);
    });

    it('코치의 예전 표시 이름으로 작성한 본인 댓글도 알리지 않는다', async () => {
        const coach = { username: '현재 코치 이름', role: 'coach' };
        const parent = { id: 'old-coach-comment', author: '예전 코치 이름', isCoach: true, content: '예전 댓글' };
        await submitReply(rootItem(renderPost({ comments: [parent], actor: coach })));
        expectSavedReply(coach, parent.id);
        expect(pushReply).not.toHaveBeenCalled();
    });

    it.each([true, false])('본인 글 여부가 %s이면 메인 댓글 저장 후 해당 글의 알림 여부를 따른다', async ownPost => {
        const record = { ...post, author: ownPost ? user.username : '다른 학생' };
        const nodes = renderPost({ record, commentText: '메인 댓글 검토' });
        const submit = nodes.find(node => node.type === 'button' && node.props.className === 'comment-submit-btn');
        await submit.props.onClick();
        expect(createComment).toHaveBeenCalledWith(postId, { content: '메인 댓글 검토', author: user.username, isCoach: false });
        expect(getComments).toHaveBeenCalledWith(postId);
        expect(pushReply).not.toHaveBeenCalled();
        if (ownPost) expect(pushComment).not.toHaveBeenCalled();
        else {
            expect(pushComment).toHaveBeenCalledOnce();
            expect(pushComment).toHaveBeenCalledWith(postId, record);
        }
        expect(alert).not.toHaveBeenCalled();
    });
});
