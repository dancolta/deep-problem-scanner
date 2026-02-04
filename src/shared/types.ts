// Scan-related types (renderer-safe versions - no Buffer)
export type ScanStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'TIMEOUT';

export type ScanPhase =
  | 'initializing'
  | 'opening_page'
  | 'ai_analysis'
  | 'capturing_screenshot'
  | 'drawing_annotations'
  | 'uploading_drive'
  | 'generating_email'
  | 'creating_draft'
  | 'completed';

export interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  details: string;
  score: number;
}

export interface ScanResult {
  url: string;
  screenshotBase64: string | null; // Base64 encoded for renderer
  diagnostics: DiagnosticResult[];
  status: ScanStatus;
  error?: string;
  timestamp: string; // ISO string for serialization
  loadTimeMs?: number;
  blockedBy?: string;
}

export interface Lead {
  company_name: string;
  website_url: string;
  contact_name: string;
  contact_email: string;
  [key: string]: string; // Additional CSV columns
}

export interface ScanProgress {
  total: number;
  completed: number;
  failed: number;
  currentUrl: string;
  results: ScanResult[];
  currentPhase?: ScanPhase;
  phaseDescription?: string;
  currentLeadIndex?: number;
}

export interface ScanCompletionSummary {
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalElapsedMs: number;
  completedAt: string;
}

export interface AppSettings {
  googleSheetUrl: string;
  concurrency: number;
  sendIntervalMinutes: number;
  timezone: string;
  geminiApiKey?: string;
  customEmailTemplate?: string;
  scheduleStartHour: number;
  scheduleEndHour: number;
  emailsPerHour: number;
  distributionPattern: 'spread' | 'burst';
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  screenshotDriveUrl: string;
  leadData: Lead;
  status: 'draft' | 'approved' | 'rejected' | 'scheduled' | 'sent' | 'failed';
}

export interface SheetRow {
  company_name: string;
  website_url: string;
  contact_name: string;
  contact_email: string;
  scan_status: ScanStatus;
  screenshot_url: string;
  diagnostics_summary: string;
  email_subject: string;
  email_body: string;
  email_status: 'draft' | 'approved' | 'rejected' | 'scheduled' | 'sent' | 'failed';
  draft_id?: string;
  scheduled_time?: string;
  sent_time?: string;
}
