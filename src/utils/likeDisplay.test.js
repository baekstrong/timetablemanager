import { describe, expect, it } from 'vitest';
import { formatLikeNames } from './likeDisplay';

describe('formatLikeNames', () => {
    it('returns empty text when there are no likers', () => {
        expect(formatLikeNames([])).toBe('');
        expect(formatLikeNames(null)).toBe('');
    });

    it('shows every liker name in order', () => {
        expect(formatLikeNames(['김철수', '이영희', '박민수'])).toBe('김철수, 이영희, 박민수');
    });

    it('removes blank and duplicate names before display', () => {
        expect(formatLikeNames(['김철수', ' ', '김철수', '이영희'])).toBe('김철수, 이영희');
    });
});
