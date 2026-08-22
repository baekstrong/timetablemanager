import { describe, it, expect } from 'vitest';
import { cleanNewsletter, assertPostable } from './post-newsletter.js';

describe('cleanNewsletter', () => {
    it('노션 마크다운을 게시판 순수 텍스트로 바꾼다', () => {
        const { content, images } = cleanNewsletter([
            '운동하고 나면 다음날 피곤하신가요?',
            '## 저 하나도 안 힘들었는데요?',
            '> 📷 사진 생성 프롬프트: 아침 사무실, 피곤한 직장인',
            '![](https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b/out.png?X-Amz-Signature=deadbeef)',
            '- 자세가 나빠지는가',
            '- 속도가 느려지는가',
            '**핵심**은 강도입니다. \\[구매 링크\\]',
        ].join('\n'));

        expect(content).toBe([
            '운동하고 나면 다음날 피곤하신가요?',
            '',
            '■ 저 하나도 안 힘들었는데요?',
            '',
            '· 자세가 나빠지는가',
            '· 속도가 느려지는가',
            '핵심은 강도입니다. [구매 링크]',
        ].join('\n'));
        expect(images).toEqual(['https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b/out.png?X-Amz-Signature=deadbeef']);
    });

    it('빈 줄이 3개 이상 이어지면 2개로 줄인다', () => {
        expect(cleanNewsletter('가\n\n\n\n나').content).toBe('가\n\n나');
    });
});

describe('assertPostable', () => {
    it('정상 글은 통과한다', () => {
        expect(() => assertPostable('제목', '본문')).not.toThrow();
    });

    it('내부용 사진 프롬프트가 남으면 막는다', () => {
        expect(() => assertPostable('제목', '본문\n사진 생성 프롬프트: 헬스장')).toThrow(/내부용/);
    });

    it('마크다운 이미지가 남으면 막는다', () => {
        expect(() => assertPostable('제목', '본문 ![](https://x/y.png)')).toThrow(/내부용/);
    });

    it('길이 제한을 넘으면 막는다', () => {
        expect(() => assertPostable('가'.repeat(101), '본문')).toThrow(/제목/);
        expect(() => assertPostable('제목', '가'.repeat(5001))).toThrow(/본문/);
    });

    it('빈 제목·본문을 막는다', () => {
        expect(() => assertPostable('', '본문')).toThrow(/제목/);
        expect(() => assertPostable('제목', '')).toThrow(/본문/);
    });
});
