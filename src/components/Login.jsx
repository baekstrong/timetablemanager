import { useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { collection, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import './Login.css';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
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
                    console.log('🔄 Auto-login enabled, attempting login...');

                    // Check if this is a quick return from training log
                    const quickReturn = sessionStorage.getItem('quickReturn');
                    if (quickReturn) {
                        console.log('⚡ Quick return detected - using fast login');
                        sessionStorage.removeItem('quickReturn');

                        // Disable auto-login after this one-time use
                        const credentials = JSON.parse(savedCredentials);
                        credentials.autoLogin = false;
                        localStorage.setItem('login_credentials', JSON.stringify(credentials));
                    }

                    performLogin(savedUsername, savedPassword, true);
                }
            } catch (err) {
                console.error('Failed to load saved credentials:', err);
                localStorage.removeItem('login_credentials');
            }
        }
    }, []);

    // Perform login with Firestore
    const performLogin = async (name, pass, isAutoLogin = false) => {
        if (!db) {
            setError('Firebase가 연결되지 않았습니다.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Check if user exists in Firestore users collection
            const userRef = doc(db, 'users', name);
            const userDoc = await getDoc(userRef);

            let isCoach = false;

            if (userDoc.exists()) {
                const userData = userDoc.data();

                // Verify password
                if (userData.password !== pass) {
                    setError('❌ 비밀번호가 올바르지 않습니다!');
                    setLoading(false);
                    return;
                }

                isCoach = userData.isCoach || false;
            } else {
                // Create new user if not exists
                await setDoc(userRef, {
                    password: pass,
                    isCoach: false,
                    createdAt: serverTimestamp()
                });

                isCoach = false;
                if (!isAutoLogin) {
                    alert('✅ 계정이 생성되었습니다! 환영합니다.');
                }
            }

            // Save credentials if remember me is checked
            if (rememberMe || isAutoLogin) {
                const credentials = {
                    username: name,
                    password: pass,
                    autoLogin: autoLogin || isAutoLogin
                };
                localStorage.setItem('login_credentials', JSON.stringify(credentials));
                console.log('💾 Saved login credentials');
            }

            // Also save in training log format for seamless transition
            // Training log uses 'savedUser' key with {name, password, isCoach}
            localStorage.setItem('savedUser', JSON.stringify({
                name: name,
                password: pass,
                isCoach: isCoach
            }));
            console.log('💾 Saved training log session');

            console.log('✅ 로그인 성공!', { username: name, isCoach });

            // Call onLogin with user info
            onLogin({
                username: name,
                role: isCoach ? 'coach' : 'student'
            });

        } catch (err) {
            console.error('❌ 로그인 오류:', err);

            if (err.code === 'permission-denied') {
                setError('Firebase 권한 오류입니다. 관리자에게 문의하세요.');
            } else {
                setError('로그인에 실패했습니다: ' + err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!username.trim() || !password.trim()) {
            setError('아이디와 비밀번호를 입력해주세요.');
            return;
        }

        // Clear saved credentials if remember me is unchecked
        if (!rememberMe) {
            localStorage.removeItem('login_credentials');
            console.log('🗑️ Cleared saved credentials');
        }

        performLogin(username.trim(), password.trim());
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
                    <h1 className="login-title">근력학교 수강 관리 시스템</h1>
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
                            disabled={loading}
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
                            disabled={loading}
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
                                disabled={loading}
                            />
                            <span>아이디 저장</span>
                        </label>

                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={autoLogin}
                                onChange={(e) => setAutoLogin(e.target.checked)}
                                disabled={!rememberMe || loading}
                            />
                            <span>자동 로그인</span>
                        </label>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="login-button" disabled={loading}>
                        <span>{loading ? '로그인 중...' : '로그인'}</span>
                        {!loading && (
                            <svg className="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        )}
                    </button>
                </form>

                <div className="login-footer">
                    <p>처음이신가요? 원하시는 아이디와 비밀번호로 로그인하면<br />자동으로 새 계정이 생성됩니다.</p>
                </div>
            </div>
        </div>
    );
};

export default Login;
