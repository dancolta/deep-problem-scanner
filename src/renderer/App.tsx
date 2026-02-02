import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import SetupPage from './pages/SetupPage';
import UploadPage from './pages/UploadPage';
import ScanPage from './pages/ScanPage';
import DraftsPage from './pages/DraftsPage';
import SchedulePage from './pages/SchedulePage';

const NAV_ITEMS = [
  { path: '/setup', label: 'Setup', icon: '\u2699\uFE0F' },
  { path: '/upload', label: 'Upload', icon: '\uD83D\uDCC1' },
  { path: '/scan', label: 'Scan', icon: '\uD83D\uDD0D' },
  { path: '/drafts', label: 'Drafts', icon: '\u2709\uFE0F' },
  { path: '/schedule', label: 'Schedule', icon: '\uD83D\uDCC5' },
];

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>Deep Problem Scanner</h1>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'nav-link--active' : ''}`
                }
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="content">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/drafts" element={<DraftsPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
