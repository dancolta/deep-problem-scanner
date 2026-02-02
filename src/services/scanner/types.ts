export type ScanStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'TIMEOUT';

export interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  details: string;
  score: number; // 0-100
}

export interface ScanResult {
  url: string;
  screenshot: Buffer | null;
  diagnostics: DiagnosticResult[];
  status: ScanStatus;
  error?: string;
  timestamp: Date;
  loadTimeMs?: number;
  blockedBy?: string; // 'cloudflare' | 'captcha' | 'access-denied'
}

export interface ScanOptions {
  concurrency: number; // 1-5
  timeoutMs: number; // default 30000
  viewportWidth: number; // default 1440
  viewportHeight: number; // default 900
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  concurrency: 2,
  timeoutMs: 30000,
  viewportWidth: 1440,
  viewportHeight: 900,
};
