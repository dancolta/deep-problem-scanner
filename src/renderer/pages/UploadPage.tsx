import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { Lead, ScanSource } from '../../shared/types';
import { useScan } from '../context/ScanContext';
import EmptyState from '../components/EmptyState';
import './UploadPage.css';

type ImportSource = 'quick' | 'sheets' | 'csv';

interface PipelineResult {
  leads: Lead[];
  totalParsed: number;
  invalidLeads: { lead: Lead; reasons: string[] }[];
  duplicateEmails: Lead[];
  alreadyScanned: Lead[];
  alreadyProcessed: number;  // Leads with Processed checkbox marked
  skippedByRange: number;
}

interface ParseResponse {
  success: boolean;
  result?: PipelineResult;
  error?: string;
}

interface SheetsImportResponse extends ParseResponse {
  sheetName?: string;
  debug?: {
    headers: string[];
    message: string;
  };
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<PipelineResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [scanAll, setScanAll] = useState(true);
  const [rangeStart, setRangeStart] = useState<number | ''>('');
  const [rangeEnd, setRangeEnd] = useState<number | ''>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { startScan } = useScan();

  // Quick Scan state
  const [quickScanUrl, setQuickScanUrl] = useState('');
  const [quickScanName, setQuickScanName] = useState('');
  const [quickScanContactName, setQuickScanContactName] = useState('');
  const [quickScanContactEmail, setQuickScanContactEmail] = useState('');
  const [quickScanError, setQuickScanError] = useState<string | null>(null);

