import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import StudentClassMockup from './StudentClassMockup';

if (import.meta.env.DEV) {
    createRoot(document.getElementById('root')).render(
        <StrictMode><StudentClassMockup /></StrictMode>,
    );
}
