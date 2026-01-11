import { useState } from 'react';
import { GoogleSheetsProvider } from './contexts/GoogleSheetsContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import WeeklySchedule from './components/WeeklySchedule';
import HoldingManager from './components/HoldingManager';
import StudentInfo from './components/StudentInfo';
import StudentManager from './components/StudentManager';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('login'); // 'login', 'dashboard', 'schedule', 'holding', 'myinfo', 'students', 'training'

  const handleLogin = (userData) => {
    setUser(userData);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
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
        return <WeeklySchedule user={user} onBack={handleBackToDashboard} />;

      case 'holding':
        return <HoldingManager user={user} onBack={handleBackToDashboard} />;

      case 'myinfo':
        return <StudentInfo user={user} onBack={handleBackToDashboard} />;

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

      default:
        return <Login onLogin={handleLogin} />;
    }
  };

  return (
    <GoogleSheetsProvider>
      <div className="app">
        {renderPage()}
      </div>
    </GoogleSheetsProvider>
  );
}

export default App;
