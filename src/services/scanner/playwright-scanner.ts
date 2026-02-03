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
    subheadlineText?: string;
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

    // ============ 1. HERO / H1 CHECK (ULTRA-STRICT) ============
    const heroData = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const h1Text = h1?.textContent?.trim() || null;
      const h1Bounds = h1?.getBoundingClientRect();

      // ULTRA-STRICT SUBHEADLINE CHECK
      // Look for ANY substantial text below H1 within 200px
      let hasSubheadline = false;
      let subheadlineText = '';

      if (h1) {
        const h1Bottom = h1.getBoundingClientRect().bottom;

        // Method 1: Direct sibling selectors
        const siblingSelectors = ['h1 + p', 'h1 + div', 'h1 + span', 'h1 ~ p', 'h1 + h2', 'h1 + h3'];
        for (const sel of siblingSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 15) {
            hasSubheadline = true;
            subheadlineText = el.textContent.trim().slice(0, 50);
            break;
          }
        }

        // Method 2: Check by class names
        if (!hasSubheadline) {
          const classSelectors = [
            '[class*="subtitle"]', '[class*="tagline"]', '[class*="subhead"]',
            '[class*="description"]', '[class*="hero-text"]', '[class*="lead"]',
            '[class*="intro"]', '[class*="summary"]'
          ];
          for (const sel of classSelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent && el.textContent.trim().length > 15) {
              const rect = el.getBoundingClientRect();
              // Must be below H1 or at similar level
              if (rect.top >= h1Bottom - 50) {
                hasSubheadline = true;
                subheadlineText = el.textContent.trim().slice(0, 50);
                break;
              }
            }
          }
        }

        // Method 3: Any paragraph/text BELOW H1 within hero area
        if (!hasSubheadline) {
          const heroContainer = h1.closest('[class*="hero"], section, .container, main > div:first-child, header + div, header + section');
          if (heroContainer) {
            const allText = heroContainer.querySelectorAll('p, .text, [class*="description"]');
            for (const el of allText) {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              // Must be below H1 (within 200px) and substantial
              if (rect.top >= h1Bottom - 20 && rect.top < h1Bottom + 200 && text.length > 20) {
                hasSubheadline = true;
                subheadlineText = text.slice(0, 50);
                break;
              }
            }
          }
        }

        // Method 4: Scan ALL paragraphs within viewport
        if (!hasSubheadline) {
          const viewportHeight = window.innerHeight;
          const allParagraphs = document.querySelectorAll('p');
          for (const p of allParagraphs) {
            const rect = p.getBoundingClientRect();
            const text = p.textContent?.trim() || '';
            // Substantial text in hero area (top 60% of viewport)
            if (rect.top > 50 && rect.top < viewportHeight * 0.6 && text.length > 30) {
              hasSubheadline = true;
              subheadlineText = text.slice(0, 50);
              break;
            }
          }
        }
      }

      console.log('[DOM-CHECK] Subheadline found:', hasSubheadline, subheadlineText);

      return {
        h1Text,
        hasSubheadline,
        subheadlineText,
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

    // ============ 3. CTA CHECK (ULTRA-STRICT) ============
    const ctaData = await page.evaluate((vh) => {
      const ctaSelectors = [
        'a[href*="start"]', 'a[href*="demo"]', 'a[href*="contact"]', 'a[href*="signup"]', 'a[href*="trial"]',
        'a[href*="get-started"]', 'a[href*="book"]', 'a[href*="schedule"]', 'a[href*="request"]',
        'button.primary', '.btn-primary', '[class*="cta"]', 'button[type="submit"]',
        'a.button', 'a.btn', '[class*="primary-button"]', '[class*="primaryButton"]'
      ];

      let ctaAboveFold = false;
      let ctaText: string | null = null;
      let ctaIsGhost = false;
      let ctaBounds: DOMRect | null = null;
      let debugInfo = '';

      for (const sel of ctaSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.y < vh && rect.y > 0 && rect.width > 50 && rect.height > 20) {
            ctaAboveFold = true;
            ctaText = el.textContent?.trim() || null;
            ctaBounds = rect;

            // ULTRA-STRICT ghost button check
            const style = window.getComputedStyle(el);
            const bgColor = style.backgroundColor;

            // Parse RGB values to check if truly transparent
            let isTransparent = false;
            if (bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
              isTransparent = true;
            } else if (bgColor.startsWith('rgba')) {
              // Check alpha value for rgba colors
              const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
              if (match && match[4] !== undefined) {
                const alpha = parseFloat(match[4]);
                isTransparent = alpha < 0.1; // Less than 10% opacity = transparent
              }
            }

            // Additional check: does it LOOK like a ghost button?
            // Ghost buttons: transparent bg + visible border + usually smaller
            const hasBorder = parseInt(style.borderWidth) >= 1 && style.borderStyle !== 'none';
            const borderColor = style.borderColor;

            // Only flag as ghost if TRULY transparent AND has visible border
            ctaIsGhost = isTransparent && hasBorder;

            debugInfo = `CTA: "${ctaText}" bg=${bgColor} transparent=${isTransparent} border=${style.borderWidth} ghost=${ctaIsGhost}`;
            console.log('[DOM-CHECK]', debugInfo);

            break;
          }
        }
      }

      return {
        ctaAboveFold,
        ctaText,
        ctaIsGhost,
        ctaBounds: ctaBounds ? { x: ctaBounds.x, y: ctaBounds.y + window.scrollY, width: ctaBounds.width, height: ctaBounds.height } : null,
        debugInfo,
      };
    }, viewportHeight);

    log.info(`[VERIFY] H1: "${heroData.h1Text?.slice(0, 40)}...", Subheadline: ${heroData.hasSubheadline ? `YES "${heroData.subheadlineText}"` : 'NO'}`);
    log.info(`[VERIFY] CTA: above fold=${ctaData.ctaAboveFold}, text="${ctaData.ctaText}", ghost=${ctaData.ctaIsGhost}`);
    if (ctaData.debugInfo) log.info(`[VERIFY] ${ctaData.debugInfo}`);

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

    // ============ 4. TRUST SIGNALS CHECK (ULTRA-STRICT) ============
    const trustData = await page.evaluate((vh) => {
      let trustLogosAboveFold = false;
      let trustLogosY: number | null = null;
      let debugInfo = '';

      // Method 1: Look for logo containers by class names
      const containerSelectors = [
        '[class*="logo"]', '[class*="client"]', '[class*="partner"]',
        '[class*="trust"]', '[class*="brand"]', '[class*="company"]',
        '[class*="customer"]', '[class*="used-by"]', '[class*="featured"]'
      ];

      for (const sel of containerSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          // Must be in visible viewport, not header
          if (rect.y < vh && rect.y > 80 && rect.height > 30) {
            // Count visual elements inside (imgs, svgs, or substantial text)
            const imgs = el.querySelectorAll('img');
            const svgs = el.querySelectorAll('svg');
            const textEls = el.querySelectorAll('span, p, div');

            // Count distinct "logo-like" items
            let logoCount = imgs.length + svgs.length;

            // Also count text-based logos (company names displayed as text)
            for (const textEl of textEls) {
              const text = textEl.textContent?.trim() || '';
              const style = window.getComputedStyle(textEl);
              // Text logos are often: short text, bold/special font, no child elements
              if (text.length > 2 && text.length < 30 && textEl.children.length === 0) {
                const fontWeight = parseInt(style.fontWeight);
                if (fontWeight >= 500 || style.fontFamily.includes('bold')) {
                  logoCount++;
                }
              }
            }

            if (logoCount >= 2) {
              trustLogosAboveFold = true;
              trustLogosY = rect.y;
              debugInfo = `Trust found via "${sel}": ${imgs.length} imgs, ${svgs.length} svgs, ${logoCount} total`;
              console.log('[DOM-CHECK]', debugInfo);
              break;
            }
          }
        }
        if (trustLogosAboveFold) break;
      }

      // Method 2: Look for grid/flex containers with multiple images/SVGs
      if (!trustLogosAboveFold) {
        const allSections = document.querySelectorAll('section, div.container, div[class*="section"], main > div');
        for (const section of allSections) {
          const rect = section.getBoundingClientRect();
          // Must be in visible viewport
          if (rect.y < vh && rect.y > 80) {
            const imgs = section.querySelectorAll('img');
            const svgs = section.querySelectorAll('svg');

            // Look for logo-sized images (small height, varied width)
            let logoImages = 0;
            for (const img of imgs) {
              const imgRect = img.getBoundingClientRect();
              // Logo images are typically: height 20-100px, width 50-300px
              if (imgRect.height > 15 && imgRect.height < 120 && imgRect.width > 40 && imgRect.width < 350) {
                logoImages++;
              }
            }

            // Similar for SVGs
            for (const svg of svgs) {
              const svgRect = svg.getBoundingClientRect();
              if (svgRect.height > 15 && svgRect.height < 120 && svgRect.width > 40 && svgRect.width < 350) {
                logoImages++;
              }
            }

            if (logoImages >= 3) {
              trustLogosAboveFold = true;
              trustLogosY = rect.y;
              debugInfo = `Trust found in section: ${logoImages} logo-sized images/svgs`;
              console.log('[DOM-CHECK]', debugInfo);
              break;
            }
          }
        }
      }

      // Method 3: Check for company name text patterns
      if (!trustLogosAboveFold) {
        // Common trust indicator texts
        const trustTexts = ['trusted by', 'used by', 'featured in', 'as seen', 'our clients', 'our customers', 'partners'];
        const allText = document.body.innerText.toLowerCase();
        for (const trust of trustTexts) {
          if (allText.includes(trust)) {
            // Find the element containing this text
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (node.textContent?.toLowerCase().includes(trust)) {
                const parent = node.parentElement;
                if (parent) {
                  const rect = parent.getBoundingClientRect();
                  if (rect.y < vh && rect.y > 80) {
                    // Check siblings/parent for actual logos
                    const container = parent.closest('section, div') || parent.parentElement;
                    if (container) {
                      const imgs = container.querySelectorAll('img, svg');
                      if (imgs.length >= 2) {
                        trustLogosAboveFold = true;
                        trustLogosY = rect.y;
                        debugInfo = `Trust found via text "${trust}" + ${imgs.length} images`;
                        console.log('[DOM-CHECK]', debugInfo);
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (trustLogosAboveFold) break;
          }
        }
      }

      console.log('[DOM-CHECK] Final trust result:', trustLogosAboveFold, debugInfo);

      return { trustLogosAboveFold, trustLogosY, debugInfo };
    }, viewportHeight);

    log.info(`[VERIFY] Trust above fold: ${trustData.trustLogosAboveFold}${trustData.debugInfo ? ` (${trustData.debugInfo})` : ''}`);

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

    // Log verification summary
    log.info(`[VERIFY SUMMARY] Subheadline=${heroData.hasSubheadline}, CTA=${ctaData.ctaAboveFold}(ghost=${ctaData.ctaIsGhost}), Trust=${trustData.trustLogosAboveFold}, Visual=${visualData.hasVisualContent}`);

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
        subheadlineText: heroData.subheadlineText,
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
