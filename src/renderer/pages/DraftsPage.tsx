import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { SheetRow, AppSettings } from '../../shared/types';
import './DraftsPage.css';

type DraftStatus = 'draft' | 'approved' | 'rejected' | 'scheduled' | 'sent' | 'failed';
type FilterTab = 'all' | 'draft' | 'approved' | 'rejected';

interface LocalDraft {
  id: number;
  companyName: string;
  contactName: string;
  contactEmail: string;
  websiteUrl: string;
  subject: string;
  body: string;
  screenshotUrl: string;
  status: DraftStatus;
}

/**
 * Validates that a sheet row has sufficient data to be displayed as a draft.
 * This filters out orphaned/empty drafts that don't have corresponding document data.
 *
 * A valid draft must have:
 * - company_name (required for display)
 * - contact_email (required for sending)
 * - At least email_subject OR email_body (actual draft content)
 */
function isValidDraft(row: SheetRow): boolean {
  const hasCompanyName = Boolean(row.company_name?.trim());
  const hasContactEmail = Boolean(row.contact_email?.trim());
  const hasEmailContent = Boolean(row.email_subject?.trim() || row.email_body?.trim());

  return hasCompanyName && hasContactEmail && hasEmailContent;
}

function mapRowToDraft(row: SheetRow, index: number): LocalDraft {
  const emailStatus = row.email_status || 'draft';
  return {
    id: index,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    websiteUrl: row.website_url,
    subject: row.email_subject || '',
    body: row.email_body || '',
    screenshotUrl: row.screenshot_url || '',
    status: emailStatus as DraftStatus,
  };
}

function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export default function DraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFromSheet = useCallback(async (): Promise<number> => {
    setError(null);
    try {
      const settingsResp = await window.electronAPI.invoke(IPC_CHANNELS.SETTINGS_GET) as any;
      const settings: AppSettings | undefined = settingsResp?.settings ?? settingsResp;
      if (!settings?.googleSheetUrl) {
        setError('No Google Sheet URL configured. Go to Setup first.');
        return 0;
      }
      const sid = extractSpreadsheetId(settings.googleSheetUrl);
      if (!sid) {
        setError('Invalid Google Sheet URL in settings.');
        return 0;
      }
      setSpreadsheetId(sid);

      const sheetsResp = await window.electronAPI.invoke(IPC_CHANNELS.SHEETS_READ, sid) as any;
      if (!sheetsResp?.success) {
        setError(sheetsResp?.error || 'Failed to read sheet data.');
        return 0;
      }
      const rows: SheetRow[] = sheetsResp.rows ?? [];
      // Filter out orphaned/empty drafts while preserving original row index for sheet updates
      // The index passed to mapRowToDraft becomes the draft.id, used for updateSheetRow calls
      const validDrafts = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => isValidDraft(row))
        .map(({ row, index }) => mapRowToDraft(row, index));
      setDrafts(validDrafts);
      return validDrafts.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading sheet data.');
      return 0;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadFromSheet();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const count = await loadFromSheet();
      setSyncMessage(`Synced ${count} rows from sheet.`);
      setTimeout(() => setSyncMessage(null), 3000);
    } finally {
      setSyncing(false);
    }
  }, [loadFromSheet]);

  const filtered = useMemo(() => {
    if (filter === 'all') return drafts;
    return drafts.filter((d) => d.status === filter);
  }, [drafts, filter]);

  const updateSheetRow = useCallback(
    async (rowIndex: number, updates: Record<string, string>) => {
      if (!spreadsheetId) {
        console.error('[DraftsPage] No spreadsheetId — cannot update row');
        return;
      }
      try {
        console.log('[DraftsPage] Updating row', rowIndex, updates);
        const result = await window.electronAPI.invoke(IPC_CHANNELS.SHEETS_UPDATE_ROW, {
          spreadsheetId,
          rowIndex,
          updates,
        }) as any;
        if (!result?.success) {
          console.error('[DraftsPage] Sheet update failed:', result?.error);
        }
      } catch (err) {
        console.error('[DraftsPage] Failed to update sheet row:', err);
      }
    },
    [spreadsheetId]
  );

  const setDraftStatus = useCallback(
    async (id: number, status: DraftStatus) => {
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
      await updateSheetRow(id, { email_status: status });
    },
    [updateSheetRow]
  );

  const startEdit = useCallback((draft: LocalDraft) => {
    setEditingId(draft.id);
    setEditSubject(draft.subject);
    setEditBody(draft.body);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (editingId === null) return;
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === editingId ? { ...d, subject: editSubject, body: editBody } : d
      )
    );
    await updateSheetRow(editingId, { email_subject: editSubject, email_body: editBody });
    setEditingId(null);
  }, [editingId, editSubject, editBody, updateSheetRow]);

  const badgeClass = (status: DraftStatus) => {
    if (status === 'approved') return 'badge-approved';
    if (status === 'scheduled') return 'badge-scheduled';
    if (status === 'rejected') return 'badge-rejected';
    if (status === 'sent') return 'badge-sent';
    if (status === 'failed') return 'badge-failed';
    return 'badge-draft';
  };

  const cardClass = (status: DraftStatus) => `draft-card status-${status}`;

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  if (loading) {
    return (
      <div className="drafts-page">
        <div className="drafts-loading">Loading drafts...</div>
      </div>
    );
  }

  if (error && drafts.length === 0) {
    return (
      <div className="drafts-page">
        <div className="drafts-error">Error: {error}</div>
        <button className="btn-sync" onClick={handleSync} disabled={syncing} style={{ marginTop: '1rem' }}>
          {syncing ? 'Syncing...' : 'Retry Sync'}
        </button>
      </div>
    );
  }

  return (
    <div className="drafts-page">
      <h2>Draft Review</h2>
      <p className="subtitle">Review and edit AI-generated outreach email drafts before sending.</p>

      <div className="drafts-filter-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={filter === tab.key ? 'active' : ''}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="drafts-top-bar">
        <span className="drafts-count">
          Showing {filtered.length} of {drafts.length} drafts
        </span>
        <div className="drafts-bulk-actions">
          <button className="btn-sync" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync with Sheet'}
          </button>
          <button className="btn-schedule" onClick={() => navigate('/schedule')}>
            Schedule
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="banner banner--success" style={{ marginBottom: '1rem' }}>{syncMessage}</div>
      )}
      {error && (
        <div className="banner banner--error" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      {filtered.length === 0 ? (
        <div className="drafts-empty">No drafts to display.</div>
      ) : (
        <div className="drafts-list">
          {filtered.map((draft) => (
            <div key={draft.id} className={cardClass(draft.status)}>
              <div className="draft-card-header">
                <div className="draft-card-meta">
                  <h3>{draft.companyName}</h3>
                  <span className="contact-info">
                    {draft.contactName} &mdash; {draft.contactEmail}
                  </span>
                </div>
                <span className={`status-badge ${badgeClass(draft.status)}`}>
                  {draft.status}
                </span>
              </div>

              {editingId === draft.id ? (
                <div className="draft-edit-field">
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="Subject"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="Email body"
                  />
                  <div className="draft-edit-actions">
                    <button className="btn-save" onClick={saveEdit}>Save</button>
                    <button className="btn-cancel" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="draft-card-subject">Subject: {draft.subject}</div>
                  <div className="draft-card-body">{draft.body}</div>
                </>
              )}

              <div className="draft-card-actions">
                <button
                  className="btn-card-reject"
                  onClick={() => setDraftStatus(draft.id, 'rejected')}
                >
                  Reject
                </button>
                {editingId !== draft.id && (
                  <button onClick={() => startEdit(draft)}>Edit</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
