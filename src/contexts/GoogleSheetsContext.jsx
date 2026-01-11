import { createContext, useContext, useState, useEffect } from 'react';
import {
    initializeGoogleAPI,
    initializeGIS,
    signInToGoogle,
    signOutFromGoogle,
    isSignedIn,
    getAllStudents,
    updateStudentHolding,
    readSheetData,
    getAllSheetNames,
    getCurrentSheetName
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
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [availableSheets, setAvailableSheets] = useState([]);

    // Current selected year and month (defaults to current date)
    const now = new Date();
    const [selectedYear, setSelectedYear] = useState(now.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

    // Initialize Google APIs
    useEffect(() => {
        const init = async () => {
            try {
                await initializeGoogleAPI();
                await initializeGIS();
                setIsInitialized(true);

                // Check if already signed in
                if (isSignedIn()) {
                    setIsAuthenticated(true);
                    await fetchAvailableSheets();
                    await fetchStudents();
                }
            } catch (err) {
                console.error('Failed to initialize Google APIs:', err);
                setError('Google API 초기화 실패');
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

    // Fetch students from Google Sheets
    const fetchStudents = async () => {
        setLoading(true);
        setError(null);
        try {
            console.log(`🔍 Attempting to fetch students for ${selectedYear}년 ${selectedMonth}월`);
            console.log(`📋 Expected sheet name: 등록생 목록(${selectedYear.toString().slice(-2)}년${selectedMonth}월)`);

            const data = await getAllStudents(selectedYear, selectedMonth);
            setStudents(data);
            console.log(`✅ Fetched students for ${selectedYear}년 ${selectedMonth}월:`, data);
        } catch (err) {
            console.error('❌ Failed to fetch students:', err);
            console.error('Error details:', {
                message: err.message,
                result: err.result,
                status: err.status
            });
            setError(`학생 데이터 불러오기 실패 (${selectedYear}년 ${selectedMonth}월)`);
        } finally {
            setLoading(false);
        }
    };

    // Sign in to Google
    const signIn = async () => {
        try {
            await signInToGoogle();
            setIsAuthenticated(true);
            await fetchAvailableSheets();
            await fetchStudents();
        } catch (err) {
            console.error('Sign in failed:', err);
            setError('Google 로그인 실패');
            throw err;
        }
    };

    // Sign out from Google
    const signOut = () => {
        signOutFromGoogle();
        setIsAuthenticated(false);
        setStudents([]);
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
        if (isAuthenticated) {
            await fetchStudents();
        }
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
        isConnected: isAuthenticated
    };

    return (
        <GoogleSheetsContext.Provider value={value}>
            {children}
        </GoogleSheetsContext.Provider>
    );
};
