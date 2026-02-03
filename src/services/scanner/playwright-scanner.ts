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

// Verified issue found during full-page scan
export interface VerifiedIssue {
  type: 'cta' | 'trust' | 'hero' | 'navigation' | 'form';
  label: string;
  description: string;
  severity: 'critical' | 'warning';
  conversionImpact: string;
  yPosition: number; // Vertical position on page
  elementBounds: { x: number; y: number; width: number; height: number };
  verified: boolean; // DOM-verified, not AI guess
}

// Hero scan results (above-fold only)
export interface FullPageScanResult {
  pageHeight: number;
  viewportHeight: number;
  issues: VerifiedIssue[];
  verifiedData: {
    ctaAboveFold: boolean;
    ctaText: string | null;
    ctaIsGhost: boolean;
    h1Text: string | null;
    hasSubheadline: boolean;
    trustLogosAboveFold: boolean;
    hasVisualContent: boolean;
  };
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

  /**
   * HERO-ONLY scan: Check above-the-fold area for conversion issues
   * Simplified to focus on viewport screenshot with minimum 2 annotations
   */
  async fullPageScan(page: Page): Promise<FullPageScanResult> {
    const viewportSize = page.viewportSize();
    const viewportHeight = viewportSize?.height || 1080;
    const viewportWidth = viewportSize?.width || 1920;

    const pageHeight = viewportHeight; // Only scan viewport

    log.info(`HERO scan: ${viewportWidth}x${viewportHeight} (above-fold only)`);

    const issues: VerifiedIssue[] = [];

    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    // ============ 1. HERO / H1 CHECK ============
    const heroData = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const h1Text = h1?.textContent?.trim() || null;

      // Check for subheadline
      const subheadSelectors = ['h1 + p', 'h1 + h2', '[class*="subtitle"]', '[class*="tagline"]', '[class*="hero"] p'];
      let hasSubheadline = false;
      for (const sel of subheadSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 10) {
          hasSubheadline = true;
          break;
        }
      }

