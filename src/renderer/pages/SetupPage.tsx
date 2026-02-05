import React, { useState, useEffect } from 'react';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { SendAsAddress } from '../../shared/types';
import './SetupPage.css';

interface SavedSettings {
  googleSheetUrl?: string;
  concurrency?: number;
  timezone?: string;
  geminiApiKey?: string;
  pageSpeedApiKey?: string;
  customEmailTemplate?: string;
  selectedSenderEmail?: string;
}

export default function SetupPage() {
  // Auth state
  const [authStatus, setAuthStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Settings state
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [pageSpeedApiKey, setPageSpeedApiKey] = useState('');
  const [showPageSpeedKey, setShowPageSpeedKey] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [geminiStatus, setGeminiStatus] = useState<'untested' | 'testing' | 'valid' | 'invalid'>('untested');
  const [pageSpeedStatus, setPageSpeedStatus] = useState<'untested' | 'testing' | 'valid' | 'invalid'>('untested');
  const [sheetStatus, setSheetStatus] = useState<'untested' | 'testing' | 'connected' | 'error'>('untested');
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Sender alias state
  const [senderAddresses, setSenderAddresses] = useState<SendAsAddress[]>([]);
  const [selectedSender, setSelectedSender] = useState<string>('');
  const [loadingSenders, setLoadingSenders] = useState(false);
  const [senderSaveStatus, setSenderSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Load settings and auth status on mount
  useEffect(() => {
    loadSettings();
    checkAuthStatus();
  }, []);

  // Fetch sendAs addresses when authenticated
  useEffect(() => {
    if (authStatus === 'connected') {
      fetchSenderAddresses();
    }
  }, [authStatus]);

  async function fetchSenderAddresses() {
    setLoadingSenders(true);
    try {
      const resp = await ipc<{ success: boolean; addresses?: SendAsAddress[] }>(IPC_CHANNELS.GMAIL_GET_SEND_AS);
      if (resp?.success && resp.addresses) {
        setSenderAddresses(resp.addresses);
        // If no sender selected yet, set default
        if (!selectedSender) {
          const defaultAddr = resp.addresses.find(a => a.isDefault) ||
                             resp.addresses.find(a => a.isPrimary) ||
                             resp.addresses[0];
          if (defaultAddr) {
            setSelectedSender(defaultAddr.email);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch sendAs addresses:', err);
    } finally {
      setLoadingSenders(false);
    }
  }

  async function handleSenderChange(email: string) {
    setSelectedSender(email);
    setSenderSaveStatus('saving');
    try {
      // Load current settings and update just the sender email
      const result = await ipc<{ success: boolean; settings?: SavedSettings }>(IPC_CHANNELS.SETTINGS_GET);
      const current = result?.settings || {};
      await ipc(IPC_CHANNELS.SETTINGS_SET, {
        ...current,
        selectedSenderEmail: email,
      });
      setSenderSaveStatus('saved');
      setTimeout(() => setSenderSaveStatus('idle'), 2000);
    } catch {
      setSenderSaveStatus('idle');
    }
  }

  // Parse sheet ID from URL
  useEffect(() => {
    const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    setSheetId(match ? match[1] : '');
    setSheetStatus('untested');
    setSheetError(null);
  }, [sheetUrl]);


  async function ipc<T = any>(channel: string, ...args: any[]): Promise<T> {
    return await window.electronAPI.invoke(channel, ...args) as T;
  }

  async function checkAuthStatus() {
    try {
      const result = await ipc<{ success: boolean; status?: string }>(IPC_CHANNELS.GOOGLE_AUTH_STATUS);
      if (result?.success && result.status === 'authenticated') {
        setAuthStatus('connected');
      } else {
        setAuthStatus('disconnected');
      }
    } catch {
      setAuthStatus('disconnected');
    }
  }

  async function loadSettings() {
    try {
      const result = await ipc<{ success: boolean; settings?: SavedSettings }>(IPC_CHANNELS.SETTINGS_GET);
      if (result?.success && result.settings) {
        const s = result.settings;
        setSheetUrl(s.googleSheetUrl || '');
        setConcurrency(s.concurrency || 2);
        if (s.geminiApiKey) {
          setGeminiApiKey(s.geminiApiKey);
          setGeminiStatus('valid'); // Was saved previously, assume valid
        }
        if (s.pageSpeedApiKey) {
          setPageSpeedApiKey(s.pageSpeedApiKey);
          setPageSpeedStatus('valid'); // Was saved previously, assume valid
        }
        if (s.selectedSenderEmail) {
          setSelectedSender(s.selectedSenderEmail);
        }
      }
    } catch {
      // Settings not available yet, use defaults
    }
  }

  async function handleConnect() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const result = await ipc<{ success: boolean; error?: string }>(IPC_CHANNELS.GOOGLE_AUTH_START);
      if (result?.success) {
        setAuthStatus('connected');
      } else {
        setAuthError(result?.error || 'Failed to connect Google account.');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleDisconnect() {
    setAuthError(null);
    try {
      await ipc(IPC_CHANNELS.GOOGLE_AUTH_REVOKE);
      setAuthStatus('disconnected');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function handleTestGemini() {
    if (!geminiApiKey) return;
    setGeminiStatus('testing');
    try {
      const result = await ipc<{ success: boolean; error?: string }>(IPC_CHANNELS.GEMINI_TEST_KEY, geminiApiKey);
      setGeminiStatus(result?.success ? 'valid' : 'invalid');
    } catch {
      setGeminiStatus('invalid');
    }
  }

  async function handleTestPageSpeed() {
    if (!pageSpeedApiKey) return;
    setPageSpeedStatus('testing');
    try {
      const result = await ipc<{ success: boolean; score?: number; error?: string }>(IPC_CHANNELS.PAGESPEED_TEST_KEY, pageSpeedApiKey);
      setPageSpeedStatus(result?.success ? 'valid' : 'invalid');
    } catch {
      setPageSpeedStatus('invalid');
    }
  }

  async function handleTestSheet() {
    if (!sheetId) return;
    setSheetStatus('testing');
    setSheetError(null);
    try {
      const result = await ipc<{ success: boolean; error?: string }>(IPC_CHANNELS.SHEETS_TEST, sheetId);
      if (result?.success) {
        setSheetStatus('connected');
      } else {
        setSheetStatus('error');
        setSheetError(result?.error || 'Could not connect to sheet.');
      }
    } catch (err) {
      setSheetStatus('error');
      setSheetError(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      await ipc(IPC_CHANNELS.SETTINGS_SET, {
        googleSheetUrl: sheetUrl,
        concurrency,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        geminiApiKey,
        pageSpeedApiKey,
        selectedSenderEmail: selectedSender,
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

        {/* Send From Email */}
        {authStatus === 'connected' && (
          <div className="setup-card">
            <h3>Send From Email</h3>
            <p className="hint-text" style={{ marginBottom: '10px' }}>
              Select which email address to use when sending outreach emails.
            </p>
            <select
              value={selectedSender}
              onChange={(e) => handleSenderChange(e.target.value)}
              className="select select--full"
              disabled={loadingSenders}
            >
              {senderAddresses.length === 0 && (
                <option value="">{loadingSenders ? 'Loading...' : 'No addresses found'}</option>
              )}
              {senderAddresses.map(addr => (
                <option key={addr.email} value={addr.email}>
                  {addr.displayName ? `${addr.displayName} <${addr.email}>` : addr.email}
                  {addr.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            {senderSaveStatus === 'saved' && (
              <div className="sender-saved-banner">
                Sender email updated
              </div>
            )}
          </div>
        )}

        {/* Gemini API Key */}
        <div className="setup-card">
          <h3>Gemini API Key</h3>
          <div className="input-group">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={geminiApiKey}
              onChange={(e) => { setGeminiApiKey(e.target.value); setGeminiStatus('untested'); }}
              placeholder="AIza..."
              className="input"
            />
            <button className="btn btn--icon" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn btn--outline"
              onClick={handleTestGemini}
              disabled={!geminiApiKey || geminiStatus === 'testing'}
            >
              {geminiStatus === 'testing' ? 'Testing...' : 'Test Key'}
            </button>
          </div>
          {geminiStatus === 'valid' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--green" />
              <span style={{ color: '#10b981' }}>Valid API key</span>
            </div>
          )}
          {geminiStatus === 'invalid' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--red" />
              <span style={{ color: '#ef4444' }}>Invalid API key</span>
            </div>
          )}
        </div>

        {/* PageSpeed API Key */}
        <div className="setup-card">
          <h3>PageSpeed API Key</h3>
          <p className="hint-text" style={{ marginBottom: '10px' }}>
            Required for website performance scores. <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>Get API Key</a>
          </p>
          <div className="input-group">
            <input
              type={showPageSpeedKey ? 'text' : 'password'}
              value={pageSpeedApiKey}
              onChange={(e) => { setPageSpeedApiKey(e.target.value); setPageSpeedStatus('untested'); }}
              placeholder="AIza..."
              className="input"
            />
            <button className="btn btn--icon" onClick={() => setShowPageSpeedKey(!showPageSpeedKey)}>
              {showPageSpeedKey ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn btn--outline"
              onClick={handleTestPageSpeed}
              disabled={!pageSpeedApiKey || pageSpeedStatus === 'testing'}
            >
              {pageSpeedStatus === 'testing' ? 'Testing...' : 'Test Key'}
            </button>
          </div>
          {pageSpeedStatus === 'valid' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--green" />
              <span style={{ color: '#10b981' }}>Valid API key</span>
            </div>
          )}
          {pageSpeedStatus === 'invalid' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--red" />
              <span style={{ color: '#ef4444' }}>Invalid API key - enable PageSpeed Insights API in Google Cloud</span>
            </div>
          )}
          <p className="hint-text" style={{ marginTop: '8px' }}>
            Enable "PageSpeed Insights API" in Google Cloud Console for this key.
          </p>
        </div>

        {/* Google Sheet URL */}
        <div className="setup-card">
          <h3>Google Sheet URL</h3>
          <div className="input-group">
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="input"
              style={{ flex: 1 }}
            />
            <button
              className="btn btn--outline"
              onClick={handleTestSheet}
              disabled={!sheetId || sheetStatus === 'testing' || authStatus !== 'connected'}
            >
              {sheetStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
          {sheetId && <p className="hint-text">Sheet ID: {sheetId}</p>}
          {sheetUrl && !sheetId && <p className="error-text">Invalid Google Sheet URL</p>}
          {!sheetId && authStatus !== 'connected' && sheetUrl && (
            <p className="hint-text">Connect Google Account first to test the sheet.</p>
          )}
          {sheetStatus === 'connected' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--green" />
              <span style={{ color: '#10b981' }}>Sheet connected — headers verified</span>
            </div>
          )}
          {sheetStatus === 'error' && (
            <div className="status-row" style={{ marginTop: '10px' }}>
              <span className="status-dot status-dot--red" />
              <span style={{ color: '#ef4444' }}>{sheetError}</span>
            </div>
          )}
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
