const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

const TRAILING_PUNCT = /[).,!?;:'"\]\}>]+$/;

export const linkifyText = (text) => {
    if (!text) return text;
    const matches = [...text.matchAll(URL_REGEX)];
    if (matches.length === 0) return text;

    const parts = [];
    let lastIndex = 0;

    for (const match of matches) {
        const matchStart = match.index;
        let url = match[0];

        const trailing = url.match(TRAILING_PUNCT);
        let trailingText = '';
        if (trailing) {
            trailingText = trailing[0];
            url = url.slice(0, url.length - trailingText.length);
        }

        if (matchStart > lastIndex) {
            parts.push(text.slice(lastIndex, matchStart));
        }

        const href = url.startsWith('http') ? url : `https://${url}`;
        parts.push(
            <a
                key={`${matchStart}-${url}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
            >
                {url}
            </a>
        );

        if (trailingText) parts.push(trailingText);
        lastIndex = matchStart + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
};
