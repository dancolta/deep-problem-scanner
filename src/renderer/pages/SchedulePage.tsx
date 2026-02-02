import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useIpcInvoke } from '../hooks/useIpc';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { SheetRow, AppSettings } from '../../shared/types';
import './SchedulePage.css';

interface LogEntry {
  time: string;
  message: string;
}

type SchedulerState = 'idle' | 'running' | 'stopped';

export default function SchedulePage() {
  const [emails, setEmails] = useState<SheetRow[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerState>('idle');
  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  const { invoke: getSettings, error: settingsError } = useIpcInvoke<AppSettings>(IPC_CHANNELS.SETTINGS_GET);
  const { invoke: readSheet, loading: sheetLoading, error: sheetError } = useIpcInvoke<SheetRow[]>(IPC_CHANNELS.SHEETS_READ);
  const { invoke: startScheduler, loading: startLoading } = useIpcInvoke(IPC_CHANNELS.SCHEDULER_START);
  const { invoke: stopScheduler, loading: stopLoading } = useIpcInvoke(IPC_CHANNELS.SCHEDULER_STOP);
  const { invoke: getStatus } = useIpcInvoke<{ status: SchedulerState }>(IPC_CHANNELS.SCHEDULER_STATUS);

  const addLogEntry = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString();
    setActivityLog(prev => {
      const next = [...prev, { time, message }];
      return next.length > 50 ? next.slice(-50) : next;
    });
  }, []);

  const loadData = useCallback(async () => {
    const s = await getSettings();
    if (s) {
      setSettings(s);
      const rows = await readSheet(s.googleSheetUrl);
      if (rows) setEmails(rows);
    }
    const statusResult = await getStatus();
    if (statusResult) setSchedulerStatus(statusResult.status);
  }, [getSettings, readSheet, getStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for scheduler progress events
  useEffect(() => {
    const unsub = window.electronAPI.on(IPC_CHANNELS.SCHEDULER_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as { message?: string; status?: SchedulerState; emails?: SheetRow[] };
      if (data.message) {
        addLogEntry(data.message);
      }
      if (data.status) {
        setSchedulerStatus(data.status);
      }
      if (data.emails) {
        setEmails(data.emails);
      }
    });
    return unsub;
  }, [addLogEntry]);

  // Auto-scroll activity log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog]);

  const handleStart = async () => {
    await startScheduler();
    setSchedulerStatus('running');
    addLogEntry('Scheduler started');
  };

  const handleStop = async () => {
    await stopScheduler();
    setSchedulerStatus('stopped');
    addLogEntry('Scheduler stopped');
  };

  // Compute stats
  const totalCount = emails.length;
  const sentCount = emails.filter(e => e.email_status === 'sent').length;
  const pendingCount = emails.filter(e => e.email_status === 'draft' || e.email_status === 'scheduled').length;
  const failedCount = emails.filter(e => e.email_status === 'failed').length;

  const displayError = settingsError || sheetError;

  return (
    <div className="schedule-page">
      <h2>Schedule Management</h2>
      <p className="page-subtitle">Monitor and control automated email delivery.</p>

      {displayError && <div className="error-banner">{displayError}</div>}

      {/* Controls */}
      <div className="schedule-controls">
        <button
          className="btn btn-start"
          onClick={handleStart}
          disabled={schedulerStatus === 'running' || startLoading}
        >
          {startLoading ? 'Starting...' : 'Start Sending'}
        </button>
        <button
          className="btn btn-stop"
          onClick={handleStop}
          disabled={schedulerStatus !== 'running' || stopLoading}
        >
          {stopLoading ? 'Stopping...' : 'Stop Sending'}
        </button>

        <div className="status-indicator">
          <span className={`status-dot ${schedulerStatus}`} />
          <span>{schedulerStatus.charAt(0).toUpperCase() + schedulerStatus.slice(1)}</span>
        </div>

        {settings && (
          <span className="send-interval">
            Interval: {settings.sendIntervalMinutes} min
          </span>
        )}

        <button className="btn btn-refresh" onClick={loadData} disabled={sheetLoading}>
          {sheetLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="schedule-stats">
        <div className="stat-card total">
          <div className="stat-value">{totalCount}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card sent">
          <div className="stat-value">{sentCount}</div>
          <div className="stat-label">Sent</div>
        </div>
        <div className="stat-card pending">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-card failed">
          <div className="stat-value">{failedCount}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      {/* Email Queue Table */}
      <div className="queue-table-wrapper">
        <h3>Email Queue</h3>
        {emails.length === 0 ? (
          <div className="empty-state">No emails loaded. Check settings and refresh.</div>
        ) : (
          <table className="queue-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((row, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{row.company_name}</td>
                  <td>{row.contact_name}</td>
                  <td>{row.contact_email}</td>
                  <td>{row.email_subject}</td>
                  <td>
                    <span className={`email-badge ${row.email_status}`}>
                      {row.email_status}
                    </span>
                  </td>
                  <td>{row.scheduled_time || '-'}</td>
                  <td>{row.sent_time || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Activity Log */}
      <div className="activity-log">
        <h3>Activity Log</h3>
        <div className="activity-log-entries">
          {activityLog.length === 0 && (
            <div className="empty-state">No activity yet.</div>
          )}
          {activityLog.map((entry, i) => (
            <div className="log-entry" key={i}>
              <span className="log-time">[{entry.time}]</span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
