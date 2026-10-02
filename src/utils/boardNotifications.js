const normalizedName = value => String(value || '').normalize('NFC').trim();

// 코치 표시 이름이 바뀐 예전 글도 본인 글로 취급한다(단일 코치 앱).
export const shouldNotifyBoardAuthor = (record, user) => {
    const author = normalizedName(record?.author);
    const name = normalizedName(user?.username);
    return Boolean(author && name && !record.deleted
        && author !== name && !(record.isCoach && user.role === 'coach'));
};
