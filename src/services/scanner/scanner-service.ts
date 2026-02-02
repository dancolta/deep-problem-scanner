import type { Browser, Page } from 'puppeteer';
import { ScanOptions, ScanResult, DEFAULT_SCAN_OPTIONS } from './types';
import { launchStealthBrowser, detectBotProtection } from './stealth';
import { runDiagnostics } from './diagnostics';
import { withTimeout, TimeoutError } from '../../utils/timeout';
import { createLogger } from '../../utils/logger';

const log = createLogger('Scanner');

export class ScannerService {
  private options: ScanOptions;
  private browser: Browser | null = null;

  constructor(options?: Partial<ScanOptions>) {
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
  }

  async initialize(): Promise<void> {
    if (this.browser) {
      log.warn('Browser already initialized, skipping');
      return;
    }
    log.info('Launching stealth browser...');
    this.browser = await launchStealthBrowser();
    log.info('Browser ready');
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      log.info('Closing browser...');
      await this.browser.close();
      this.browser = null;
      log.info('Browser closed');
    }
  }

  async scanHomepage(url: string): Promise<ScanResult> {
    if (!this.browser) {
      throw new Error('ScannerService not initialized. Call initialize() first.');
    }

    let page: Page | null = null;

    try {
      page = await this.browser.newPage();
      await page.setViewport({
        width: this.options.viewportWidth,
        height: this.options.viewportHeight,
      });

      log.info(`Scanning ${url}`);
      const startTime = Date.now();

      try {
        await withTimeout(
          page.goto(url, { waitUntil: 'networkidle2' }),
          this.options.timeoutMs,
          `Navigation to ${url} timed out after ${this.options.timeoutMs}ms`
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          log.warn(`Timeout scanning ${url}`);
          return {
            url,
            screenshot: null,
            diagnostics: [],
            status: 'TIMEOUT',
            error: err.message,
            timestamp: new Date(),
          };
        }
        throw err;
      }

      const loadTimeMs = Date.now() - startTime;

      // Check for bot protection
      const botCheck = await detectBotProtection(page);
      if (botCheck.blocked) {
        log.warn(`Blocked by ${botCheck.type} at ${url}`);
        let screenshot: Buffer | null = null;
        try {
          screenshot = (await page.screenshot({
            fullPage: false,
            type: 'png',
          })) as Buffer;
        } catch {
          // Ignore screenshot failure on blocked page
        }
        return {
          url,
          screenshot,
          diagnostics: [],
          status: 'BLOCKED',
          blockedBy: botCheck.type,
          timestamp: new Date(),
          loadTimeMs,
        };
      }

      // Capture screenshot
      const screenshot = (await page.screenshot({
        fullPage: false,
        type: 'png',
      })) as Buffer;

      // Run diagnostics
      const diagnostics = await runDiagnostics(page, url, loadTimeMs);

      log.info(`Scan complete for ${url} in ${loadTimeMs}ms`);

      return {
        url,
        screenshot,
        diagnostics,
        status: 'SUCCESS',
        timestamp: new Date(),
        loadTimeMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Scan failed for ${url}: ${message}`);
      return {
        url,
        screenshot: null,
        diagnostics: [],
        status: 'FAILED',
        error: message,
        timestamp: new Date(),
      };
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  async scanBatch(
    urls: string[],
    onProgress?: (completed: number, total: number, result: ScanResult) => void
  ): Promise<ScanResult[]> {
    const results: ScanResult[] = new Array(urls.length);
    let completed = 0;
    let nextIndex = 0;

    const processNext = async (): Promise<void> => {
      while (nextIndex < urls.length) {
        const index = nextIndex++;
        const result = await this.scanHomepage(urls[index]);
        results[index] = result;
        completed++;
        if (onProgress) {
          try {
            onProgress(completed, urls.length, result);
          } catch {
            // Don't let callback errors break the batch
          }
        }
      }
    };

    // Launch workers up to concurrency limit
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(this.options.concurrency, urls.length); i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);
    return results;
  }
}
