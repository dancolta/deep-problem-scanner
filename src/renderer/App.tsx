import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScanProvider } from './context/ScanContext';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import SetupPage from './pages/SetupPage';
import UploadPage from './pages/UploadPage';
import ScanPage from './pages/ScanPage';
import DraftsPage from './pages/DraftsPage';
import SchedulePage from './pages/SchedulePage';
import './App.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  showCompletedDot?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/setup', label: 'Setup', icon: '\u2699\uFE0F' },
  { path: '/upload', label: 'Upload', icon: '\uD83D\uDCC1' },
  { path: '/scan', label: 'Scan', icon: '\uD83D\uDD0D' },
  { path: '/drafts', label: 'Drafts', icon: '\u2709\uFE0F' },
  { path: '/schedule', label: 'Schedule', icon: '\uD83D\uDCC5' },
];

export default function App() {
  const [setupComplete, setSetupComplete] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [scheduleCount, setScheduleCount] = useState(0);

  // Check setup completion status periodically
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const result = await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_GET) as any;
        const settings = result?.settings || result;
        if (settings) {
          // Check if all required settings are configured
          const hasAuth = await window.electronAPI.invoke(IPC_CHANNELS.GOOGLE_AUTH_STATUS) as any;
          const isConnected = hasAuth?.success && hasAuth?.status === 'authenticated';
          const hasGemini = Boolean(settings.geminiApiKey);
          const hasSheet = Boolean(settings.googleSheetUrl);
          setSetupComplete(isConnected && hasGemini && hasSheet);
        }
      } catch {
        // Ignore errors, assume not complete
      }
    };

    checkSetup();
    const interval = setInterval(checkSetup, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch draft and schedule counts periodically
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const settingsResp = await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_GET) as any;
        const settings = settingsResp?.settings || settingsResp;
        if (settings?.googleSheetUrl) {
          const match = settings.googleSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
          const spreadsheetId = match ? match[1] : settings.googleSheetUrl;
          const sheetsResp = await window.electronAPI.invoke(IPC_CHANNELS.SHEETS_READ, spreadsheetId) as any;
          if (sheetsResp?.success && sheetsResp.rows) {
            const rows = sheetsResp.rows as any[];
            const drafts = rows.filter(r =>
              r.company_name?.trim() &&
              (r.contact_email?.trim() || r.scan_source === 'manual') &&
              (r.email_subject?.trim() || r.email_body?.trim()) &&
              r.email_status === 'draft'
            );
            const scheduled = rows.filter(r =>
              r.company_name?.trim() &&
              r.contact_email?.trim() &&
              (r.email_subject?.trim() || r.email_body?.trim()) &&
              (r.email_status === 'scheduled' || r.email_status === 'draft')
            );
            setDraftCount(drafts.length);
            setScheduleCount(scheduled.length);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const getBadgeCount = (path: string): number | null => {
    if (path === '/drafts' && draftCount > 0) return draftCount;
    if (path === '/schedule' && scheduleCount > 0) return scheduleCount;
    return null;
  };

  const showCompletedDot = (path: string): boolean => {
    if (path === '/setup' && setupComplete) return true;
    return false;
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>Deep Problem Scanner</h1>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => {
            const badgeCount = getBadgeCount(item.path);
            const hasDot = showCompletedDot(item.path);
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'nav-link--active' : ''}`
                  }
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {badgeCount !== null && (
                    <span className="nav-badge">{badgeCount}</span>
                  )}
                  {hasDot && <span className="nav-completed-dot" />}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="content">
        <ErrorBoundary>
        <ScanProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
        </Routes>
        </ScanProvider>
        </ErrorBoundary>
      </main>
    </div>
  );
}
