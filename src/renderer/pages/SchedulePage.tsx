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

// Generate time options at 15-minute intervals
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const totalMinutes = i * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return {
    value: totalMinutes, // Store as minutes from midnight
    label: `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`,
  };
});

/**
 * Validates that a schedule row has the required data for email sending.
 * A valid schedule row must have:
 * - company_name: identifies the target company
 * - contact_email: required recipient address
 * - email_subject OR email_body: must have draft content to send
 */
function isValidScheduleRow(row: SheetRow): boolean {
  const hasCompanyName = Boolean(row.company_name?.trim());
  const hasContactEmail = Boolean(row.contact_email?.trim());
  const hasEmailContent = Boolean(row.email_subject?.trim() || row.email_body?.trim());
  return hasCompanyName && hasContactEmail && hasEmailContent;
}

/**
 * Format a date/time string for display in a specific timezone.
 * Returns formatted string like "Feb 15, 2:00 PM" with timezone abbreviation.
 */
function formatTimeInTimezone(dateStr: string | undefined, tz: string): string {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const formatted = date.toLocaleString('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return formatted;
  } catch {
    return dateStr;
  }
}

/**
 * Get short timezone abbreviation (e.g., EST, PST, UTC)
 */
function getTimezoneAbbr(tz: string): string {
  try {
    const date = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || tz.split('/').pop()?.replace(/_/g, ' ') || tz;
  } catch {
    return tz.split('/').pop()?.replace(/_/g, ' ') || tz;
  }
}

