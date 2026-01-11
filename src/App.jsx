
import { useState } from 'react';
import { GoogleSheetsProvider, useGoogleSheets } from './contexts/GoogleSheetsContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import WeeklySchedule from './components/WeeklySchedule';
import HoldingManager from './components/HoldingManager';
import StudentInfo from './components/StudentInfo';
import StudentManager from './components/StudentManager';
import GoogleSheetsTest from './components/GoogleSheetsTest';
import './App.css';

function AppContent() {
  const [user, setUser] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [currentPage, setCurrentPage] = useState('login'); // 'login', 'dashboard', 'schedule', 'holding', 'myinfo', 'students', 'training', 'test'
  const { getStudentByName } = useGoogleSheets();

  const handleLogin = async (userData) => {
    setUser(userData);

    // If student role, fetch their data from Google Sheets
    if (userData.role === 'student') {
      try {
        const data = await getStudentByName(userData.username);
        setStudentData(data);
        console.log('📊 Loaded student data:', data);
      } catch (error) {
        console.error('Failed to load student data:', error);
        // Continue with login even if data fetch fails
      }
    }

    setCurrentPage('dashboard');
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
        return <HoldingManager user={user} onBack={handleBackToDashboard} />;

      case 'myinfo':
        return <StudentInfo user={user} studentData={studentData} onBack={handleBackToDashboard} />;

      case 'students':
        return <StudentManager user={user} onBack={handleBackToDashboard} />;

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
