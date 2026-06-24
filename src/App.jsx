
import { useState, useEffect } from 'react';
import { GoogleSheetsProvider, useGoogleSheets } from './contexts/GoogleSheetsContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import WeeklySchedule from './components/WeeklySchedule';
import HoldingManager from './components/HoldingManager';
import HolidayManager from './components/HolidayManager';
import StudentInfo from './components/StudentInfo';
import StudentManager from './components/StudentManager';
import GoogleSheetsTest from './components/GoogleSheetsTest';
import NewStudentRegistration from './components/NewStudentRegistration';
import CoachNewStudents from './components/CoachNewStudents';
import ContractView from './components/ContractView';
import Ranking from './components/Ranking';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import BottomNav from './components/BottomNav';
import ImpersonationBanner from './components/ImpersonationBanner';
import UpdateBanner from './components/UpdateBanner';
import { startVersionCheck } from './utils/versionCheck';
import { getPendingRegistrationCount, getActiveWaitlistRequests, getPendingContractForStudent, getLatestPostCreatedAt, getNewStudentRegistrations, isMonthlyStampDone } from './services/firebaseService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './config/firebase';
import './App.css';

const IMPERSONATION_STORAGE_KEY = 'impersonation_origin';
const NOTIFICATION_POLL_INTERVAL = 5 * 60 * 1000;

const isPageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

