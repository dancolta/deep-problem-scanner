import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { ScanOptions, ScanResult, DEFAULT_SCAN_OPTIONS, DiagnosticResult } from './types';
import { runDiagnostics } from './diagnostics';
import { withTimeout, TimeoutError } from '../../utils/timeout';
import { createLogger } from '../../utils/logger';

const log = createLogger('PlaywrightScanner');

export interface PageSession {
  page: Page;
  context: BrowserContext;
  url: string;
  viewportScreenshot: Buffer;
  diagnostics: DiagnosticResult[];
  loadTimeMs: number;
}

export class PlaywrightScanner {
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
    log.info('Launching Playwright browser...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
      ],
    });
    log.info('Playwright browser ready');
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      log.info('Closing Playwright browser...');
      await this.browser.close();
      this.browser = null;
      log.info('Playwright browser closed');
    }
  }

  /**
   * Open a page and capture viewport screenshot for analysis.
   * Returns the page session so sections can be captured afterwards.
   */
  async openPageForAnalysis(url: string): Promise<PageSession | null> {
    if (!this.browser) {
      throw new Error('PlaywrightScanner not initialized. Call initialize() first.');
    }

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // Create a new context with realistic browser settings
      context = await this.browser.newContext({
        viewport: {
          width: this.options.viewportWidth,
          height: this.options.viewportHeight,
        },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        deviceScaleFactor: 1,
      });

      page = await context.newPage();

      log.info(`Opening ${url} for analysis`);
      const startTime = Date.now();

      try {
        await withTimeout(
          page.goto(url, { waitUntil: 'networkidle', timeout: this.options.timeoutMs }),
          this.options.timeoutMs,
          `Navigation to ${url} timed out`
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          log.warn(`Timeout opening ${url}`);
          await context.close().catch(() => {});
          return null;
        }
        throw err;
      }

      const loadTimeMs = Date.now() - startTime;

      // Wait for page to fully render
      await page.waitForTimeout(500);

      // Dismiss cookie banners
      await this.dismissCookieBanners(page);

      // Wait a bit more for any animations to settle
      await page.waitForTimeout(300);

      // Capture viewport screenshot
      const viewportScreenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
      });

      // Run diagnostics (convert Playwright page to diagnostic-compatible format)
      const diagnostics = await this.runPlaywrightDiagnostics(page, url, loadTimeMs);

      log.info(`Page ready for ${url} in ${loadTimeMs}ms`);

      return {
        page,
        context,
        url,
        viewportScreenshot: Buffer.from(viewportScreenshot),
        diagnostics,
        loadTimeMs,
      };
    } catch (err) {
      if (context) {
        await context.close().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Capture a viewport-sized screenshot with the section visible, optionally finding a specific element
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

        // Scroll so section is visible
        const viewportSize = page.viewportSize();
        const viewportHeight = viewportSize?.height || 1080;
        const viewportWidth = viewportSize?.width || 1920;
        const scrollY = Math.max(0, bounds.y - 50);

        await page.evaluate((y) => window.scrollTo(0, y), scrollY);
        await page.waitForTimeout(300);

        // Capture viewport screenshot (proper proportions)
        const buffer = await page.screenshot({
          type: 'png',
          fullPage: false,
        });

        const imageWidth = viewportWidth;
        const imageHeight = viewportHeight;

        log.info(`Captured viewport screenshot ${imageWidth}x${imageHeight} with section "${selector}" visible`);

        // Calculate section bounds relative to viewport
        const sectionBounds = {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y - scrollY),
          width: Math.round(bounds.width),
          height: Math.round(Math.min(bounds.height, viewportHeight - (bounds.y - scrollY))),
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
                  const elYInViewport = elBounds.y - scrollY;
                  if (elYInViewport >= 0 && elYInViewport < viewportHeight) {
                    elementBounds = {
                      x: Math.round(elBounds.x),
                      y: Math.round(elYInViewport),
                      width: Math.round(elBounds.width),
                      height: Math.round(elBounds.height),
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

        return { buffer: Buffer.from(buffer), sectionBounds, elementBounds, imageWidth, imageHeight };
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
      await session.context.close();
    } catch {
      // Ignore
    }
  }

  private async dismissCookieBanners(page: Page): Promise<void> {
    try {
      // Common accept button selectors
      const acceptSelectors = [
        // Usercentrics
        '#uc-btn-accept-banner',
        '[data-testid="uc-accept-all-button"]',
        'button.uc-btn-accept',
        // CookieBot
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        // OneTrust
        '#onetrust-accept-btn-handler',
        // Generic
        '[aria-label="Accept cookies"]',
        '[aria-label="Accept all cookies"]',
        '[aria-label="Accept All"]',
        'button:has-text("Accept All")',
        'button:has-text("Accept all")',
        'button:has-text("Accept")',
        'button[id*="accept"]',
        'a[id*="accept"]',
      ];

      for (const selector of acceptSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            await btn.click();
            log.info(`Dismissed cookie banner using: ${selector}`);
            await page.waitForTimeout(500);
            return;
          }
        } catch {
          // Try next selector
        }
      }

      // Fallback: hide common banner containers
      await page.evaluate(() => {
        const hideSelectors = [
          '#onetrust-banner-sdk',
          '#CybotCookiebotDialog',
          '#usercentrics-root',
          '[class*="uc-banner"]',
          '.cc-window',
          '[class*="cookie-banner"]',
          '[class*="cookieBanner"]',
          '[class*="privacy-settings"]',
        ];
        for (const sel of hideSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) el.style.display = 'none';
        }
      });
    } catch {
      // Best-effort
    }
  }

  private async runPlaywrightDiagnostics(page: Page, url: string, loadTimeMs: number): Promise<DiagnosticResult[]> {
    const diagnostics: DiagnosticResult[] = [];

    // Load time diagnostic
    diagnostics.push({
      name: 'Page Load Time',
      status: loadTimeMs < 3000 ? 'pass' : loadTimeMs < 5000 ? 'warning' : 'fail',
      details: `${loadTimeMs}ms`,
      score: Math.max(0, 100 - Math.floor(loadTimeMs / 100)),
    });

    // Check for h1
    const h1 = await page.$('h1');
    diagnostics.push({
      name: 'H1 Present',
      status: h1 ? 'pass' : 'warning',
      details: h1 ? 'H1 tag found' : 'No H1 tag found',
      score: h1 ? 100 : 50,
    });

    // Check for CTA buttons
    const ctaSelectors = ['a[href*="contact"]', 'a[href*="demo"]', 'a[href*="signup"]', 'button.primary', '.btn-primary'];
    let ctaFound = false;
    for (const sel of ctaSelectors) {
      const cta = await page.$(sel);
      if (cta) {
        ctaFound = true;
        break;
      }
    }
    diagnostics.push({
      name: 'CTA Present',
      status: ctaFound ? 'pass' : 'warning',
      details: ctaFound ? 'CTA button found' : 'No clear CTA found',
      score: ctaFound ? 100 : 40,
    });

    return diagnostics;
  }
}
