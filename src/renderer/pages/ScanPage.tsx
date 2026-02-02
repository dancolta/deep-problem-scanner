import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ScanProgress, ScanResult } from '../../shared/types';
import './ScanPage.css';

export default function ScanPage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ScanProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    currentUrl: '',
    results: [],
  });
  const [isScanning, setIsScanning] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef(Date.now());

  // Elapsed time counter
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isScanning]);

  // IPC listeners
  const handleProgress = useCallback((_event: unknown, data: unknown) => {
    const p = data as ScanProgress;
    setProgress(p);
  }, []);

  const handleComplete = useCallback((_event: unknown, _data: unknown) => {
    setIsScanning(false);
  }, []);

  useEffect(() => {
    const unsubProgress = window.electronAPI.on(IPC_CHANNELS.SCAN_PROGRESS, handleProgress);
    const unsubComplete = window.electronAPI.on(IPC_CHANNELS.SCAN_COMPLETE, handleComplete);
    return () => {
      unsubProgress();
      unsubComplete();
    };
  }, [handleProgress, handleComplete]);

  // Auto-scroll to latest result
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [progress.results.length]);

  const handleCancel = async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.SCAN_CANCEL);
    setIsScanning(false);
  };

  const remaining = progress.total - progress.completed - progress.failed;
  const pct = progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0;
  const minutes = String(Math.floor(elapsedTime / 60)).padStart(2, '0');
  const seconds = String(elapsedTime % 60).padStart(2, '0');

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
          <button className="btn-cancel" onClick={handleCancel}>
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
