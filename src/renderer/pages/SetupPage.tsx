import React, { useState, useEffect } from 'react';
import { useIpcInvoke } from '../hooks/useIpc';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppSettings } from '../../shared/types';
import './SetupPage.css';

export default function SetupPage() {
  // Auth state
  const [authStatus, setAuthStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [authError, setAuthError] = useState<string | null>(null);

  // Settings state
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [sendInterval, setSendInterval] = useState(15);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // IPC hooks
  const { invoke: authStart, loading: authLoading } = useIpcInvoke(IPC_CHANNELS.GOOGLE_AUTH_START);
  const { invoke: authStatusCheck } = useIpcInvoke(IPC_CHANNELS.GOOGLE_AUTH_STATUS);
  const { invoke: authRevoke } = useIpcInvoke(IPC_CHANNELS.GOOGLE_AUTH_REVOKE);
  const { invoke: getSettings } = useIpcInvoke<AppSettings>(IPC_CHANNELS.SETTINGS_GET);
  const { invoke: setSettings } = useIpcInvoke(IPC_CHANNELS.SETTINGS_SET);

  // Load settings and auth status on mount
  useEffect(() => {
    loadSettings();
    checkAuthStatus();
  }, []);

  // Parse sheet ID from URL
  useEffect(() => {
    const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    setSheetId(match ? match[1] : '');
  }, [sheetUrl]);

  async function checkAuthStatus() {
    try {
      const result = await authStatusCheck();
      if (result && typeof result === 'object' && 'connected' in result) {
        setAuthStatus((result as { connected: boolean }).connected ? 'connected' : 'disconnected');
      } else {
        setAuthStatus('disconnected');
      }
    } catch {
      setAuthStatus('disconnected');
    }
  }

  async function loadSettings() {
    try {
      const settings = await getSettings();
      if (settings) {
        const s = settings as AppSettings & { geminiApiKey?: string };
        setSheetUrl(s.googleSheetUrl || '');
        setConcurrency(s.concurrency || 2);
        setSendInterval(s.sendIntervalMinutes || 15);
        if (s.geminiApiKey) {
          setGeminiApiKey(s.geminiApiKey);
        }
      }
    } catch {
      // Settings not available yet, use defaults
    }
  }

  async function handleConnect() {
    setAuthError(null);
    try {
      const result = await authStart();
      if (result) {
        setAuthStatus('connected');
      } else {
        setAuthError('Failed to connect Google account. Please try again.');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function handleDisconnect() {
    setAuthError(null);
    try {
      await authRevoke();
      setAuthStatus('disconnected');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      await setSettings({
        googleSheetUrl: sheetUrl,
        concurrency,
        sendIntervalMinutes: sendInterval,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        geminiApiKey,
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  return (
    <div className="page setup-page">
      <h2>Setup</h2>
      <p>Connect your Google account and configure settings.</p>

      <div className="setup-cards">
        {/* Google Account Connection */}
        <div className="setup-card">
          <h3>Google Account</h3>
          <div className="status-row">
            <span className={`status-dot ${authStatus === 'connected' ? 'status-dot--green' : 'status-dot--red'}`} />
            <span>
              {authStatus === 'loading'
                ? 'Checking...'
                : authStatus === 'connected'
                  ? 'Connected'
                  : 'Not Connected'}
            </span>
          </div>
          {authStatus === 'disconnected' && (
            <button className="btn btn--primary" onClick={handleConnect} disabled={authLoading}>
              {authLoading ? 'Connecting...' : 'Connect Google Account'}
            </button>
          )}
          {authStatus === 'connected' && (
            <button className="btn btn--outline" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
          {authError && <p className="error-text">{authError}</p>}
        </div>

        {/* Gemini API Key */}
        <div className="setup-card">
          <h3>Gemini API Key</h3>
          <div className="input-group">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="AIza..."
              className="input"
            />
            <button className="btn btn--icon" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {/* Google Sheet URL */}
        <div className="setup-card">
          <h3>Google Sheet URL</h3>
          <input
            type="text"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="input input--full"
          />
          {sheetId && <p className="hint-text">Sheet ID: {sheetId}</p>}
          {sheetUrl && !sheetId && <p className="error-text">Invalid Google Sheet URL</p>}
        </div>

        {/* Scan Settings */}
        <div className="setup-card">
          <h3>Scan Settings</h3>
          <div className="settings-row">
            <label>Concurrent Scans</label>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="select"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <label>Send Interval (minutes)</label>
            <input
              type="number"
              value={sendInterval}
              min={5}
              max={60}
              onChange={(e) => setSendInterval(Number(e.target.value))}
              className="input input--small"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button className="btn btn--primary btn--large" onClick={handleSave} disabled={saveStatus === 'saving'}>
        {saveStatus === 'saving'
          ? 'Saving...'
          : saveStatus === 'saved'
            ? 'Saved!'
            : saveStatus === 'error'
              ? 'Error - Try Again'
              : 'Save Settings'}
      </button>

      <p className="version-text">Deep Problem Scanner v1.0.0</p>
    </div>
  );
}
