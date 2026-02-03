import type { Browser, Page } from 'puppeteer';
import { ScanOptions, ScanResult, DEFAULT_SCAN_OPTIONS, DiagnosticResult } from './types';
import { launchStealthBrowser, detectBotProtection } from './stealth';
import { runDiagnostics } from './diagnostics';
import { withTimeout, TimeoutError } from '../../utils/timeout';
import { createLogger } from '../../utils/logger';

const log = createLogger('Scanner');

export interface PageSession {
  page: Page;
  url: string;
  viewportScreenshot: Buffer;
  diagnostics: DiagnosticResult[];
  loadTimeMs: number;
}

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

  /**
   * Open a page and capture viewport screenshot for analysis.
   * Returns the page session so sections can be captured afterwards.
   */
  async openPageForAnalysis(url: string): Promise<PageSession | null> {
    if (!this.browser) {
      throw new Error('ScannerService not initialized. Call initialize() first.');
    }

    let page: Page | null = null;

    try {
      page = await this.browser.newPage();
      await page.setViewport({
        width: this.options.viewportWidth,
        height: this.options.viewportHeight,
        deviceScaleFactor: 1,
      });

      log.info(`Opening ${url} for analysis`);
      const startTime = Date.now();

      try {
        await withTimeout(
          page.goto(url, { waitUntil: 'networkidle2' }),
          this.options.timeoutMs,
          `Navigation to ${url} timed out`
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          log.warn(`Timeout opening ${url}`);
          await page.close().catch(() => {});
          return null;
        }
        throw err;
      }

      const loadTimeMs = Date.now() - startTime;

      // Dismiss cookie banners
      await this.dismissCookieBanners(page);

      // Check for bot protection
      const botCheck = await detectBotProtection(page);
      if (botCheck.blocked) {
        log.warn(`Blocked by ${botCheck.type} at ${url}`);
        await page.close().catch(() => {});
        return null;
      }

      // Capture viewport screenshot (not full page) for Gemini analysis
      const viewportScreenshot = (await page.screenshot({
        fullPage: false, // Just the viewport for analysis
        type: 'png',
      })) as Buffer;

      // Run diagnostics
      const diagnostics = await runDiagnostics(page, url, loadTimeMs);

      log.info(`Page ready for ${url} in ${loadTimeMs}ms`);

      return { page, url, viewportScreenshot, diagnostics, loadTimeMs };
    } catch (err) {
      if (page) {
        await page.close().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Capture a viewport-sized screenshot with the section visible, optionally finding a specific element
   * Returns a properly proportioned screenshot (viewport aspect ratio)
   */
  async captureSectionScreenshot(
    page: Page,
    sectionSelector: string,
    fallbackSelectors: string[] = [],
    elementSelector?: string
  ): Promise<{
    buffer: Buffer;
    sectionBounds: { x: number; y: number; width: number; height: number };
    elementBounds?: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
  } | null> {
    const allSelectors = [sectionSelector, ...fallbackSelectors].filter(Boolean);

    for (const selector of allSelectors) {
      try {
        const element = await page.$(selector);
        if (!element) continue;

        const bounds = await element.boundingBox();
        if (!bounds || bounds.width < 50 || bounds.height < 50) continue;

        // Scroll so section is visible (centered if possible)
        const viewport = page.viewport();
        const viewportHeight = viewport?.height || 1080;
        const viewportWidth = viewport?.width || 1920;
        const scrollY = Math.max(0, bounds.y - 50); // Small offset from top

        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await new Promise(r => setTimeout(r, 300));

        // Capture viewport screenshot (NOT clipped to section - full viewport proportions)
        // This maintains proper aspect ratio (e.g., 1920x1080 = 16:9)
        const buffer = (await page.screenshot({
          type: 'png',
          fullPage: false, // Viewport only - proper proportions
        })) as Buffer;

        // Get actual image dimensions (affected by deviceScaleFactor)
        const scaleFactor = viewport?.deviceScaleFactor || 2;
        const imageWidth = viewportWidth * scaleFactor;
        const imageHeight = viewportHeight * scaleFactor;

        log.info(`Captured viewport screenshot ${imageWidth}x${imageHeight} with section "${selector}" visible`);

        // Calculate section bounds relative to viewport (accounting for scroll)
        const sectionBounds = {
          x: Math.round(bounds.x * scaleFactor),
          y: Math.round((bounds.y - scrollY) * scaleFactor),
          width: Math.round(bounds.width * scaleFactor),
          height: Math.round(Math.min(bounds.height, viewportHeight - (bounds.y - scrollY)) * scaleFactor),
        };

        // Try to find specific element within section if selector provided
        let elementBounds: { x: number; y: number; width: number; height: number } | undefined;
        if (elementSelector) {
          const elementSelectors = elementSelector.split(',').map(s => s.trim());
          for (const elSelector of elementSelectors) {
            try {
              const el = await page.$(elSelector);
              if (el) {
                const elBounds = await el.boundingBox();
                if (elBounds && elBounds.width > 20 && elBounds.height > 10) {
                  // Check if element is visible in viewport
                  const elYInViewport = elBounds.y - scrollY;
                  if (elYInViewport >= 0 && elYInViewport < viewportHeight) {
                    elementBounds = {
                      x: Math.round(elBounds.x * scaleFactor),
                      y: Math.round(elYInViewport * scaleFactor),
                      width: Math.round(elBounds.width * scaleFactor),
                      height: Math.round(elBounds.height * scaleFactor),
                    };
                    log.info(`Found element "${elSelector}" at (${elementBounds.x}, ${elementBounds.y}) ${elementBounds.width}x${elementBounds.height}`);
                    break;
                  }
                }
              }
            } catch {
              // Try next element selector
            }
          }
        }

        return { buffer, sectionBounds, elementBounds, imageWidth, imageHeight };
      } catch {
        // Try next selector
      }
    }

    return null;
  }

  /**
   * Close a page session
   */
  async closePageSession(session: PageSession): Promise<void> {
    try {
      await session.page.close();
    } catch {
      // Ignore
    }
  }

  // Legacy method for backward compatibility
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
        deviceScaleFactor: 1,
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

      // Dismiss cookie banners (best-effort)
      await this.dismissCookieBanners(page);

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

      // Capture viewport screenshot (not full page)
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

  private async dismissCookieBanners(page: Page): Promise<void> {
    try {
      // Wait a moment for cookie banners to appear
      await new Promise(r => setTimeout(r, 1000));

      // Common accept button selectors (OneTrust, CookieBot, Usercentrics, CookieConsent, generic)
      const acceptSelectors = [
        // Usercentrics
        '#uc-btn-accept-banner',
        '[data-testid="uc-accept-all-button"]',
        'button[class*="uc-btn"][class*="accept"]',
        // CookieBot
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        'a#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        // OneTrust
        '#onetrust-accept-btn-handler',
        '.onetrust-close-btn-handler',
        // Generic patterns
        '[data-cookiefirst-action="accept"]',
        '.cc-btn.cc-allow',
        '.cc-accept',
        '.cookie-consent-accept',
        '[aria-label="Accept cookies"]',
        '[aria-label="Accept all cookies"]',
        '[aria-label="Accept All"]',
        'button[id*="accept"]',
        'button[class*="accept"]',
        'a[id*="accept"]',
        // Text-based (last resort)
        'button:has-text("Accept All")',
        'button:has-text("Accept")',
      ];

      for (const selector of acceptSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            log.info(`Dismissed cookie banner using: ${selector}`);
            await new Promise(r => setTimeout(r, 800));
            return;
          }
        } catch {
          // Selector didn't work, try next
        }
      }

      // Fallback: hide common banner containers via CSS injection
      await page.evaluate(() => {
        const hideSelectors = [
          '#onetrust-banner-sdk',
          '#CybotCookiebotDialog',
          '#usercentrics-root',
          '[class*="uc-banner"]',
          '.cc-window',
          '.cookie-consent',
          '[class*="cookie-banner"]',
          '[class*="cookieBanner"]',
          '[id*="cookie-banner"]',
          '[id*="cookieBanner"]',
          '[class*="privacy-settings"]',
          '[id*="privacy"]',
        ];
        for (const sel of hideSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) {
            el.style.display = 'none';
            console.log(`[Scanner] Hidden cookie banner: ${sel}`);
          }
        }
      });

      // Wait for layout to settle after hiding
      await new Promise(r => setTimeout(r, 300));
    } catch {
      // Best-effort — never fails the scan
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
