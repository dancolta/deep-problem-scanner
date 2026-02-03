import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScan } from '../context/ScanContext';
import type { ScanResult } from '../../shared/types';
import './ScanPage.css';

export default function ScanPage() {
  const navigate = useNavigate();
  const { progress, isScanning, elapsedTime, cancelScan } = useScan();
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest result
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [progress.results.length]);

  const remaining = progress.total - progress.completed - progress.failed;
  const pct = progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0;
  const minutes = String(Math.floor(elapsedTime / 60)).padStart(2, '0');
  const seconds = String(elapsedTime % 60).padStart(2, '0');

  // Nothing has been started yet
  if (!isScanning && progress.total === 0) {
    return (
      <div className="scan-page">
        <div className="scan-header">
          <h2>No Scan Running</h2>
          <p style={{ color: '#888', marginTop: '1rem' }}>
            Upload a CSV and start a scan from the Upload page.
          </p>
          <div className="control-bar">
            <button className="btn-drafts" onClick={() => navigate('/upload')}>
              Go to Upload
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-page">
      {/* Progress Header */}
      <div className="scan-header">
        <h2>{isScanning ? 'Scanning...' : 'Scan Complete'}</h2>
        <div className="progress-bar-container">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          <div className="progress-bar-label">
            {progress.completed + progress.failed} / {progress.total} ({pct}%)
          </div>
        </div>
        {isScanning && progress.currentUrl && (
          <div className="current-url">
            Scanning: <span>{progress.currentUrl}</span>
          </div>
        )}
        <div className="stats-row">
          <div className="stat-item stat-completed">
            <strong>{progress.completed}</strong> Completed
          </div>
          <div className="stat-item stat-failed">
            <strong>{progress.failed}</strong> Failed
          </div>
          <div className="stat-item stat-remaining">
            <strong>{remaining}</strong> Remaining
          </div>
          <div className="stat-item stat-elapsed">
            <strong>{minutes}:{seconds}</strong> Elapsed
          </div>
        </div>
      </div>

      {/* Live Results Feed */}
      <div className="results-feed" ref={feedRef}>
        {progress.results.length === 0 ? (
          <div className="empty-feed">Waiting for results...</div>
        ) : (
          progress.results.map((result: ScanResult, i: number) => (
            <div key={`${result.url}-${i}`} className={`result-card status-${result.status}`}>
              <span className="result-url">{result.url}</span>
              <div className="diagnostics-badges">
                {result.diagnostics.slice(0, 5).map((d, j) => (
                  <span key={j} className={`diag-badge ${d.status}`} title={`${d.name}: ${d.status}`} />
                ))}
              </div>
              <span className={`status-badge ${result.status}`}>{result.status}</span>
            </div>
          ))
        )}
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        {isScanning ? (
          <button className="btn-cancel" onClick={cancelScan}>
            Cancel Scan
          </button>
        ) : (
          <button className="btn-drafts" onClick={() => navigate('/drafts')}>
            View Drafts
          </button>
        )}
      </div>
    </div>
  );
}
