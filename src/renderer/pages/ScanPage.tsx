import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScan } from '../context/ScanContext';
import type { ScanResult } from '../../shared/types';
import EmptyState from '../components/EmptyState';
import './ScanPage.css';

export default function ScanPage() {
  const navigate = useNavigate();
  const {
    progress,
    isScanning,
    elapsedTime,
    isComplete,
    finalElapsedTime,
    completionSummary,
    currentPhase,
    phaseDescription,
    cancelScan,
  } = useScan();
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest result
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [progress.results.length]);

  const remaining = progress.total - progress.completed - progress.failed;
  const pct = isComplete ? 100 : (progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0);
  const displayCount = isComplete ? progress.total : progress.completed + progress.failed;

  // Use final elapsed time when complete, otherwise use live timer
  const displayTime = isComplete && finalElapsedTime !== null ? finalElapsedTime : elapsedTime;
  const minutes = String(Math.floor(displayTime / 60)).padStart(2, '0');
  const seconds = String(displayTime % 60).padStart(2, '0');

  // Nothing has been started yet
  if (!isScanning && progress.total === 0) {
    return (
      <div className="scan-page">
        <div className="scan-header">
          <h2>Scan</h2>
          <p className="page-subtitle">Monitor the scanning progress of your leads.</p>
        </div>
        <EmptyState
          icon="🔍"
          heading="Ready to scan"
          description="Import leads from Google Sheets on the Upload page to start scanning websites and generating personalized outreach emails."
          actionLabel="Go to Upload"
          onAction={() => navigate('/upload')}
          tip="Tip: Make sure your Google Sheet has the required columns: company_name, website_url, contact_name, and contact_email."
        />
      </div>
    );
  }

  return (
    <div className="scan-page">
      {/* Progress Header */}
      <div className="scan-header">
        <h2>{isComplete ? 'Scan Complete' : isScanning ? 'Scanning...' : 'Scan Complete'}</h2>
        <div className="progress-bar-container">
          <div
            className={`progress-bar-fill${isComplete ? ' complete' : ''}`}
            style={{ width: `${pct}%` }}
          />
          <div className="progress-bar-label">
            {displayCount} / {progress.total} ({pct}%)
          </div>
        </div>

        {/* Phase indicator */}
        {isScanning && currentPhase && phaseDescription && (
          <div className="phase-indicator">
            <span className="phase-label">{currentPhase.replace(/_/g, ' ')}</span>
            <span className="phase-description">{phaseDescription}</span>
          </div>
        )}

        {isScanning && progress.currentUrl && !currentPhase && (
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

      {/* Completion Time */}
      {isComplete && completionSummary && (
        <div className="completion-time">
          Completed in {Math.floor(completionSummary.totalElapsedMs / 1000)}s
        </div>
      )}

      {/* Live Results Feed */}
      <div className="results-feed" ref={feedRef}>
        {progress.results.length === 0 && !isComplete ? (
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
          <button className="btn-destructive" onClick={cancelScan}>
            Stop Scan
          </button>
        ) : (
          <button className="btn-primary" onClick={() => navigate('/drafts')}>
            View Drafts
          </button>
        )}
      </div>
    </div>
  );
}