export default function SchedulePage() {
  const [emails, setEmails] = useState<SheetRow[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerState>('idle');
  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Schedule config
  const todayStr = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(todayStr);
  const [startTime, setStartTime] = useState(9 * 60);  // 9:00 AM in minutes
  const [endTime, setEndTime] = useState(17 * 60);     // 5:00 PM in minutes
  const [minInterval, setMinInterval] = useState(10);
  const [maxInterval, setMaxInterval] = useState(20);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [configError, setConfigError] = useState<string | null>(null);

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

  const loadFromSheet = useCallback(async () => {
    try {
      const settingsResp = await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_GET) as any;
      const s: AppSettings | undefined = settingsResp?.settings ?? settingsResp;
      if (s?.googleSheetUrl) {
        setSettings(s);
        // Load time settings - convert from hours to minutes if needed for backward compatibility
        if ((s as any).scheduleStartTime !== undefined) {
          setStartTime((s as any).scheduleStartTime);
        } else if (s.scheduleStartHour !== undefined) {
          setStartTime(s.scheduleStartHour * 60);
        }
        if ((s as any).scheduleEndTime !== undefined) {
          setEndTime((s as any).scheduleEndTime);
        } else if (s.scheduleEndHour !== undefined) {
          setEndTime(s.scheduleEndHour * 60);
        }
        if ((s as any).minIntervalMinutes !== undefined) setMinInterval((s as any).minIntervalMinutes);
        if ((s as any).maxIntervalMinutes !== undefined) setMaxInterval((s as any).maxIntervalMinutes);
        if (s.timezone) setTimezone(s.timezone);
        if ((s as any).scheduleStartDate) setStartDate((s as any).scheduleStartDate);
        const match = s.googleSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        const spreadsheetId = match ? match[1] : s.googleSheetUrl;
        const sheetsResp = await window.electronAPI.invoke(IPC_CHANNELS.SHEETS_READ, spreadsheetId) as any;
        if (sheetsResp?.success && sheetsResp.rows) {
          // Filter to only include valid rows with actual email data
          const validRows = (sheetsResp.rows as SheetRow[]).filter(isValidScheduleRow);
          setEmails(validRows);
        }
      }
    } catch {
      // Handled by error state already
    }
    try {
      const statusResp = await window.electronAPI.invoke(IPC_CHANNELS.SCHEDULER_STATUS) as any;
      if (statusResp?.success && statusResp.status) {
        const s = statusResp.status;
        setSchedulerStatus(s.running ? 'running' : s.stopped ? 'stopped' : 'idle');
      }
    } catch {
      // Ignore
    }
  }, []);

  const loadData = loadFromSheet;

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for scheduler progress events
  useEffect(() => {
    const unsub = window.electronAPI.on(IPC_CHANNELS.SCHEDULER_PROGRESS, (...args: unknown[]) => {
      const data = args[0] as any;
      if (data.detail) {
        addLogEntry(data.detail);
      }
      if (data.type === 'started') {
        setSchedulerStatus('running');
      } else if (data.type === 'stopped') {
        setSchedulerStatus('stopped');
      }
    });
    return unsub;
  }, [addLogEntry]);

  // Auto-scroll activity log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog]);

  const saveScheduleConfig = async () => {
    try {
      const settingsResp = await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_GET) as any;
      const current = settingsResp?.settings ?? settingsResp ?? {};
      const updated = {
        ...current,
        scheduleStartDate: startDate,
        scheduleStartTime: startTime,
        scheduleEndTime: endTime,
        minIntervalMinutes: minInterval,
        maxIntervalMinutes: maxInterval,
        timezone,
      };
      await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_SET, updated);
    } catch {
      // Best-effort save
    }
  };

  const handleStart = async () => {
    // Validate start date+time is not in the past for the target timezone
    const targetNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
    const startHour = Math.floor(startTime / 60);
    const startMinute = startTime % 60;
    const selectedStartStr = `${startDate}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`;
    const selectedStart = new Date(selectedStartStr);
    if (selectedStart < targetNow) {
      const tzLabel = timezone.replace(/_/g, ' ');
      setConfigError(`Start time cannot be in the past for the selected timezone (${tzLabel}).`);
      return;
    }
    if (endTime <= startTime) {
      setConfigError('End time must be after start time.');
      return;
    }
    if (minInterval > maxInterval) {
      setConfigError('Minimum interval cannot be greater than maximum interval.');
      return;
    }
    setConfigError(null);
    await saveScheduleConfig();
    await window.electronAPI.invoke(IPC_CHANNELS.SCHEDULER_START, {
      scheduleStartDate: startDate,
      scheduleStartTime: startTime,
      scheduleEndTime: endTime,
      minIntervalMinutes: minInterval,
      maxIntervalMinutes: maxInterval,
    });
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

      {/* Schedule Configuration */}
      <div className="schedule-config">
        <h3>Send Configuration</h3>
        {configError && <div className="config-error">{configError}</div>}
        <div className="config-grid">
          <div className="config-field">
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              min={todayStr}
              onChange={e => { setStartDate(e.target.value); setConfigError(null); }}
              disabled={schedulerStatus === 'running'}
            />
          </div>
          <div className="config-field">
            <label>Send Window Start</label>
            <select
              value={startTime}
              onChange={e => setStartTime(Number(e.target.value))}
              disabled={schedulerStatus === 'running'}
            >
              {TIME_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="config-field">
            <label>Send Window End</label>
            <select
              value={endTime}
              onChange={e => setEndTime(Number(e.target.value))}
              disabled={schedulerStatus === 'running'}
            >
              {TIME_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="config-field config-field--interval-range">
            <label>Send Interval Range (minutes)</label>
            <div className="interval-range-inputs">
              <div className="interval-input-group">
                <span className="interval-label">Min</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={minInterval}
                  onChange={e => setMinInterval(Math.max(1, Math.min(120, Number(e.target.value))))}
                  disabled={schedulerStatus === 'running'}
                />
              </div>
              <div className="interval-input-group">
                <span className="interval-label">Max</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={maxInterval}
                  onChange={e => setMaxInterval(Math.max(1, Math.min(120, Number(e.target.value))))}
                  disabled={schedulerStatus === 'running'}
                />
              </div>
            </div>
          </div>
          <div className="config-field">
            <label>Lead's Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              disabled={schedulerStatus === 'running'}
            >
              {[
                'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                'America/Anchorage', 'Pacific/Honolulu', 'America/Phoenix',
                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Bucharest',
                'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
                'Australia/Sydney', 'Pacific/Auckland', 'UTC',
              ].map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

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

        <span className="send-interval">
          Interval: {minInterval}-{maxInterval} min
        </span>

        <button
          className="btn btn-refresh"
          onClick={async () => {
            setSyncing(true);
            setSyncMessage(null);
            try {
              await loadFromSheet();
              // After loadFromSheet completes, emails state will have the filtered rows
              // We can't access the count directly, so show a generic message
              setSyncMessage('Synced with sheet successfully.');
              setTimeout(() => setSyncMessage(null), 3000);
            } finally {
              setSyncing(false);
            }
          }}
          disabled={sheetLoading || syncing}
        >
          {syncing || sheetLoading ? 'Syncing...' : 'Sync with Sheet'}
        </button>
      </div>

      {syncMessage && (
        <div className="sync-message success">{syncMessage}</div>
      )}

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
                  <td className="dual-timezone-cell">
                    {row.scheduled_time ? (
                      <>
                        <div className="tz-row tz-row--local">
                          <span className="tz-label">Your Time:</span>
                          <span className="tz-value">{formatTimeInTimezone(row.scheduled_time, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
                        </div>
                        <div className="tz-row tz-row--lead">
                          <span className="tz-label">Lead Time:</span>
                          <span className="tz-value">{formatTimeInTimezone(row.scheduled_time, timezone)} {getTimezoneAbbr(timezone)}</span>
                        </div>
                      </>
                    ) : '-'}
                  </td>
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
