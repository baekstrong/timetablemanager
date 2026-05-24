export const getUniqueLikeNames = (likes) => {
    if (!Array.isArray(likes)) return [];

    const seen = new Set();
    return likes
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => {
            if (!name || seen.has(name)) return false;
            seen.add(name);
            return true;
        });
};

export const formatLikeNames = (likes) => getUniqueLikeNames(likes).join(', ');
