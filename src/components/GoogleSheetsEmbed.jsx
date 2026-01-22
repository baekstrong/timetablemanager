import { useState } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import MonthSelector from './MonthSelector';
import './GoogleSheetsEmbed.css';

const GoogleSheetsEmbed = ({ onBack }) => {
    const { selectedYear, selectedMonth, changeMonth, availableSheets, currentSheetName } = useGoogleSheets();
    const [viewMode, setViewMode] = useState('embed'); // 'table' or 'embed'

    // 구글 시트 ID
    const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID;

    // 임베드 URL 생성
    const embedUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=0#gid=0`;

    // 읽기 전용 임베드 URL
    const readOnlyUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/pubhtml?widget=true&headers=false`;

    return (
        <div className="google-sheets-embed-container">
            <div className="sheets-header">
                <button onClick={onBack} className="back-button">
                    ← 뒤로가기
                </button>
                <h2>수강생 관리 (구글 시트)</h2>
                <div className="view-toggle">
                    <MonthSelector
                        selectedYear={selectedYear}
                        selectedMonth={selectedMonth}
                        onMonthChange={changeMonth}
                        availableSheets={availableSheets}
                    />
                    <button
                        className={viewMode === 'embed' ? 'active' : ''}
                        onClick={() => setViewMode('embed')}
                    >
                        📊 시트 보기
                    </button>
                    <a
                        href={embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="open-new-tab-btn"
                    >
                        🔗 새 탭에서 열기
                    </a>
                </div>
            </div>

            <div className="sheets-content">
                {viewMode === 'embed' ? (
                    <div className="sheets-iframe-wrapper">
                        <iframe
                            src={embedUrl}
                            className="google-sheets-iframe"
                            title="Google Sheets"
                            allowFullScreen
                        />
                        <div className="iframe-overlay-message">
                            <p>💡 팁: 시트를 직접 편집하려면 "새 탭에서 열기"를 클릭하세요.</p>
                            <p>현재 보기는 읽기 전용입니다.</p>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="sheets-info">
                <h3>📝 사용 안내</h3>
                <ul>
                    <li><strong>시트 보기:</strong> 구글 시트를 앱 내에서 직접 확인 (읽기 전용)</li>
                    <li><strong>새 탭에서 열기:</strong> 구글 시트를 새 브라우저 탭에서 열어 편집</li>
                    <li><strong>실시간 동기화:</strong> 시트에서 수정하면 앱에 자동 반영됨</li>
                    <li><strong>필터 및 정렬:</strong> 구글 시트의 모든 기능 사용 가능</li>
                </ul>
            </div>
        </div>
    );
};

export default GoogleSheetsEmbed;
