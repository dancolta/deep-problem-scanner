import React, { useState, useEffect } from 'react';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { DEFAULT_EMAIL_TEMPLATE } from '../../services/email/prompt-template';
import './SetupPage.css';

interface SavedSettings {
  googleSheetUrl?: string;
  concurrency?: number;
  timezone?: string;
  geminiApiKey?: string;
  pageSpeedApiKey?: string;
  customEmailTemplate?: string;
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
  const [sheetStatus, setSheetStatus] = useState<'untested' | 'testing' | 'connected' | 'error'>('untested');
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Email template state
  const [emailTemplate, setEmailTemplate] = useState('');
  const [templateSaveStatus, setTemplateSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // Load settings and auth status on mount
  useEffect(() => {
    loadSettings();
    checkAuthStatus();
  }, []);

  // Parse sheet ID from URL
  useEffect(() => {
    const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    setSheetId(match ? match[1] : '');
    setSheetStatus('untested');
    setSheetError(null);
  }, [sheetUrl]);

  // Auto-save email template with debounce
  useEffect(() => {
    // Skip if template is empty or matches default (no need to save default)
    if (!emailTemplate) return;

    setTemplateSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        // Get current settings first
        const result = await ipc<{ success: boolean; settings?: SavedSettings }>(IPC_CHANNELS.SETTINGS_GET);
        const currentSettings = result?.settings || {};

        // Save with updated template
        await ipc(IPC_CHANNELS.SETTINGS_SET, {
          ...currentSettings,
          customEmailTemplate: emailTemplate,
        });
        setTemplateSaveStatus('saved');
        setTimeout(() => setTemplateSaveStatus('idle'), 2000);
      } catch {
        setTemplateSaveStatus('idle');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [emailTemplate]);

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
        }
        if (s.customEmailTemplate) {
          setEmailTemplate(s.customEmailTemplate);
        } else {
          // Load default template
          setEmailTemplate(DEFAULT_EMAIL_TEMPLATE);
        }
      }
    } catch {
      // Settings not available yet, use defaults
      setEmailTemplate(DEFAULT_EMAIL_TEMPLATE);
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
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  async function handleRestoreDefault() {
    setEmailTemplate(DEFAULT_EMAIL_TEMPLATE);
    setShowRestoreConfirm(false);
    // Auto-save will trigger from useEffect
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
              onChange={(e) => setPageSpeedApiKey(e.target.value)}
              placeholder="AIza..."
              className="input"
            />
            <button className="btn btn--icon" onClick={() => setShowPageSpeedKey(!showPageSpeedKey)}>
              {showPageSpeedKey ? 'Hide' : 'Show'}
            </button>
          </div>
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

        {/* Email Template */}
        <div className="setup-card setup-card--wide">
          <div className="card-header-row">
            <div>
              <h3>Email Template</h3>
              <p className="hint-text">Customize the AI prompt template used to generate outreach emails. Use {'{'}{'{'} placeholders {'}'}{'}'}  for dynamic values.</p>
            </div>
            <div className="template-actions">
              {templateSaveStatus === 'saving' && <span className="save-indicator">Saving...</span>}
              {templateSaveStatus === 'saved' && <span className="save-indicator save-indicator--success">Saved ✓</span>}
              <button
                className="btn btn--outline btn--small"
                onClick={() => setShowRestoreConfirm(true)}
              >
                Restore to Default
              </button>
            </div>
          </div>
          <textarea
            className="template-editor"
            value={emailTemplate}
            onChange={(e) => setEmailTemplate(e.target.value)}
            placeholder="Email template..."
            rows={20}
          />
          <p className="hint-text" style={{ marginTop: '8px' }}>
            Available placeholders: {'{{'}firstName{'}}'}, {'{{'}companyName{'}}'}, {'{{'}domain{'}}'}, {'{{'}loadTime{'}}'}, {'{{'}conversionLoss{'}}'}, {'{{'}issueCount{'}}'}, {'{{'}heroIssues{'}}'}, {'{{'}worstProblem{'}}'}, {'{{'}diagnosticsSummary{'}}'}, {'{{'}issueWord{'}}'}
          </p>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {showRestoreConfirm && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Restore Default Template?</h3>
            <p>This will replace your current template with the factory default. This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn--outline" onClick={() => setShowRestoreConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={handleRestoreDefault}>
                Restore Default
              </button>
            </div>
          </div>
        </div>
      )}

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