  // New state variables for tabbed interface
  const [importSource, setImportSource] = useState<ImportSource>('sheets');
  const [sheetsUrl, setSheetsUrl] = useState('');
  const [sheetsStatus, setSheetsStatus] = useState<'idle' | 'importing' | 'connected' | 'error'>('idle');
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);

  // Validation review state - tracks whether user has cleared flagged leads
  const [listCleared, setListCleared] = useState(false);
  const [showFlaggedLeads, setShowFlaggedLeads] = useState(false);

  // Helper for URL validation
  const sheetsId = useMemo(() => {
    const match = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }, [sheetsUrl]);

  const isValidSheetsUrl = Boolean(sheetsId) || (sheetsUrl.length > 20 && /^[a-zA-Z0-9_-]+$/.test(sheetsUrl));

  // Quick Scan URL validation and domain extraction
  const normalizeUrl = useCallback((url: string): string => {
    let normalized = url.trim();
    if (normalized && !normalized.match(/^https?:\/\//i)) {
      normalized = 'https://' + normalized;
    }
    return normalized;
  }, []);

  const extractDomain = useCallback((url: string): string => {
    try {
      const normalized = normalizeUrl(url);
      const urlObj = new URL(normalized);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }, [normalizeUrl]);

  const isValidUrl = useCallback((url: string): boolean => {
    try {
      const normalized = normalizeUrl(url);
      new URL(normalized);
      return true;
    } catch {
      return false;
    }
  }, [normalizeUrl]);

  const parseFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setParseResult(null);
    setIsLoading(true);
    setListCleared(false);
    setShowFlaggedLeads(false);

    try {
      const content = await selectedFile.text();
      if (!content) {
        setParseError('File is empty.');
        return;
      }

      const response = await window.electronAPI.invoke(
        IPC_CHANNELS.CSV_PARSE,
        content
      ) as ParseResponse;

      if (response.success && response.result) {
        setParseResult(response.result);
        setRangeEnd(Math.max(response.result.leads.length - 1, 0));
      } else {
        setParseError(response.error || 'Failed to parse lead list.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing lead list';
      setParseError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      parseFile(selected);
    }
  }, [parseFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      parseFile(droppedFile);
    } else {
      setParseError('Please drop a valid CSV file (.csv)');
    }
  }, [parseFile]);

  const handleClear = useCallback(() => {
    setFile(null);
    setParseResult(null);
    setParseError(null);
    setIsLoading(false);
    setScanAll(true);
    setRangeStart(0);
    setRangeEnd(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Also clear sheets-related state
    setSheetsUrl('');
    setSheetsStatus('idle');
    setSheetsError(null);
    setSheetName(null);
    // Reset validation review state
    setListCleared(false);
    setShowFlaggedLeads(false);
  }, []);

  // Tab switch handler
  const handleTabSwitch = useCallback((newSource: ImportSource) => {
    if (newSource === importSource) return;

    // Clear all state
    handleClear();
    setSheetsUrl('');
    setSheetsStatus('idle');
    setSheetsError(null);
    setSheetName(null);
    setQuickScanUrl('');
    setQuickScanName('');
    setQuickScanContactName('');
    setQuickScanContactEmail('');
    setQuickScanError(null);

    setImportSource(newSource);
  }, [importSource, handleClear]);

  // Sheets import handler
  const handleImportFromSheets = useCallback(async () => {
    if (!sheetsUrl.trim()) return;

    setSheetsStatus('importing');
    setSheetsError(null);
    setParseResult(null);
    setParseError(null);
    setListCleared(false);
    setShowFlaggedLeads(false);

    try {
      const response = await window.electronAPI.invoke(
        IPC_CHANNELS.SHEETS_IMPORT_LEADS,
        sheetsUrl
      ) as SheetsImportResponse;

      if (response.success && response.result) {
        setParseResult(response.result);
        setSheetName(response.sheetName || null);
        setRangeEnd(Math.max(response.result.leads.length - 1, 0));
        setSheetsStatus('connected');

        // Show debug info if no leads were matched
        if (response.result.leads.length === 0 && response.debug) {
          setSheetsError(response.debug.message);
        }
      } else {
        setSheetsError(response.error || 'Failed to import from Google Sheets');
        setSheetsStatus('error');
      }
    } catch (err) {
      setSheetsError(err instanceof Error ? err.message : 'Unknown error');
      setSheetsStatus('error');
    }
  }, [sheetsUrl]);

  const handleRefreshFromSheets = useCallback(async () => {
    await handleImportFromSheets();
  }, [handleImportFromSheets]);

  // Quick Scan handler
  const handleQuickScan = useCallback(async () => {
    setQuickScanError(null);

    if (!quickScanUrl.trim()) {
      setQuickScanError('Please enter a website URL');
      return;
    }

    if (!isValidUrl(quickScanUrl)) {
      setQuickScanError('Please enter a valid URL');
      return;
    }

    const normalizedUrl = normalizeUrl(quickScanUrl);
    const displayName = quickScanName.trim() || extractDomain(quickScanUrl);
    const contactName = quickScanContactName.trim();
    const contactEmail = quickScanContactEmail.trim();
    const hasContact = Boolean(contactEmail);

    // Create a manual Lead object - if contact info provided, treat as list import
    const manualLead: Lead = {
      company_name: displayName,
      website_url: normalizedUrl,
      contact_name: contactName,
      contact_email: contactEmail,
      scanSource: hasContact ? 'list' : 'manual',
      hasContactInfo: hasContact,
    };

    try {
      const settingsResponse = await window.electronAPI.invoke(
        IPC_CHANNELS.SETTINGS_GET
      ) as { success?: boolean; settings?: { googleSheetUrl?: string } } | null;

      const sheetUrl = settingsResponse?.settings?.googleSheetUrl || '';
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const spreadsheetId = match ? match[1] : '';

      // Start scan - use 'list' source if contact info provided, otherwise 'manual'
      startScan([manualLead], spreadsheetId, hasContact ? 'list' : 'manual');
      navigate('/scan');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start scan';
      setQuickScanError(message);
    }
  }, [quickScanUrl, quickScanName, quickScanContactName, quickScanContactEmail, isValidUrl, normalizeUrl, extractDomain, startScan, navigate]);

  // Handler to clear flagged leads (user acknowledges and removes invalid entries)
  const handleClearFlaggedLeads = useCallback(() => {
    setListCleared(true);
    setShowFlaggedLeads(false);
  }, []);

  // Check if there are flagged leads that need to be cleared
  const hasFlaggedLeads = Boolean(parseResult && parseResult.invalidLeads.length > 0);
  const needsClearance = hasFlaggedLeads && !listCleared;

  const getLeadsToScan = useCallback((): Lead[] => {
    if (!parseResult) return [];
    if (scanAll) return parseResult.leads;
    const start = rangeStart === '' ? 0 : rangeStart;
    const end = rangeEnd === '' ? parseResult.leads.length - 1 : rangeEnd;
    return parseResult.leads.slice(start, end + 1);
  }, [parseResult, scanAll, rangeStart, rangeEnd]);

  const getDisplayLeads = useCallback((): Lead[] => {
    const leads = getLeadsToScan();
    return leads.slice(0, 20);
  }, [getLeadsToScan]);

  const handleStartScan = useCallback(async () => {
    const leads = getLeadsToScan();
    if (leads.length === 0) return;

    try {
      const settingsResponse = await window.electronAPI.invoke(
        IPC_CHANNELS.SETTINGS_GET
      ) as { success?: boolean; settings?: { googleSheetUrl?: string } } | null;

      const sheetUrl = settingsResponse?.settings?.googleSheetUrl || '';
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const spreadsheetId = match ? match[1] : '';

      // Mark all leads as processed in source sheet BEFORE scanning starts
      // This ensures they won't be re-imported even if scan fails
      const leadsWithSource = leads.filter(
        (l: Lead) => l.sourceSpreadsheetId && l.sourceRowNumber && l.sourceSheetName
      );

      if (leadsWithSource.length > 0) {
        const firstLead = leadsWithSource[0] as Lead;
        const rowNumbers = leadsWithSource.map((l: Lead) => l.sourceRowNumber as number);

        console.log(`[UploadPage] Marking ${rowNumbers.length} leads as processed before scan`);

        const markResult = await window.electronAPI.invoke(
          IPC_CHANNELS.SHEETS_MARK_PROCESSED,
          {
            spreadsheetId: firstLead.sourceSpreadsheetId,
            sheetName: firstLead.sourceSheetName,
            rowNumbers,
          }
        ) as { success: boolean; markedCount?: number; error?: string };

        if (!markResult.success) {
          console.error('[UploadPage] Failed to mark leads as processed:', markResult.error);
          // Continue with scan anyway - marking is best-effort
        } else {
          console.log(`[UploadPage] Successfully marked ${markResult.markedCount} leads as processed`);
        }
      }

      // Fire-and-forget via context — navigates immediately
      startScan(leads, spreadsheetId);
      navigate('/scan');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start scan';
      setParseError(message);
    }
  }, [getLeadsToScan, navigate, startScan]);

  return (
    <div className="page upload-page">
      <h2>Upload Leads</h2>
      <p>Import leads to scan and reach out to.</p>

      {/* Import method tabs */}
      <div className="import-tabs">
        <button
          className={`import-tab ${importSource === 'sheets' ? 'import-tab--active' : ''}`}
          onClick={() => handleTabSwitch('sheets')}
        >
          Google Sheets
        </button>
        <button
          className={`import-tab ${importSource === 'quick' ? 'import-tab--active' : ''}`}
          onClick={() => handleTabSwitch('quick')}
        >
          Quick Scan
        </button>
        <button
          className={`import-tab ${importSource === 'csv' ? 'import-tab--active' : ''}`}
          onClick={() => handleTabSwitch('csv')}
        >
          Lead List
        </button>
      </div>

      {importSource === 'quick' && (
        <div className="quick-scan-section">
          <p className="quick-scan-description">Scan any website instantly without importing a list</p>
          <div className="quick-scan-inputs">
            <div className="quick-scan-field">
              <label>Website URL *</label>
              <input
                type="text"
                value={quickScanUrl}
                onChange={(e) => {
                  setQuickScanUrl(e.target.value);
                  setQuickScanError(null);
                }}
                placeholder="example.com or https://example.com"
                className="input input--full"
              />
            </div>
            <div className="quick-scan-field">
              <label>Company Name (optional)</label>
              <input
                type="text"
                value={quickScanName}
                onChange={(e) => setQuickScanName(e.target.value)}
                placeholder="Defaults to domain"
                className="input input--full"
              />
            </div>
          </div>
          <div className="quick-scan-inputs" style={{ marginTop: '12px' }}>
            <div className="quick-scan-field">
              <label>Contact Name (optional)</label>
              <input
                type="text"
                value={quickScanContactName}
                onChange={(e) => setQuickScanContactName(e.target.value)}
                placeholder="John Smith"
                className="input input--full"
              />
            </div>
            <div className="quick-scan-field">
              <label>Contact Email (optional)</label>
              <input
                type="email"
                value={quickScanContactEmail}
                onChange={(e) => setQuickScanContactEmail(e.target.value)}
                placeholder="john@example.com"
                className="input input--full"
              />
            </div>
          </div>
          <p className="quick-scan-hint">
            Add contact info to create a Gmail draft automatically
          </p>
          {quickScanError && (
            <div className="banner banner--error" style={{ marginTop: '12px' }}>{quickScanError}</div>
          )}
          <button
            className="btn-primary"
            onClick={handleQuickScan}
            disabled={!quickScanUrl.trim()}
            style={{ marginTop: '16px' }}
          >
            Scan Website
          </button>
        </div>
      )}

      {importSource === 'csv' && (
        <div
          className={`upload-zone ${isDragOver ? 'upload-zone--active' : ''} ${file ? 'upload-zone--has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {isLoading ? (
            <>
              <div className="upload-icon">&#8987;</div>
              <p className="upload-text">Parsing lead list...</p>
            </>
          ) : !file ? (
            <>
              <div className="upload-icon">&#128193;</div>
              <p className="upload-text">Drag &amp; drop a lead list here</p>
              <p className="upload-subtext">CSV format - click to browse</p>
            </>
          ) : (
            <>
              <div className="upload-icon">&#9989;</div>
              <p className="upload-text">{file.name}</p>
              <p className="upload-subtext">{(file.size / 1024).toFixed(1)} KB</p>
            </>
          )}
        </div>
      )}

      {importSource === 'sheets' && (
        <div className="sheets-import-section">
          <div className="upload-input-row">
            <input
              type="text"
              value={sheetsUrl}
              onChange={(e) => {
                setSheetsUrl(e.target.value);
                setSheetsStatus('idle');
                setSheetsError(null);
              }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="input input--full"
              disabled={sheetsStatus === 'importing'}
            />
            <button
              className="btn-primary"
              onClick={handleImportFromSheets}
              disabled={!isValidSheetsUrl || sheetsStatus === 'importing'}
            >
              {sheetsStatus === 'importing' ? 'Importing...' : 'Import'}
            </button>
          </div>

          {/* Connection status */}
          {sheetsStatus === 'connected' && sheetName && (
            <div className="sheets-status sheets-status--connected">
              <span className="status-dot status-dot--green"></span>
              <span>Connected to "{sheetName}"</span>
              <button
                className="btn-secondary btn-sm"
                onClick={handleRefreshFromSheets}
              >
                Refresh
              </button>
            </div>
          )}

          {sheetsError && (
            <div className="banner banner--error">{sheetsError}</div>
          )}
        </div>
      )}

      {parseError && <div className="banner banner--error">{parseError}</div>}
      {parseResult && parseResult.leads.length > 0 && (
        <div className="banner banner--success">
          Found {parseResult.totalParsed} leads &mdash; {parseResult.leads.length} ready to scan
        </div>
      )}

      {/* Empty state when sheets connected but no leads */}
      {importSource === 'sheets' && sheetsStatus === 'connected' && parseResult && parseResult.leads.length === 0 && (
        <EmptyState
          icon="📋"
          heading="No leads found"
          description="The Google Sheet was imported but no valid leads were found. Make sure your sheet has the required columns: company_name, website_url, contact_name, and contact_email."
          tip="Check that leads aren't already marked as processed in your sheet."
        />
      )}

      {/* Empty state when sheets not yet connected */}
      {importSource === 'sheets' && sheetsStatus === 'idle' && !parseResult && (
        <div className="sheets-empty-hint">
          <p>No leads imported yet. Paste a Google Sheets URL above and click Import.</p>
        </div>
      )}

      {/* Flagged Leads Section - Shows when there are invalid leads */}
      {parseResult && parseResult.invalidLeads.length > 0 && (
        <div className={`flagged-leads-section ${listCleared ? 'flagged-leads-section--cleared' : ''}`}>
          <div className="flagged-leads-header">
            <div className="flagged-leads-title">
              <span className="flagged-icon">{listCleared ? '\u2713' : '\u26A0'}</span>
              <span>
                {listCleared
                  ? `${parseResult.invalidLeads.length} invalid leads removed`
                  : `${parseResult.invalidLeads.length} leads flagged for removal`
                }
              </span>
            </div>
            <div className="flagged-leads-actions">
              {!listCleared && (
                <>
                  <button
                    className="btn btn--text"
                    onClick={() => setShowFlaggedLeads(!showFlaggedLeads)}
                  >
                    {showFlaggedLeads ? 'Hide Details' : 'View Details'}
                  </button>
                  <button
                    className="btn btn--warning"
                    onClick={handleClearFlaggedLeads}
                  >
                    Clear List
                  </button>
                </>
              )}
              {listCleared && (
                <button
                  className="btn btn--text"
                  onClick={() => setShowFlaggedLeads(!showFlaggedLeads)}
                >
                  {showFlaggedLeads ? 'Hide' : 'View Removed'}
                </button>
              )}
            </div>
          </div>

          {showFlaggedLeads && (
            <div className="flagged-leads-list">
              <table className="flagged-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Website</th>
                    <th>Email</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.invalidLeads.map((item, i) => (
                    <tr key={i}>
                      <td>{item.lead.company_name || <span className="text-muted">empty</span>}</td>
                      <td>{item.lead.website_url || <span className="text-muted">empty</span>}</td>
                      <td>{item.lead.contact_email || <span className="text-muted">empty</span>}</td>
                      <td className="text-red">{item.reasons.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!listCleared && (
            <p className="flagged-leads-hint">
              These leads have missing or invalid data and won't be processed. Click "Clear List" to remove them and continue.
            </p>
          )}
        </div>
      )}

      {parseResult && parseResult.leads.length > 0 && (
        <div className="preview-table-container">
          <table className="preview-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Website</th>
                <th>Contact</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {getDisplayLeads().map((lead, i) => (
                <tr key={i}>
                  <td>{i + 1 + (scanAll ? 0 : (rangeStart || 0))}</td>
                  <td>{lead.company_name}</td>
                  <td className="url-cell">{lead.website_url}</td>
                  <td>{lead.contact_name}</td>
                  <td>{lead.contact_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="table-count">
            Showing {Math.min(getDisplayLeads().length, 20)} of {getLeadsToScan().length} leads
          </p>
        </div>
      )}

      {parseResult && (
        <div className="range-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={scanAll}
              onChange={(e) => setScanAll(e.target.checked)}
            />
            Scan all leads
          </label>
          {!scanAll && (
            <div className="range-inputs">
              <div className="range-field">
                <label>Start row</label>
                <input
                  type="number"
                  value={rangeStart}
                  min={0}
                  max={parseResult.leads.length - 1}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRangeStart(val === '' ? '' : parseInt(val));
                  }}
                  className="input input--small"
                />
              </div>
              <div className="range-field">
                <label>End row</label>
                <input
                  type="number"
                  value={rangeEnd}
                  min={rangeStart === '' ? 0 : rangeStart}
                  max={parseResult.leads.length - 1}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRangeEnd(val === '' ? '' : parseInt(val));
                  }}
                  className="input input--small"
                />
              </div>
              <p className="range-count">Will scan {Math.max((rangeEnd === '' ? 0 : rangeEnd) - (rangeStart === '' ? 0 : rangeStart) + 1, 0)} leads</p>
            </div>
          )}
        </div>
      )}

      {parseResult && (
        <div className="summary-panel">
          <h3>Summary</h3>
          <div className="summary-row">
            <span>Total parsed</span>
            <span>{parseResult.totalParsed}</span>
          </div>
          <div className="summary-row">
            <span>Valid leads</span>
            <span className="text-green">{parseResult.leads.length + parseResult.alreadyScanned.length}</span>
          </div>
          <div className="summary-row">
            <span>Invalid leads</span>
            <span className="text-red">{parseResult.invalidLeads.length}</span>
          </div>
          <div className="summary-row">
            <span>Duplicate emails</span>
            <span className="text-yellow">{parseResult.duplicateEmails.length}</span>
          </div>
          <div className="summary-row">
            <span>Already scanned</span>
            <span className="text-yellow">{parseResult.alreadyScanned.length}</span>
          </div>
          {parseResult.alreadyProcessed > 0 && (
            <div className="summary-row">
              <span>Already processed</span>
              <span className="text-yellow">{parseResult.alreadyProcessed}</span>
            </div>
          )}
          <div className="summary-row summary-row--total">
            <span>Ready to scan</span>
            <span className="text-green">{getLeadsToScan().length}</span>
          </div>
        </div>
      )}

      {/* Action bar with lead count */}
      {(parseResult || file) && (
        <div className="upload-action-bar">
          <span className="upload-lead-count">
            {parseResult ? (
              <span className="mono">{getLeadsToScan().length}</span>
            ) : (
              <span className="mono">0</span>
            )} leads imported
          </span>
          <div className="action-buttons">
            <button className="btn-secondary" onClick={handleClear} disabled={!file && !parseResult}>
              Clear
            </button>
            <button
              className="btn-primary"
              onClick={handleStartScan}
              disabled={!parseResult || getLeadsToScan().length === 0 || needsClearance}
              title={needsClearance ? 'Clear flagged leads before scanning' : undefined}
            >
              {needsClearance
                ? `Clear List First (${parseResult?.invalidLeads.length} flagged)`
                : 'Start Scan'
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
