import { createContext, useContext, useState, useEffect } from 'react';
import {
    initializeGoogleAPI,
    initializeGIS,
    signInToGoogle,
    signOutFromGoogle,
    isSignedIn,
    getAllStudents,
    getAllStudentsFromAllSheets,
    updateStudentHolding,
    readSheetData,
    getAllSheetNames,
    getCurrentSheetName,
    getStudentByName,
    findStudentAcrossSheets,
    calculateMembershipStats,
    generateAttendanceHistory,
    requestHolding
} from '../services/googleSheetsService';

const GoogleSheetsContext = createContext();

export const useGoogleSheets = () => {
    const context = useContext(GoogleSheetsContext);
    if (!context) {
        throw new Error('useGoogleSheets must be used within GoogleSheetsProvider');
    }
    return context;
};

export const GoogleSheetsProvider = ({ children }) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(true); // 서비스 계정은 항상 인증됨
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [availableSheets, setAvailableSheets] = useState([]);

    // Current selected year and month (defaults to current date)
    const now = new Date();
    const [selectedYear, setSelectedYear] = useState(now.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

    // Initialize (서비스 계정 사용 시 초기화만 필요)
    useEffect(() => {
        const init = async () => {
            try {
                // 서비스 계정 방식에서는 클라이언트 초기화 불필요
                await initializeGoogleAPI();
                await initializeGIS();
                setIsInitialized(true);
                setIsAuthenticated(true);

                console.log('✅ Firebase Functions 연결 준비 완료');

                // 초기 데이터 로드
                await fetchAvailableSheets();
                await fetchStudents();
            } catch (err) {
                console.error('Failed to initialize:', err);
                setError('초기화 실패');
            }
        };

        init();
    }, []);

    // Fetch available sheets from Google Sheets
    const fetchAvailableSheets = async () => {
        try {
            const sheets = await getAllSheetNames();
            setAvailableSheets(sheets);
            console.log('📊 Available sheets in spreadsheet:', sheets);
            console.log('🎯 Looking for sheets matching pattern: 등록생 목록(YY년M월)');
        } catch (err) {
            console.error('Failed to fetch sheet names:', err);
        }
    };

    // Fetch students from all Google Sheets
    const fetchStudents = async () => {
        setLoading(true);
        setError(null);
        try {
            console.log('🔍 Fetching students from all available sheets...');

            const data = await getAllStudentsFromAllSheets();
            setStudents(data);
            console.log(`✅ Fetched ${data.length} students from all sheets`);
        } catch (err) {
            console.error('❌ Failed to fetch students:', err);
            console.error('Error details:', {
                message: err.message,
                result: err.result,
                status: err.status
            });
            setError('학생 데이터 불러오기 실패');
        } finally {
            setLoading(false);
        }
    };

    // Sign in (서비스 계정에서는 불필요하지만 호환성을 위해 유지)
    const signIn = async () => {
        console.log('서비스 계정 사용 - 로그인 불필요');
        setIsAuthenticated(true);
        await fetchAvailableSheets();
        await fetchStudents();
    };

    // Sign out (서비스 계정에서는 불필요하지만 호환성을 위해 유지)
    const signOut = () => {
        console.log('서비스 계정 사용 - 로그아웃 불필요');
        // 실제로는 로그아웃하지 않음
    };

    // Update student holding status
    const updateHolding = async (rowIndex, holdingStatus, holdingStartDate, holdingEndDate) => {
        setLoading(true);
        setError(null);
        try {
            await updateStudentHolding(rowIndex, holdingStatus, holdingStartDate, holdingEndDate, selectedYear, selectedMonth);
            await fetchStudents(); // Refresh data
        } catch (err) {
            console.error('Failed to update holding:', err);
            setError('홀딩 정보 업데이트 실패');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Update student information
    const updateStudent = async (rowIndex, studentData) => {
        setLoading(true);
        setError(null);
        try {
            const { updateStudentData } = await import('../services/googleSheetsService');
            await updateStudentData(rowIndex, studentData, selectedYear, selectedMonth);
            await fetchStudents(); // Refresh data
        } catch (err) {
            console.error('Failed to update student:', err);
            setError('수강생 정보 업데이트 실패');
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Change selected month
    const changeMonth = async (year, month) => {
        setSelectedYear(year);
        setSelectedMonth(month);
        setLoading(true);
        setError(null);
        try {
            const data = await getAllStudents(year, month);
            setStudents(data);
            console.log(`Switched to ${year}년 ${month}월:`, data);
        } catch (err) {
            console.error('Failed to fetch students for selected month:', err);
            setError(`학생 데이터 불러오기 실패 (${year}년 ${month}월)`);
        } finally {
            setLoading(false);
        }
    };

    // Refresh data from Google Sheets
    const refresh = async () => {
        await fetchStudents();
    };

    const value = {
        isInitialized,
        isAuthenticated,
        students,
        loading,
        error,
        availableSheets,
        selectedYear,
        selectedMonth,
        signIn,
        signOut,
        updateHolding,
        updateStudent,
        refresh,
        fetchStudents,
        changeMonth,

        currentSheetName: getCurrentSheetName(new Date(selectedYear, selectedMonth - 1)),
        isConnected: isAuthenticated,
        getStudentByName: async (name) => {
            const student = await getStudentByName(name, selectedYear, selectedMonth);
            return student;
        },
        findStudentAcrossSheets: async (name) => {
            return await findStudentAcrossSheets(name);
        },
        calculateMembershipStats,
        generateAttendanceHistory,
        requestHolding: async (studentName, holdingStartDate, holdingEndDate) => {
            return await requestHolding(studentName, holdingStartDate, holdingEndDate, selectedYear, selectedMonth);
        }
    };

    return (
        <GoogleSheetsContext.Provider value={value}>
            {children}
        </GoogleSheetsContext.Provider>
    );
};
