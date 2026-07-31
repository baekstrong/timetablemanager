// 훈련일지 서브앱 전용 Tailwind 빌드 설정.
// CDN 런타임 JIT(407KB JS + DOM 변경마다 재컴파일)를 정적 CSS로 대체한다.
// 클래스를 추가했는데 스타일이 안 먹으면: npm run build:tl-css 재실행.
module.exports = {
    content: [
        './public/training-log/index.html',
        './public/training-log/js/**/*.js',
    ],
};
