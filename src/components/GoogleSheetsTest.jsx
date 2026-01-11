import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import * as sheetsService from '../services/googleSheetsService';
import { getStudentField } from '../services/googleSheetsService';
import './GoogleSheetsTest.css';

const GoogleSheetsTest = () => {
    const {
        isAuthenticated,
        signIn,
        students,
        loading,
        error,
        refresh,
        currentSheetName
    } = useGoogleSheets();

    const [testResults, setTestResults] = useState([]);
    const [testRunning, setTestRunning] = useState(false);
    const [allSheets, setAllSheets] = useState([]);
    const [rawData, setRawData] = useState(null);

    // Add test result
    const addTestResult = (name, status, message, data = null) => {
        setTestResults(prev => [...prev, {
            name,
            status, // 'success', 'error', 'info'
            message,
            data,
            timestamp: new Date().toLocaleTimeString('ko-KR')
        }]);
    };

    // Test 1: Check environment variables
    const testEnvironmentVariables = () => {
        addTestResult(
            '환경 변수 확인',
            'info',
            '환경 변수 로드 중...'
        );

        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
        const sheetsId = import.meta.env.VITE_GOOGLE_SHEETS_ID;

        if (clientId && apiKey && sheetsId) {
            addTestResult(
                '환경 변수 확인',
                'success',
                '모든 환경 변수가 정상적으로 로드되었습니다.',
                {
                    'Client ID': clientId.substring(0, 20) + '...',
                    'API Key': apiKey.substring(0, 10) + '...',
                    'Sheets ID': sheetsId
                }
            );
            return true;
        } else {
            addTestResult(
                '환경 변수 확인',
                'error',
                '일부 환경 변수가 누락되었습니다.',
                {
                    'Client ID': clientId ? '✓' : '✗',
                    'API Key': apiKey ? '✓' : '✗',
                    'Sheets ID': sheetsId ? '✓' : '✗'
                }
            );
            return false;
        }
    };

    // Test 2: Check authentication
    const testAuthentication = async () => {
        addTestResult(
            '인증 상태 확인',
            'info',
            '인증 상태 확인 중...'
        );

        if (isAuthenticated) {
            addTestResult(
                '인증 상태 확인',
                'success',
                'Google 계정이 연결되어 있습니다.'
            );
            return true;
        } else {
            addTestResult(
                '인증 상태 확인',
                'error',
                'Google 계정이 연결되어 있지 않습니다. 먼저 로그인해주세요.'
            );
            return false;
        }
    };

    // Test 3: Get all sheet names
    const testGetAllSheets = async () => {
        addTestResult(
            '시트 목록 조회',
            'info',
            '스프레드시트의 모든 시트 목록을 가져오는 중...'
        );

        try {
            const sheets = await sheetsService.getAllSheetNames();
            setAllSheets(sheets);
            addTestResult(
                '시트 목록 조회',
                'success',
                `총 ${sheets.length}개의 시트를 찾았습니다.`,
                { sheets }
            );
            return true;
        } catch (err) {
            addTestResult(
                '시트 목록 조회',
                'error',
                `시트 목록 조회 실패: ${err.message}`,
                { error: err.toString() }
            );
            return false;
        }
    };

    // Test 4: Read current sheet data
    const testReadCurrentSheet = async () => {
        addTestResult(
            '현재 시트 데이터 읽기',
            'info',
            `"${currentSheetName}" 시트의 데이터를 읽는 중...`
        );

        try {
            const range = `${currentSheetName}!A:Z`;
            const data = await sheetsService.readSheetData(range);
            setRawData(data);

            addTestResult(
                '현재 시트 데이터 읽기',
                'success',
                `${data.length}개의 행을 읽었습니다.`,
                {
                    '총 행 수': data.length,
                    '첫 3개 행': data.slice(0, 3)
                }
            );
            return true;
        } catch (err) {
            addTestResult(
                '현재 시트 데이터 읽기',
                'error',
                `데이터 읽기 실패: ${err.message}`,
                { error: err.toString() }
            );
            return false;
        }
    };

    // Test 5: Parse student data
    const testParseStudentData = () => {
        addTestResult(
            '학생 데이터 파싱',
            'info',
            '학생 데이터를 파싱하는 중...'
        );

        if (students && students.length > 0) {
            addTestResult(
                '학생 데이터 파싱',
                'success',
                `${students.length}명의 학생 데이터를 파싱했습니다.`,
                {
                    '학생 수': students.length,
                    '첫 번째 학생': students[0],
                    '필드 목록': Object.keys(students[0])
                }
            );
            return true;
        } else {
            addTestResult(
                '학생 데이터 파싱',
                'error',
                '파싱된 학생 데이터가 없습니다.'
            );
            return false;
        }
    };

    // Test 6: Check sheet name format
    const testSheetNameFormat = () => {
        addTestResult(
            '시트 이름 형식 확인',
            'info',
            '현재 시트 이름 형식을 확인하는 중...'
        );

        const expectedPattern = /등록생 목록\(\d{2}년\d{1,2}월\)/;
        if (expectedPattern.test(currentSheetName)) {
            addTestResult(
                '시트 이름 형식 확인',
                'success',
                `시트 이름이 올바른 형식입니다: "${currentSheetName}"`
            );
            return true;
        } else {
            addTestResult(
                '시트 이름 형식 확인',
                'error',
                `시트 이름이 예상 형식과 다릅니다: "${currentSheetName}"\n예상 형식: "등록생 목록(26년1월)"`
            );
            return false;
        }
    };

    // Run all tests
    const runAllTests = async () => {
        setTestRunning(true);
        setTestResults([]);

        addTestResult('테스트 시작', 'info', '모든 테스트를 시작합니다...');

        // Test 1: Environment variables
        const envTest = testEnvironmentVariables();

        if (!envTest) {
            setTestRunning(false);
            return;
        }

        // Test 2: Authentication
        const authTest = await testAuthentication();

        if (!authTest) {
            addTestResult(
                '테스트 중단',
                'error',
                '인증이 필요합니다. Google 계정을 먼저 연결해주세요.'
            );
            setTestRunning(false);
            return;
        }

        // Test 3: Get all sheets
        await testGetAllSheets();

        // Test 4: Sheet name format
        testSheetNameFormat();

        // Test 5: Read current sheet
        await testReadCurrentSheet();

        // Test 6: Parse student data
        testParseStudentData();

        addTestResult(
            '테스트 완료',
            'success',
            '모든 테스트가 완료되었습니다!'
        );

        setTestRunning(false);
    };

    return (
        <div className="google-sheets-test">
            <div className="test-header">
                <h2>🧪 Google Sheets 연동 테스트</h2>
                <p className="test-description">
                    이 페이지에서 Google Sheets API 연동 상태를 확인할 수 있습니다.
                </p>
            </div>

            <div className="test-info-panel">
                <div className="info-item">
                    <span className="info-label">인증 상태:</span>
                    <span className={`info-value ${isAuthenticated ? 'success' : 'error'}`}>
                        {isAuthenticated ? '✓ 연결됨' : '✗ 연결 안됨'}
                    </span>
                </div>
                <div className="info-item">
                    <span className="info-label">현재 시트:</span>
                    <span className="info-value">{currentSheetName || 'N/A'}</span>
                </div>
                <div className="info-item">
                    <span className="info-label">학생 수:</span>
                    <span className="info-value">{students?.length || 0}명</span>
                </div>
                <div className="info-item">
                    <span className="info-label">로딩 상태:</span>
                    <span className="info-value">{loading ? '🔄 로딩 중...' : '✓ 완료'}</span>
                </div>
            </div>

            {error && (
                <div className="test-error-banner">
                    <strong>⚠️ 오류:</strong> {error}
                </div>
            )}

            <div className="test-actions">
                {!isAuthenticated ? (
                    <button onClick={signIn} className="test-button primary">
                        🔗 Google 계정 연결
                    </button>
                ) : (
                    <>
                        <button
                            onClick={runAllTests}
                            disabled={testRunning || loading}
                            className="test-button primary"
                        >
                            {testRunning ? '🔄 테스트 실행 중...' : '▶️ 모든 테스트 실행'}
                        </button>
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="test-button secondary"
                        >
                            🔄 데이터 새로고침
                        </button>
                    </>
                )}
            </div>

            {testResults.length > 0 && (
                <div className="test-results">
                    <h3>테스트 결과</h3>
                    <div className="results-list">
                        {testResults.map((result, index) => (
                            <div key={index} className={`result-item ${result.status}`}>
                                <div className="result-header">
                                    <span className="result-icon">
                                        {result.status === 'success' && '✅'}
                                        {result.status === 'error' && '❌'}
                                        {result.status === 'info' && 'ℹ️'}
                                    </span>
                                    <span className="result-name">{result.name}</span>
                                    <span className="result-time">{result.timestamp}</span>
                                </div>
                                <div className="result-message">{result.message}</div>
                                {result.data && (
                                    <details className="result-data">
                                        <summary>상세 정보 보기</summary>
                                        <pre>{JSON.stringify(result.data, null, 2)}</pre>
                                    </details>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {allSheets.length > 0 && (
                <div className="sheets-list">
                    <h3>📋 사용 가능한 시트 목록</h3>
                    <ul>
                        {allSheets.map((sheet, index) => (
                            <li key={index} className={sheet === currentSheetName ? 'current' : ''}>
                                {sheet}
                                {sheet === currentSheetName && <span className="badge">현재</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {students && students.length > 0 && (
                <div className="students-preview">
                    <h3>👥 학생 데이터 미리보기 (최대 5명)</h3>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>이름</th>
                                    <th>주횟수</th>
                                    <th>요일 및 시간</th>
                                    <th>특이사항</th>
                                    <th>홀딩 사용여부</th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.slice(0, 5).map((student, index) => (
                                    <tr key={index}>
                                        <td>{student['이름']}</td>
                                        <td>{student['주횟수']}</td>
                                        <td>{student['요일 및 시간']}</td>
                                        <td>{student['특이사항']}</td>
                                        <td>{getStudentField(student, '홀딩 사용여부')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {students.length > 5 && (
                        <p className="preview-note">
                            ... 외 {students.length - 5}명 더 있음
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default GoogleSheetsTest;
