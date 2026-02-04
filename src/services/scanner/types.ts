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
  /**
   * Load time in milliseconds - represents LCP (Largest Contentful Paint).
   * LCP measures when the main content becomes visible to the user.
   * Falls back to navigation time if LCP is not available.
   */
  loadTimeMs?: number;
  blockedBy?: string; // 'cloudflare' | 'captcha' | 'access-denied'
}

export interface ScanOptions {
  concurrency: number; // 1-5
  timeoutMs: number; // default 30000
  viewportWidth: number; // default 1920
  viewportHeight: number; // default 1080
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  concurrency: 2,
  timeoutMs: 30000,
  viewportWidth: 1920,
  viewportHeight: 1080,
};
