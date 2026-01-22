import { useState } from 'react';
import './MonthSelector.css';

const MonthSelector = ({ selectedYear, selectedMonth, onMonthChange, availableSheets }) => {
    const [isOpen, setIsOpen] = useState(false);

    // 현재 날짜 기준으로 ±3개월 범위 생성
    const generateMonthOptions = () => {
        const options = [];
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        // 6개월 전부터 3개월 후까지
        for (let i = -6; i <= 3; i++) {
            const date = new Date(currentYear, currentMonth - 1 + i, 1);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const yearShort = year.toString().slice(-2);
            const sheetName = `등록생 목록(${yearShort}년${month}월)`;

            // 해당 시트가 존재하는지 확인
            const exists = availableSheets.includes(sheetName);

            options.push({
                year,
                month,
                label: `${year}년 ${month}월`,
                sheetName,
                exists,
                isCurrent: year === currentYear && month === currentMonth
            });
        }

        return options;
    };

    const monthOptions = generateMonthOptions();

    const handleSelect = (option) => {
        onMonthChange(option.year, option.month);
        setIsOpen(false);
    };

    const selectedOption = monthOptions.find(
        opt => opt.year === selectedYear && opt.month === selectedMonth
    );

    return (
        <div className="month-selector">
            <button
                className="month-selector-button"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="selected-month">
                    📅 {selectedOption?.label || `${selectedYear}년 ${selectedMonth}월`}
                </span>
                <svg
                    className={`dropdown-arrow ${isOpen ? 'open' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div className="month-dropdown-overlay" onClick={() => setIsOpen(false)} />
                    <div className="month-dropdown">
                        {monthOptions.map((option, index) => (
                            <button
                                key={index}
                                className={`month-option ${option.year === selectedYear && option.month === selectedMonth ? 'selected' : ''} ${option.isCurrent ? 'current' : ''} ${!option.exists ? 'not-exist' : ''}`}
                                onClick={() => handleSelect(option)}
                                disabled={!option.exists}
                            >
                                <span className="month-label">{option.label}</span>
                                {option.isCurrent && <span className="current-badge">현재</span>}
                                {!option.exists && <span className="not-exist-badge">시트 없음</span>}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default MonthSelector;
