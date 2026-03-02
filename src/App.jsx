
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
import BottomNav from './components/BottomNav';
import { getPendingRegistrationCount, getActiveWaitlistRequests } from './services/firebaseService';
import './App.css';

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
  const [hasNewStudentNotification, setHasNewStudentNotification] = useState(false);
  const [hasWaitlistNotification, setHasWaitlistNotification] = useState(false);
  const { getStudentByName, findStudentAcrossSheets } = useGoogleSheets();

  // Poll for pending registrations (coach only)
  useEffect(() => {
    if (!user || user.role !== 'coach') return;

    const checkPending = async () => {
      try {
        const count = await getPendingRegistrationCount();
        setHasNewStudentNotification(count > 0);
      } catch (err) {
        // ignore polling errors
      }
    };

    checkPending();
    const interval = setInterval(checkPending, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Poll for waitlist notifications (student only)
  useEffect(() => {
    if (!user || user.role === 'coach') return;

    const checkWaitlist = async () => {
      try {
        const waitlist = await getActiveWaitlistRequests(user.username);
        setHasWaitlistNotification(waitlist.some(w => w.status === 'notified'));
      } catch (err) {
        // ignore polling errors
      }
    };

    checkWaitlist();
    const interval = setInterval(checkWaitlist, 30000);
    return () => clearInterval(interval);
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
      // Don't await - let it load in background
      (async () => {
        try {
          // 먼저 현재 월에서 빠르게 검색
          console.log('🔍 Searching for student in current month...');
          const data = await getStudentByName(userData.username);

          if (data) {
            setStudentData(data);
            console.log('📊 Loaded student data from current month:', data);
          } else {
            // 현재 월에 없으면 여러 시트에서 검색 (더 느림)
            console.log('⚠️ Student not found in current month, searching across multiple sheets...');
            const result = await findStudentAcrossSheets(userData.username);

            if (result) {
              setStudentData(result.student);
              console.log(`📊 Loaded student data from ${result.sheetName}:`, result.student);
            } else {
              console.warn('❌ Student not found in any sheet');
            }
          }
        } catch (error) {
          console.error('Failed to load student data:', error);
          // Continue even if data fetch fails
        }
      })();
    }
  };

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

    setUser(null);
    setStudentData(null);
    setCurrentPage('login');
  };

  const handleNavigate = (page) => {
    setCurrentPage(page);
  };

  const handleBackToDashboard = () => {
    setCurrentPage('dashboard');
  };

  // Render current page
  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <Login onLogin={handleLogin} />;

      case 'dashboard':
        return <Dashboard user={user} onNavigate={handleNavigate} onLogout={handleLogout} />;

      case 'schedule':
        return <WeeklySchedule user={user} studentData={studentData} onBack={handleBackToDashboard} />;

      case 'holding':
        return <HoldingManager user={user} studentData={studentData} onBack={handleBackToDashboard} />;

      case 'myinfo':
        return <StudentInfo user={user} studentData={studentData} onBack={handleBackToDashboard} />;

      case 'students':
        return <StudentManager user={user} onBack={handleBackToDashboard} />;

      case 'holidays':
        return <HolidayManager user={user} onBack={handleBackToDashboard} />;

      case 'newstudents':
        return <CoachNewStudents user={user} onBack={handleBackToDashboard} />;

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
      {renderPage()}
      {currentPage !== 'login' && user && (
        <BottomNav
          currentPage={currentPage}
          user={user}
          onNavigate={handleNavigate}
          hasNewStudentNotification={hasNewStudentNotification}
          hasWaitlistNotification={hasWaitlistNotification}
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
