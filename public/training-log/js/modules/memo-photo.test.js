import { describe, it, expect } from 'vitest';
import { isMemoPhotoUrl, memoPhotoUrl, memoPhotoThumbHTML, CLOUD_NAME } from './memo-photo.js';

const base = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
const photo = { url: `${base}v1732400000/training-memo/abc123.jpg`, width: 1280, height: 960 };

describe('메모 사진 주소', () => {
    it('우리 Cloudinary 주소만 허용', () => {
        expect(isMemoPhotoUrl(photo.url)).toBe(true);
        expect(isMemoPhotoUrl('https://evil.example.com/a.jpg')).toBe(false);
        expect(isMemoPhotoUrl(`https://res.cloudinary.com/other/image/upload/a.jpg`)).toBe(false);
        expect(isMemoPhotoUrl(`${base}a.jpg" onerror="alert(1)`)).toBe(false);
        expect(isMemoPhotoUrl(`${base}a.jpg'),alert(1)//`)).toBe(false);
        expect(isMemoPhotoUrl(undefined)).toBe(false);
    });

    it('썸네일·크게 보기 변환을 upload/ 뒤에 넣는다', () => {
        expect(memoPhotoUrl(photo)).toBe(`${base}c_fill,w_144,h_144,q_auto,f_auto/v1732400000/training-memo/abc123.jpg`);
        expect(memoPhotoUrl(photo, 'full')).toBe(`${base}c_limit,w_1200,h_1200,q_auto,f_auto/v1732400000/training-memo/abc123.jpg`);
        expect(memoPhotoUrl({ url: 'javascript:alert(1)' })).toBe('');
        expect(memoPhotoUrl(null)).toBe('');
    });

    it('잘못된 사진은 아무것도 그리지 않는다', () => {
        expect(memoPhotoThumbHTML({ url: 'https://x.com/a.jpg' }, 'f()')).toBe('');
        const html = memoPhotoThumbHTML(photo, "view('a')", 40);
        expect(html).toContain('event.stopPropagation(); view(\'a\')');
        expect(html).toContain('width:40px');
        expect(html).toContain(memoPhotoUrl(photo));
    });
});