function AppContent() {
  // Check for ?register=true URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const isRegistrationMode = urlParams.get('register') === 'true';

  if (isRegistrationMode) {
    return <NewStudentRegistration />;
  }

  const [user, setUser] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [currentPage, setCurrentPage] = useState('login');
  const [rankingInitialTab, setRankingInitialTab] = useState('ranking');
  const [rankingInitialStudent, setRankingInitialStudent] = useState('');
  const [impersonationOrigin, setImpersonationOrigin] = useState(null); // 코치 본체 (빙의 중일 때만 채워짐)
  const [hasNewStudentNotification, setHasNewStudentNotification] = useState(false);
  const [hasWaitlistNotification, setHasWaitlistNotification] = useState(false);
  const [hasContractNotification, setHasContractNotification] = useState(false);
  const [hasNewPostNotification, setHasNewPostNotification] = useState(false);
  const [hasStampPendingNotification, setHasStampPendingNotification] = useState(false);
  const [isStudentDataLoading, setIsStudentDataLoading] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { getStudentByName, findStudentAcrossSheets } = useGoogleSheets();

  // 새 빌드 배포 감지 → 상단 새로고침 안내 배너
  useEffect(() => {
    return startVersionCheck(() => setUpdateAvailable(true));
  }, []);

  // Poll for pending registrations (coach only)
  useEffect(() => {
    if (!user || user.role !== 'coach') return;

    const checkPending = async () => {
      try {
        const count = await getPendingRegistrationCount();
        // 대기(만석) 건 중 여석 발생한 건도 체크
        const waitlistRegs = await getNewStudentRegistrations('waitlist');
        const hasAvailable = waitlistRegs.some(r => r.hasAvailableSlots);
        setHasNewStudentNotification(count > 0 || hasAvailable);
      } catch {
        // ignore polling errors
      }
    };

    const checkPendingIfVisible = () => {
      if (isPageVisible()) checkPending();
    };

    checkPendingIfVisible();
    const interval = setInterval(checkPendingIfVisible, NOTIFICATION_POLL_INTERVAL);
    const onVisible = () => checkPendingIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  // 코치: 이번 달 도장 미완료면 훈련일지 탭에 빨간점
  useEffect(() => {
    if (!user || user.role !== 'coach') return;

    const checkStamp = async () => {
      try {
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const done = await isMonthlyStampDone(monthStr);
        setHasStampPendingNotification(!done);
      } catch {
        // ignore polling errors
      }
    };

    const checkIfVisible = () => { if (isPageVisible()) checkStamp(); };
    checkIfVisible();
    const interval = setInterval(checkIfVisible, NOTIFICATION_POLL_INTERVAL);
    const onVisible = () => checkIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  // Poll for waitlist + contract notifications (student only)
  useEffect(() => {
    if (!user || user.role === 'coach') return;

    const checkStudentNotifications = async () => {
      try {
        const [waitlist, contract] = await Promise.all([
          getActiveWaitlistRequests(user.username),
          getPendingContractForStudent(user.username)
        ]);
        setHasWaitlistNotification(waitlist.some(w => w.status === 'notified'));
        setHasContractNotification(!!contract);
      } catch {
        // ignore polling errors
      }
    };

    const checkStudentNotificationsIfVisible = () => {
      if (isPageVisible()) checkStudentNotifications();
    };

    checkStudentNotificationsIfVisible();
    const interval = setInterval(checkStudentNotificationsIfVisible, NOTIFICATION_POLL_INTERVAL);
    const onVisible = () => checkStudentNotificationsIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  // 새 게시글 알림: 전체 posts 실시간 구독 대신 최신 1건만 저빈도 조회
  useEffect(() => {
    if (!user) return;

    const checkNewPostIfVisible = async () => {
      if (!isPageVisible()) return;
      try {
        const lastSeen = parseInt(localStorage.getItem('board_last_seen') || '0');
        const latestPostTime = await getLatestPostCreatedAt();
        setHasNewPostNotification(latestPostTime > lastSeen);
      } catch {
        // ignore polling errors
      }
    };

    checkNewPostIfVisible();
    const interval = setInterval(checkNewPostIfVisible, NOTIFICATION_POLL_INTERVAL);
    const onVisible = () => checkNewPostIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const handleLogin = async (userData) => {
    setUser(userData);

    // Check if there's a target page from bottom nav (e.g. navigating from training log)
    const targetPage = sessionStorage.getItem('targetPage');
    if (targetPage) {
      sessionStorage.removeItem('targetPage');
      setCurrentPage(targetPage);
    } else {
      setCurrentPage('dashboard');
    }

    // If student role, fetch their data from Google Sheets in background
    if (userData.role === 'student') {
      setIsStudentDataLoading(true);
      // Don't await - let it load in background
      (async () => {
        try {
          // 먼저 현재 월에서 빠르게 검색 (빠른 초기 로딩)
          console.log('🔍 Searching for student in current month...');
          const data = await getStudentByName(userData.username);

          if (data) {
            setStudentData(data);
            console.log('📊 Loaded student data from current month:', data);
          }

          // 여러 시트에서 검색하여 이전/다음 등록 정보도 포함된 데이터로 갱신
          console.log('🔍 Searching across multiple sheets for complete registration info...');
          const result = await findStudentAcrossSheets(userData.username);

          if (result) {
            setStudentData(result.student);
            console.log(`📊 Updated student data from ${result.foundSheetName}:`, result.student);
          } else if (!data) {
            console.warn('❌ Student not found in any sheet');
          }
        } catch (error) {
          console.error('Failed to load student data:', error);
          // Continue even if data fetch fails
        } finally {
          setIsStudentDataLoading(false);
        }
      })();
    }
  };

  const loadStudentDataInBackground = (studentName) => {
    setIsStudentDataLoading(true);
    (async () => {
      try {
        const data = await getStudentByName(studentName);
        if (data) setStudentData(data);
        const result = await findStudentAcrossSheets(studentName);
        if (result) setStudentData(result.student);
        else if (!data) console.warn('❌ Student not found in any sheet');
      } catch (error) {
        console.error('Failed to load student data:', error);
      } finally {
        setIsStudentDataLoading(false);
      }
    })();
  };

  const handleStartImpersonation = async (student) => {
    if (!user || user.role !== 'coach') return;
    const studentName = student?.['이름'];
    if (!studentName) return;

    const origin = user;
    setImpersonationOrigin(origin);

    // 훈련일지 서브앱이 localStorage.savedUser로 세션 판별하므로 학생 계정으로 갈아끼움
    // 원래 코치 savedUser/login_credentials는 백업해뒀다가 빙의 종료 시 복원
    // (훈련일지 복귀 시 학생 savedUser 기반으로 login_credentials를 덮어쓰므로 둘 다 백업 필요)
    const savedUserBackup = localStorage.getItem('savedUser');
    const loginCredentialsBackup = localStorage.getItem('login_credentials');
    let studentPassword = '';
    try {
      if (db) {
        const snap = await getDoc(doc(db, 'users', studentName));
        if (snap.exists()) studentPassword = snap.data()?.password || '';
      }
    } catch (err) {
      console.warn('Failed to fetch student password for impersonation:', err);
    }
    try {
      localStorage.setItem('savedUser', JSON.stringify({
        name: studentName,
        password: studentPassword,
        isCoach: false
      }));
    } catch {}

    try {
      sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify({
        originUser: origin,
        impersonatedName: studentName,
        savedUserBackup,
        loginCredentialsBackup
      }));
    } catch (err) {
      console.warn('Failed to persist impersonation:', err);
    }

    setUser({ username: studentName, role: 'student' });
    setStudentData(null);
    setCurrentPage('dashboard');
    window.scrollTo(0, 0);
    loadStudentDataInBackground(studentName);
  };

  const handleExitImpersonation = () => {
    const origin = impersonationOrigin;

    // 백업해둔 코치 savedUser + login_credentials 복원
    // (훈련일지 복귀 시 학생용으로 덮어써졌을 수 있으므로 둘 다 복원)
    try {
      const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.savedUserBackup) {
        localStorage.setItem('savedUser', parsed.savedUserBackup);
      } else {
        localStorage.removeItem('savedUser');
      }
      if (parsed?.loginCredentialsBackup) {
        localStorage.setItem('login_credentials', parsed.loginCredentialsBackup);
      }
    } catch (err) {
      console.warn('Failed to restore savedUser:', err);
    }

    try { sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY); } catch {}
    setImpersonationOrigin(null);
    setStudentData(null);
    if (origin) {
      setUser(origin);
      setCurrentPage('students');
    } else {
      setUser(null);
      setCurrentPage('login');
    }
    window.scrollTo(0, 0);
  };

  // 새로고침/훈련일지 복귀 후 빙의 상태 복원
  // - 훈련일지에서 돌아오면 login_credentials가 학생용으로 덮어써져 학생으로 auto-login 됨
  //   → user.role과 무관하게 sessionStorage에 빙의 데이터 있으면 강제로 빙의 모드로 진입
  useEffect(() => {
    if (!user) return;
    try {
      const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.impersonatedName || !parsed?.originUser) return;

      const alreadyImpersonatingTarget =
        user.role === 'student' && user.username === parsed.impersonatedName;

      if (alreadyImpersonatingTarget) {
        // 이미 빙의 대상으로 로그인되어 있음 → origin만 복원해서 배너 띄움
        if (!impersonationOrigin) {
          setImpersonationOrigin(parsed.originUser);
          if (!studentData) loadStudentDataInBackground(parsed.impersonatedName);
        }
      } else if (!impersonationOrigin) {
        // 다른 계정으로 로그인되어 있으면 빙의 대상으로 강제 전환
        setImpersonationOrigin(parsed.originUser);
        setUser({ username: parsed.impersonatedName, role: 'student' });
        setStudentData(null);
        loadStudentDataInBackground(parsed.impersonatedName);
      }
    } catch (err) {
      console.warn('Failed to restore impersonation:', err);
    }
  }, [user]);

  const handleLogout = () => {
    // Disable auto-login but preserve saved credentials if "Remember Me" was checked
    const savedCredentials = localStorage.getItem('login_credentials');
    if (savedCredentials) {
      try {
        const credentials = JSON.parse(savedCredentials);
        credentials.autoLogin = false; // Disable auto-login
        localStorage.setItem('login_credentials', JSON.stringify(credentials));
      } catch (err) {
        console.error('Failed to update credentials:', err);
      }
    }

    // Clear training log session to sync logout
    localStorage.removeItem('savedUser');
    try { sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY); } catch {}

    setUser(null);
    setStudentData(null);
    setImpersonationOrigin(null);
    setCurrentPage('login');
  };

  const handleNavigate = (page, subTab, student) => {
    if (page === 'dashboard') {
      localStorage.setItem('board_last_seen', String(Date.now()));
      setHasNewPostNotification(false);
    }
    if (page === 'ranking') {
      setRankingInitialTab(subTab || 'ranking');
      setRankingInitialStudent(student || '');
    }
    setCurrentPage(page);
    window.scrollTo(0, 0);
  };

  const handleBackToDashboard = () => {
    setCurrentPage('dashboard');
    window.scrollTo(0, 0);
  };

  // Render current page
  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <Login onLogin={handleLogin} />;

      case 'dashboard':
        return <Dashboard user={user} onNavigate={handleNavigate} onLogout={handleLogout} />;

      case 'schedule':
        return <WeeklySchedule user={user} studentData={studentData} onBack={handleBackToDashboard} onNavigate={handleNavigate} />;

      case 'holding':
        return <HoldingManager user={user} studentData={studentData} isLoading={isStudentDataLoading} onBack={handleBackToDashboard} />;

      case 'myinfo':
        return <StudentInfo user={user} studentData={studentData} isImpersonating={Boolean(impersonationOrigin)} onBack={handleBackToDashboard} />;

      case 'students':
        return <StudentManager user={user} onBack={handleBackToDashboard} onImpersonate={handleStartImpersonation} onNavigate={handleNavigate} />;

      case 'holidays':
        return <HolidayManager user={user} onBack={handleBackToDashboard} />;

      case 'newstudents':
        return <CoachNewStudents user={user} onBack={handleBackToDashboard} />;

      case 'contractView':
        return <ContractView user={user} onBack={handleBackToDashboard} />;

      case 'ranking':
        return <Ranking user={user} onBack={handleBackToDashboard} initialTab={rankingInitialTab} initialStudent={rankingInitialStudent} />;

      case 'analytics':
        return <AnalyticsDashboard onBack={() => setCurrentPage('students')} />;

      case 'training':
        return (
          <div className="coming-soon">
            <button onClick={handleBackToDashboard} className="back-button">뒤로가기</button>
            <h1>훈련일지</h1>
            <p>준비 중입니다...</p>
          </div>
        );

      case 'test':
        return <GoogleSheetsTest />;

      default:
        return <Login onLogin={handleLogin} />;
    }
  };

  return (
    <div className="app">
      {updateAvailable && <UpdateBanner />}
      {impersonationOrigin && user && user.role === 'student' && (
        <ImpersonationBanner studentName={user.username} onExit={handleExitImpersonation} />
      )}
      {renderPage()}
      {currentPage !== 'login' && user && (
        <BottomNav
          currentPage={currentPage}
          user={user}
          onNavigate={handleNavigate}
          hasNewStudentNotification={hasNewStudentNotification}
          hasWaitlistNotification={hasWaitlistNotification}
          hasContractNotification={hasContractNotification}
          hasNewPostNotification={hasNewPostNotification}
          hasStampPendingNotification={hasStampPendingNotification}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <GoogleSheetsProvider>
      <AppContent />
    </GoogleSheetsProvider>
  );
}

export default App;
