import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import './GoogleSheetsSync.css';

const GoogleSheetsSync = () => {
    const {
        isAuthenticated,
        signIn,
        signOut,
        students,
        loading,
        error,
        refresh,
        selectedYear,
        selectedMonth,
        changeMonth,
        currentSheetName
    } = useGoogleSheets();

    const handleSignIn = async () => {
        try {
            await signIn();
        } catch (err) {
            console.error('Sign in error:', err);
        }
    };

    const handleSignOut = () => {
        if (window.confirm('Google Sheets 연동을 해제하시겠습니까?')) {
            signOut();
        }
    };

    const handleRefresh = async () => {
        try {
            await refresh();
        } catch (err) {
            console.error('Refresh error:', err);
        }
    };

    const handleMonthChange = (e) => {
        const [year, month] = e.target.value.split('-');
        changeMonth(parseInt(year), parseInt(month));
    };

    // Generate month options (current month and previous 11 months)
    const generateMonthOptions = () => {
        const options = [];
        const now = new Date();

        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            options.push({
                value: `${year}-${month}`,
                label: `${year}년 ${month}월`,
                year,
                month
            });
        }

        return options;
    };

    return (
        <div className="google-sheets-sync">
            <div className="sync-header">
                <span className="sync-icon">📊</span>
                <h3>Google Sheets 연동</h3>
            </div>

            {error && (
                <div className="sync-error">
                    ⚠️ {error}
                </div>
            )}

            {!isAuthenticated ? (
                <div className="sync-content">
                    <p className="sync-description">
                        Google Sheets와 연동하여 실시간으로 학생 정보를 동기화합니다.
                    </p>
                    <button onClick={handleSignIn} className="sync-button primary">
                        <span>🔗</span>
                        Google 계정 연결
                    </button>
                </div>
            ) : (
                <div className="sync-content">
                    <div className="sync-status">
                        <span className="status-indicator connected"></span>
                        <span>연동됨</span>
                        {students.length > 0 && (
                            <span className="student-count">학생 {students.length}명</span>
                        )}
                    </div>

                    <div className="month-selector">
                        <label htmlFor="month-select">📅 조회 월:</label>
                        <select
                            id="month-select"
                            value={`${selectedYear}-${selectedMonth}`}
                            onChange={handleMonthChange}
                            disabled={loading}
                        >
                            {generateMonthOptions().map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {currentSheetName && (
                        <div className="current-sheet">
                            <small>현재 시트: <strong>{currentSheetName}</strong></small>
                        </div>
                    )}

                    <div className="sync-actions">
                        <button
                            onClick={handleRefresh}
                            className="sync-button secondary"
                            disabled={loading}
                        >
                            <span>🔄</span>
                            {loading ? '동기화 중...' : '새로고침'}
                        </button>
                        <button onClick={handleSignOut} className="sync-button danger">
                            <span>🔓</span>
                            연동 해제
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GoogleSheetsSync;
