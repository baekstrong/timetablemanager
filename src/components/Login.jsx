import { useState, useEffect } from 'react';
import './Login.css';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [autoLogin, setAutoLogin] = useState(false);

    // Load saved credentials on component mount
    useEffect(() => {
        const savedCredentials = localStorage.getItem('login_credentials');
        if (savedCredentials) {
            try {
                const { username: savedUsername, password: savedPassword, autoLogin: savedAutoLogin } = JSON.parse(savedCredentials);
                setUsername(savedUsername || '');
                setPassword(savedPassword || '');
                setRememberMe(true);
                setAutoLogin(savedAutoLogin || false);

                // Auto-login if enabled
                if (savedAutoLogin && savedUsername && savedPassword) {
                    console.log('🔄 Auto-login enabled, logging in...');
                    const role = savedUsername.toLowerCase().includes('coach') ? 'coach' : 'student';
                    onLogin({ username: savedUsername, role });
                }
            } catch (err) {
                console.error('Failed to load saved credentials:', err);
                localStorage.removeItem('login_credentials');
            }
        }
    }, [onLogin]);

    const handleSubmit = (e) => {
        e.preventDefault();

        // Simple authentication logic (replace with real authentication)
        if (username && password) {
            // Save credentials if remember me is checked
            if (rememberMe) {
                const credentials = {
                    username,
                    password,
                    autoLogin
                };
                localStorage.setItem('login_credentials', JSON.stringify(credentials));
                console.log('💾 Saved login credentials');
            } else {
                // Clear saved credentials if remember me is unchecked
                localStorage.removeItem('login_credentials');
                console.log('🗑️ Cleared saved credentials');
            }

            // Determine user role based on credentials
            const role = username.toLowerCase().includes('coach') ? 'coach' : 'student';
            onLogin({ username, role });
        } else {
            setError('아이디와 비밀번호를 입력해주세요.');
        }
    };

    return (
        <div className="login-container">
            <div className="login-background">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
            </div>

            <div className="login-card">
                <div className="login-header">
                    <h1 className="login-title">시간표 관리 시스템</h1>
                    <p className="login-subtitle">무제한 수강권 관리 플랫폼</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="input-group">
                        <label htmlFor="username">아이디</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="아이디를 입력하세요"
                            className="login-input"
                        />
                    </div>

                    <div className="input-group">
                        <label htmlFor="password">비밀번호</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="비밀번호를 입력하세요"
                            className="login-input"
                        />
                    </div>

                    <div className="checkbox-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={(e) => {
                                    setRememberMe(e.target.checked);
                                    if (!e.target.checked) {
                                        setAutoLogin(false);
                                    }
                                }}
                            />
                            <span>아이디 저장</span>
                        </label>

                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={autoLogin}
                                onChange={(e) => setAutoLogin(e.target.checked)}
                                disabled={!rememberMe}
                            />
                            <span>자동 로그인</span>
                        </label>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="login-button">
                        <span>로그인</span>
                        <svg className="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </button>
                </form>

                <div className="login-footer">
                    <p>테스트 계정: student / coach</p>
                </div>
            </div>
        </div>
    );
};

export default Login;
