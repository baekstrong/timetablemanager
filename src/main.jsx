import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN || 'https://375bce57e593bf9c92392de6903fcc64@o4511409251811328.ingest.us.sentry.io/4511409283596288'

if (sentryDsn && import.meta.env.PROD) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    // 인앱 브라우저(WKWebView)가 주입한 스크립트 에러 — 우리 코드 아님
    ignoreErrors: [/window\.webkit\.messageHandlers/],
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
