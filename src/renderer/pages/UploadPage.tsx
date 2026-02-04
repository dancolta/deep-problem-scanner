import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { Lead } from '../../shared/types';
import { useScan } from '../context/ScanContext';
import './UploadPage.css';

type ImportSource = 'csv' | 'sheets';

interface PipelineResult {
  leads: Lead[];
  totalParsed: number;
  invalidLeads: { lead: Lead; reason: string }[];
  duplicateEmails: Lead[];
  alreadyScanned: Lead[];
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

  // New state variables for tabbed interface
  const [importSource, setImportSource] = useState<ImportSource>('csv');
  const [sheetsUrl, setSheetsUrl] = useState('');
  const [sheetsStatus, setSheetsStatus] = useState<'idle' | 'importing' | 'connected' | 'error'>('idle');
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);

  // Helper for URL validation
  const sheetsId = useMemo(() => {
    const match = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }, [sheetsUrl]);

  const isValidSheetsUrl = Boolean(sheetsId) || (sheetsUrl.length > 20 && /^[a-zA-Z0-9_-]+$/.test(sheetsUrl));

  const parseFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setParseResult(null);
    setIsLoading(true);

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
        setParseError(response.error || 'Failed to parse CSV file.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error parsing CSV';
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
      setParseError('Please drop a valid CSV file.');
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

    setImportSource(newSource);
  }, [importSource, handleClear]);

  // Sheets import handler
  const handleImportFromSheets = useCallback(async () => {
    if (!sheetsUrl.trim()) return;

    setSheetsStatus('importing');
    setSheetsError(null);
    setParseResult(null);
    setParseError(null);

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
      <p>Upload a CSV file with leads to scan and reach out to.</p>

      {/* Import method tabs */}
      <div className="import-tabs">
        <button
          className={`import-tab ${importSource === 'csv' ? 'import-tab--active' : ''}`}
          onClick={() => handleTabSwitch('csv')}
        >
          CSV File
        </button>
        <button
          className={`import-tab ${importSource === 'sheets' ? 'import-tab--active' : ''}`}
          onClick={() => handleTabSwitch('sheets')}
        >
          Google Sheets
        </button>
      </div>

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
              <p className="upload-text">Parsing CSV...</p>
            </>
          ) : !file ? (
            <>
              <div className="upload-icon">&#128193;</div>
              <p className="upload-text">Drag &amp; drop a CSV file here</p>
              <p className="upload-subtext">or click to browse</p>
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
          <div className="sheets-input-row">
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
          </div>

          <div className="sheets-actions">
            <button
              className="btn btn--primary"
              onClick={handleImportFromSheets}
              disabled={!isValidSheetsUrl || sheetsStatus === 'importing'}
            >
              {sheetsStatus === 'importing' ? 'Importing...' : 'Import Leads'}
            </button>

            {sheetsStatus === 'connected' && (
              <button
                className="btn btn--outline"
                onClick={handleRefreshFromSheets}
              >
                Refresh from Sheet
              </button>
            )}
          </div>

          {/* Connection status */}
          {sheetsStatus === 'connected' && sheetName && (
            <div className="sheets-status sheets-status--connected">
              <span className="status-dot status-dot--green"></span>
              <span>Connected to "{sheetName}"</span>
            </div>
          )}

          {sheetsError && (
            <div className="banner banner--error">{sheetsError}</div>
          )}
        </div>
      )}

      {parseError && <div className="banner banner--error">{parseError}</div>}
      {parseResult && (
        <div className="banner banner--success">
          Found {parseResult.totalParsed} leads &mdash; {parseResult.leads.length} ready to scan
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
          <div className="summary-row summary-row--total">
            <span>Ready to scan</span>
            <span className="text-green">{getLeadsToScan().length}</span>
          </div>
        </div>
      )}

      <div className="action-buttons">
        <button className="btn btn--outline" onClick={handleClear} disabled={!file && !parseResult}>
          Clear
        </button>
        <button
          className="btn btn--primary btn--large"
          onClick={handleStartScan}
          disabled={!parseResult || getLeadsToScan().length === 0}
        >
          Start Scan ({getLeadsToScan().length} leads)
        </button>
      </div>
    </div>
  );
}
