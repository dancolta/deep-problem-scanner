import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIpcInvoke } from '../hooks/useIpc';
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

  const { invoke: getSettings, loading: settingsLoading, error: settingsError } =
    useIpcInvoke<AppSettings>(IPC_CHANNELS.SETTINGS_GET);
  const { invoke: readSheet, loading: sheetLoading, error: sheetError } =
    useIpcInvoke<SheetRow[]>(IPC_CHANNELS.SHEETS_READ);

  const loading = settingsLoading || sheetLoading;
  const error = settingsError || sheetError;

  useEffect(() => {
    (async () => {
      const settings = await getSettings();
      if (!settings?.googleSheetUrl) return;
      const spreadsheetId = extractSpreadsheetId(settings.googleSheetUrl);
      if (!spreadsheetId) return;
      const rows = await readSheet(spreadsheetId);
      if (rows) {
        setDrafts(rows.map(mapRowToDraft));
      }
    })();
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return drafts;
    return drafts.filter((d) => d.status === filter);
  }, [drafts, filter]);

  const approveAll = useCallback(() => {
    setDrafts((prev) =>
      prev.map((d) => (d.status === 'draft' ? { ...d, status: 'approved' as DraftStatus } : d))
    );
  }, []);

  const setDraftStatus = useCallback((id: number, status: DraftStatus) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
  }, []);

  const startEdit = useCallback((draft: LocalDraft) => {
    setEditingId(draft.id);
    setEditSubject(draft.subject);
    setEditBody(draft.body);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId === null) return;
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === editingId ? { ...d, subject: editSubject, body: editBody } : d
      )
    );
    setEditingId(null);
  }, [editingId, editSubject, editBody]);

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

  if (error) {
    return (
      <div className="drafts-page">
        <div className="drafts-error">Error: {error}</div>
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
          <button className="btn-approve-all" onClick={approveAll}>
            Approve All Drafts
          </button>
          <button className="btn-schedule" onClick={() => navigate('/schedule')}>
            Schedule Approved
          </button>
        </div>
      </div>

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

              {draft.screenshotUrl && (
                <div className="draft-card-screenshot">
                  <img src={draft.screenshotUrl} alt={`${draft.companyName} screenshot`} />
                </div>
              )}

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
                  className="btn-card-approve"
                  onClick={() => setDraftStatus(draft.id, 'approved')}
                >
                  Approve
                </button>
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
