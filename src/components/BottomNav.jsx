import './BottomNav.css';

const BottomNav = ({ currentPage, user, onNavigate, hasNewStudentNotification, hasWaitlistNotification, hasContractNotification, hasNewPostNotification, hasStampPendingNotification, preview = false }) => {
    const coachTabs = [
        {
            id: 'today',
            label: '오늘',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V10z" />
                </svg>
            )
        },
        {
            id: 'schedule',
            label: '시간표',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            )
        },
        {
            id: 'training-log',
            label: '훈련일지',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            )
        },
        {
            id: 'students',
            label: '수강생',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
            )
        },
        {
            id: 'newstudents',
            label: '신규',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                </svg>
            )
        }
    ];

    const studentTabs = [
        {
            id: 'dashboard',
            label: '게시판',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
            )
        },
        {
            id: 'schedule',
            label: '시간표',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            )
        },
        {
            id: 'training-log',
            label: '훈련일지',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
            )
        },
        {
            id: 'myinfo',
            label: '내 정보',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            )
        }
    ];

    const tabs = user.role === 'coach' ? coachTabs : [
        { ...studentTabs[1], label: '내 수업' }, studentTabs[2], studentTabs[0], studentTabs[3],
    ];
    const activePage = user.role === 'coach' ? currentPage
        : currentPage === 'holding' || currentPage === 'today' ? 'schedule'
        : currentPage === 'contractView' ? 'myinfo' : currentPage;

    const handleTabClick = (tabId) => {
        if (tabId === 'training-log' && !preview) {
            window.location.assign('./training-log/index.html');
            return;
        }
        onNavigate(tabId);
    };

    return (
        <nav className="bottom-nav" data-role={user.role === 'coach' ? 'coach' : 'student'} aria-label="주요 메뉴">
            {tabs.map(tab => {
                const isActive = activePage === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        className={`bottom-nav-tab ${isActive ? 'active' : ''}`}
                        onClick={() => handleTabClick(tab.id)}
                    >
                        <div className="tab-indicator" />
                        <div className="tab-icon" aria-hidden="true">
                            {tab.icon}
                            {tab.id === 'newstudents' && hasNewStudentNotification && (
                                <span className="notification-dot" />
                            )}
                            {((tab.id === 'today' && (hasWaitlistNotification || hasContractNotification))
                                || (tab.id === 'schedule' && user.role !== 'coach' && hasWaitlistNotification)
                                || (tab.id === 'myinfo' && hasContractNotification)
                                || (tab.id === 'dashboard' && hasNewPostNotification)) && (
                                <span className="notification-dot" />
                            )}
                            {tab.id === 'training-log' && hasStampPendingNotification && (
                                <span className="notification-dot" />
                            )}
                        </div>
                        <span className="tab-label">{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
};

export default BottomNav;
