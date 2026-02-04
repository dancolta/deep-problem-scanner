import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScan } from '../context/ScanContext';
import type { ScanResult } from '../../shared/types';
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
    resetScan,
  } = useScan();
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest result
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [progress.results.length]);

  const remaining = progress.total - progress.completed - progress.failed;
  const pct = progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0;

  // Use final elapsed time when complete, otherwise use live timer
  const displayTime = isComplete && finalElapsedTime !== null ? finalElapsedTime : elapsedTime;
  const minutes = String(Math.floor(displayTime / 60)).padStart(2, '0');
  const seconds = String(displayTime % 60).padStart(2, '0');

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
        <h2>{isComplete ? 'Scan Complete' : isScanning ? 'Scanning...' : 'Scan Complete'}</h2>
        <div className="progress-bar-container">
          <div
            className={`progress-bar-fill${isComplete ? ' complete' : ''}`}
            style={{ width: `${pct}%` }}
          />
          <div className="progress-bar-label">
            {progress.completed + progress.failed} / {progress.total} ({pct}%)
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

      {/* Completion Summary */}
      {isComplete && completionSummary && (
        <div className="completion-summary">
          <h3>Scan Summary</h3>
          <div className="summary-stats">
            <div className="summary-stat success">
              <span className="summary-value">{completionSummary.successCount}</span>
              <span className="summary-label">Successful</span>
            </div>
            <div className="summary-stat failed">
              <span className="summary-value">{completionSummary.failedCount}</span>
              <span className="summary-label">Failed</span>
            </div>
            <div className="summary-stat skipped">
              <span className="summary-value">{completionSummary.skippedCount}</span>
              <span className="summary-label">Skipped</span>
            </div>
            <div className="summary-stat total">
              <span className="summary-value">{completionSummary.totalProcessed}</span>
              <span className="summary-label">Total</span>
            </div>
          </div>
          <div className="summary-time">
            Completed in {Math.floor(completionSummary.totalElapsedMs / 1000)}s
          </div>
        </div>
      )}

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
          <>
            <button className="btn-drafts" onClick={() => navigate('/drafts')}>
              View Drafts
            </button>
            {isComplete && (
              <button className="btn-new-scan" onClick={() => { resetScan(); navigate('/upload'); }}>
                New Scan
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