      const h1Bounds = h1?.getBoundingClientRect();
      return {
        h1Text,
        hasSubheadline,
        h1Bounds: h1Bounds ? { x: h1Bounds.x, y: h1Bounds.y + window.scrollY, width: h1Bounds.width, height: h1Bounds.height } : null,
      };
    });

    // Check for generic/meaningless headlines
    const genericHeadlines = ['welcome', 'home', 'solutions', 'services', 'about us', 'our company'];
    const h1Lower = heroData.h1Text?.toLowerCase() || '';
    const isGenericH1 = genericHeadlines.some(g => h1Lower === g || h1Lower.startsWith(g + ' '));

    if (isGenericH1 || !heroData.h1Text) {
      issues.push({
        type: 'hero',
        label: heroData.h1Text ? `Generic "${heroData.h1Text}" Headline` : 'Missing H1 Headline',
        description: 'Headline doesn\'t communicate specific value proposition',
        severity: 'critical',
        conversionImpact: 'Up to 50% bounce rate increase',
        yPosition: heroData.h1Bounds?.y || 100,
        elementBounds: heroData.h1Bounds || { x: viewportWidth * 0.1, y: 150, width: viewportWidth * 0.8, height: 80 },
        verified: true,
      });
    }

    // ============ 3. CTA CHECK ============
    const ctaData = await page.evaluate((vh) => {
      const ctaSelectors = [
        'a[href*="start"]', 'a[href*="demo"]', 'a[href*="contact"]', 'a[href*="signup"]', 'a[href*="trial"]',
        'button.primary', '.btn-primary', '[class*="cta"]', 'button[type="submit"]',
        'a.button', 'a.btn'
      ];

      let ctaAboveFold = false;
      let ctaText: string | null = null;
      let ctaIsGhost = false;
      let ctaBounds: DOMRect | null = null;

      for (const sel of ctaSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.y < vh && rect.width > 50) {
            ctaAboveFold = true;
            ctaText = el.textContent?.trim() || null;
            ctaBounds = rect;

            // Check if ghost/outline button
            const style = window.getComputedStyle(el);
            const bgColor = style.backgroundColor;
            const isTransparent = bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)';
            const hasBorder = style.borderWidth !== '0px' && style.borderStyle !== 'none';
            ctaIsGhost = isTransparent && hasBorder;

            break;
          }
        }
      }

      return {
        ctaAboveFold,
        ctaText,
        ctaIsGhost,
        ctaBounds: ctaBounds ? { x: ctaBounds.x, y: ctaBounds.y + window.scrollY, width: ctaBounds.width, height: ctaBounds.height } : null,
      };
    }, viewportHeight);

    log.info(`CTA: above fold: ${ctaData.ctaAboveFold}, text: "${ctaData.ctaText}", ghost: ${ctaData.ctaIsGhost}`);

    if (!ctaData.ctaAboveFold) {
      issues.push({
        type: 'cta',
        label: 'No CTA Button Above Fold',
        description: 'Primary call-to-action not visible without scrolling',
        severity: 'critical',
        conversionImpact: '84% less engagement',
        yPosition: viewportHeight / 2,
        elementBounds: { x: viewportWidth * 0.3, y: viewportHeight * 0.5, width: viewportWidth * 0.4, height: 60 },
        verified: true,
      });
    } else if (ctaData.ctaIsGhost) {
      issues.push({
        type: 'cta',
        label: 'Ghost CTA Blends Into Background',
        description: 'Outline/ghost button style reduces visibility',
        severity: 'warning',
        conversionImpact: '30% fewer clicks than solid buttons',
        yPosition: ctaData.ctaBounds?.y || viewportHeight / 2,
        elementBounds: ctaData.ctaBounds || { x: viewportWidth * 0.3, y: viewportHeight * 0.5, width: 200, height: 50 },
        verified: true,
      });
    } else if (ctaData.ctaText) {
      const genericCTA = ['submit', 'click', 'go', 'send', 'ok', 'continue'];
      if (genericCTA.includes(ctaData.ctaText.toLowerCase())) {
        issues.push({
          type: 'cta',
          label: `Generic "${ctaData.ctaText}" Button Text`,
          description: 'CTA text doesn\'t communicate value',
          severity: 'warning',
          conversionImpact: '30% fewer clicks than solid buttons',
          yPosition: ctaData.ctaBounds?.y || viewportHeight / 2,
          elementBounds: ctaData.ctaBounds || { x: viewportWidth * 0.3, y: viewportHeight * 0.5, width: 200, height: 50 },
          verified: true,
        });
      }
    }

    // ============ 4. TRUST SIGNALS CHECK (ABOVE FOLD ONLY) ============
    const trustData = await page.evaluate((vh) => {
      const logoSelectors = ['[class*="logo"]', '[class*="client"]', '[class*="partner"]', '[class*="trust"]', '[class*="brand"]'];
      let trustLogosAboveFold = false;
      let trustLogosY: number | null = null;

      for (const sel of logoSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          // Only count if ABOVE FOLD
          if (rect.y < vh && rect.y > 100) { // Not in header
            const imgs = el.querySelectorAll('img');
            if (imgs.length >= 2) {
              trustLogosAboveFold = true;
              trustLogosY = rect.y;
              break;
            }
          }
        }
        if (trustLogosAboveFold) break;
      }

      return { trustLogosAboveFold, trustLogosY };
    }, viewportHeight);

    log.info(`Trust above fold: ${trustData.trustLogosAboveFold}`);

    if (!trustData.trustLogosAboveFold) {
      issues.push({
        type: 'trust',
        label: 'No Trust Signals Above Fold',
        description: 'Client logos/social proof not visible without scrolling',
        severity: 'warning',
        conversionImpact: '42% conversion lift when logos added',
        yPosition: viewportHeight * 0.75,
        elementBounds: { x: viewportWidth * 0.1, y: viewportHeight * 0.75, width: viewportWidth * 0.8, height: 80 },
        verified: true,
      });
    }

    // ============ 5. SUBHEADLINE CHECK ============
    if (!heroData.hasSubheadline) {
      issues.push({
        type: 'hero',
        label: 'Missing Subheadline',
        description: 'No supporting text below main headline',
        severity: 'warning',
        conversionImpact: 'Up to 50% bounce rate increase',
        yPosition: (heroData.h1Bounds?.y || 150) + 80,
        elementBounds: {
          x: heroData.h1Bounds?.x || viewportWidth * 0.15,
          y: (heroData.h1Bounds?.y || 150) + (heroData.h1Bounds?.height || 50) + 10,
          width: heroData.h1Bounds?.width || viewportWidth * 0.7,
          height: 40
        },
        verified: true,
      });
    }

    // ============ 6. VISUAL HIERARCHY CHECK ============
    const visualData = await page.evaluate((vh) => {
      const h1 = document.querySelector('h1');
      const heroSection = document.querySelector('[class*="hero"], section:first-of-type, main > section:first-child');

      // Check if there's a clear visual focal point
      const hasHeroImage = heroSection?.querySelector('img[src]:not([src*="logo"])') !== null;
      const hasVideo = heroSection?.querySelector('video, iframe') !== null;

      // Check contrast/readability - is h1 visible against background?
      let h1Bounds = null;
      if (h1) {
        const rect = h1.getBoundingClientRect();
        h1Bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }

      return {
        hasHeroImage,
        hasVideo,
        hasVisualContent: hasHeroImage || hasVideo,
        h1Bounds,
      };
    }, viewportHeight);

    if (!visualData.hasVisualContent) {
      issues.push({
        type: 'hero',
        label: 'No Visual Content In Hero',
        description: 'Hero lacks engaging imagery or video',
        severity: 'warning',
        conversionImpact: 'Up to 50% bounce rate increase',
        yPosition: viewportHeight * 0.4,
        elementBounds: { x: viewportWidth * 0.5, y: viewportHeight * 0.3, width: viewportWidth * 0.4, height: viewportHeight * 0.4 },
        verified: true,
      });
    }

    // Sort issues by Y position
    issues.sort((a, b) => a.yPosition - b.yPosition);

    log.info(`Full scan complete: ${issues.length} verified issues found`);

    // Log all issues found
    log.info(`HERO scan complete: ${issues.length} issues found`);
    issues.forEach((issue, i) => {
      log.info(`  ${i + 1}. ${issue.label} (y=${issue.yPosition})`);
    });

    return {
      pageHeight,
      viewportHeight,
      issues,
      verifiedData: {
        ctaAboveFold: ctaData.ctaAboveFold,
        ctaText: ctaData.ctaText,
        ctaIsGhost: ctaData.ctaIsGhost,
        h1Text: heroData.h1Text,
        hasSubheadline: heroData.hasSubheadline,
        trustLogosAboveFold: trustData.trustLogosAboveFold,
        hasVisualContent: visualData.hasVisualContent,
      },
    };
  }

  /**
   * Capture screenshot at specific Y position (scrolls there first)
   */
  async captureAtPosition(page: Page, scrollY: number): Promise<Buffer> {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(300);

    const buffer = await page.screenshot({
      type: 'png',
      fullPage: false,
    });

    return Buffer.from(buffer);
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
