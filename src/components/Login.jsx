import { useState, useEffect } from 'react';
import { db, auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { serverLogin } from '../services/authService';
import './Login.css';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [autoLogin, setAutoLogin] = useState(false);
    // 공유 Firebase 세션 확인 중이면 폼 대신 잠깐 배경만 (앱 간 이동 시 로그인 폼 깜빡임 방지)
    const [resolving, setResolving] = useState(!!(auth && localStorage.getItem('savedUser')));

    // 마운트 시: 공유 Firebase Auth 세션 우선 → 없으면 저장된 자격증명 자동로그인
    useEffect(() => {
        const savedCredentials = localStorage.getItem('login_credentials');
        const savedUserRaw = localStorage.getItem('savedUser');

        // 로그인 폼 필드 채우기 (수동 로그인 UX용)
        if (savedCredentials) {
            try {
                const { username: savedUsername, password: savedPassword, autoLogin: savedAutoLogin } = JSON.parse(savedCredentials);
                setUsername(savedUsername || '');
                setPassword(savedPassword || '');
                setRememberMe(true);
                setAutoLogin(savedAutoLogin || false);
            } catch (err) {
                console.error('Failed to load saved credentials:', err);
                localStorage.removeItem('login_credentials');
            }
        }

        // 저장된 자격증명으로 자동로그인 (서버 경로) — 공유 세션 없을 때 폴백
        const runSavedAutoLogin = () => {
            setResolving(false);
            if (!savedCredentials) return;
            try {
                const { username: savedUsername, password: savedPassword, autoLogin: savedAutoLogin } = JSON.parse(savedCredentials);
                if (savedAutoLogin && savedUsername && savedPassword) {
                    console.log('🔄 Auto-login enabled, attempting login...');
                    const quickReturn = sessionStorage.getItem('quickReturn');
                    if (quickReturn) {
                        sessionStorage.removeItem('quickReturn');
                        const credentials = JSON.parse(savedCredentials);
                        credentials.autoLogin = false;
                        localStorage.setItem('login_credentials', JSON.stringify(credentials));
                    }
                    performLogin(savedUsername, savedPassword, true);
                }
            } catch (err) {
                console.error('Auto-login failed:', err);
            }
        };

        // 공유 Firebase Auth 세션이 있으면 서버 재인증 생략하고 즉시 로그인
        if (auth && savedUserRaw) {
            let done = false;
            const finish = (cb) => { if (done) return; done = true; cb(); };
            const unsub = onAuthStateChanged(auth, (fbUser) => {
                unsub();
                if (fbUser) {
                    finish(() => {
                        try {
                            const su = JSON.parse(savedUserRaw);
                            console.log('⚡ 공유 Firebase 세션 — 즉시 로그인 (서버 재인증 생략)');
                            sessionStorage.removeItem('quickReturn');
                            onLogin({ username: su.name, role: su.isCoach ? 'coach' : 'student' });
                        } catch (e) {
                            console.warn('savedUser 파싱 실패, 폴백:', e);
                            runSavedAutoLogin();
                        }
                    });
                } else {
                    finish(runSavedAutoLogin);
                }
            });
            // 안전장치: 2.5초 내 세션 콜백 없으면 폴백
            const t = setTimeout(() => finish(runSavedAutoLogin), 2500);
            return () => { clearTimeout(t); unsub(); };
        }

        // 공유 세션 확인 대상 아님 → 기존 동작
        runSavedAutoLogin();
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
            let isCoach = false;
            try {
                // 서버 로그인: 커스텀 토큰 발급 + signInWithCustomToken (request.auth 채움)
                const result = await serverLogin(name, pass);
                isCoach = result.isCoach;
            } catch (serverErr) {
                setError('❌ ' + (serverErr.message || '로그인에 실패했습니다.'));
                setLoading(false);
                return;
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
            setError('이름과 비밀번호를 입력해주세요.');
            return;
        }

        // Clear saved credentials if remember me is unchecked
        if (!rememberMe) {
            localStorage.removeItem('login_credentials');
            console.log('🗑️ Cleared saved credentials');
        }

        performLogin(username.trim(), password.trim());
    };

    // 공유 세션 확인 중에는 로그인 폼 대신 배경만 (깜빡임 방지)
    if (resolving) {
        return (
            <div className="login-container">
                <div className="login-background">
                    <div className="gradient-orb orb-1"></div>
                    <div className="gradient-orb orb-2"></div>
                    <div className="gradient-orb orb-3"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-container">
            <div className="login-background">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
            </div>

            <div className="login-card">
                <div className="login-header">
                    <h1 className="login-title">근력학교<br />수강 관리 시스템</h1>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="input-group">
                        <label htmlFor="username">이름</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="이름을 입력하세요"
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
                        <p className="input-hint">💡 초기 비밀번호는 전화번호 뒷자리 4자리입니다.</p>
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
                            <span>이름 저장</span>
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
                    <p>비밀번호는 로그인 후 '내 정보'에서<br />원하는 비밀번호로 바꿀 수 있어요.</p>
                </div>
            </div>
        </div>
    );
};

export default Login;
