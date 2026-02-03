import type { Page } from 'playwright';
import type { DiagnosticResult } from './types';
import { withTimeout } from '../../utils/timeout';
import { createLogger } from '../../utils/logger';

const log = createLogger('Diagnostics');

function scoreToStatus(score: number): 'pass' | 'warning' | 'fail' {
  if (score >= 75) return 'pass';
  if (score >= 50) return 'warning';
  return 'fail';
}

// ---------- 1. Page Speed ----------

export async function checkPageSpeed(
  _page: Page,
  loadTimeMs: number
): Promise<DiagnosticResult> {
  let score: number;
  if (loadTimeMs < 2000) score = 100;
  else if (loadTimeMs < 4000) score = 75;
  else if (loadTimeMs < 6000) score = 50;
  else if (loadTimeMs < 10000) score = 25;
  else score = 0;

  const seconds = (loadTimeMs / 1000).toFixed(1);
  return {
    name: 'Page Speed',
    status: scoreToStatus(score),
    details: `Page loaded in ${seconds}s`,
    score,
  };
}

// ---------- 2. Mobile Friendliness ----------

export async function checkMobileFriendliness(
  page: Page
): Promise<DiagnosticResult> {
  try {
    const checks = await page.evaluate(() => {
      const viewport = document.querySelector('meta[name="viewport"]');
      const hasViewport =
        viewport?.getAttribute('content')?.includes('width=device-width') ??
        false;

      const sheets = Array.from(document.styleSheets);
      let hasMediaQueries = false;
      try {
        for (const sheet of sheets) {
          try {
            const rules = Array.from(sheet.cssRules || []);
            if (rules.some((r) => r instanceof CSSMediaRule)) {
              hasMediaQueries = true;
              break;
            }
          } catch {
            // Cross-origin stylesheet, skip
          }
        }
      } catch {
        // Ignore
      }

      const bodyStyle = window.getComputedStyle(document.body);
      const fontSize = parseFloat(bodyStyle.fontSize);
      const readableText = fontSize >= 12;

      return { hasViewport, hasMediaQueries, readableText };
    });

    let passed = 0;
    const issues: string[] = [];

    if (checks.hasViewport) passed++;
    else issues.push('missing viewport meta tag');

    if (checks.hasMediaQueries) passed++;
    else issues.push('no responsive media queries detected');

    if (checks.readableText) passed++;
    else issues.push('body font-size below 12px');

    const score = Math.round((passed / 3) * 100);
    const details =
      issues.length === 0
        ? 'All mobile-friendliness checks passed'
        : `Issues: ${issues.join(', ')}`;

    return {
      name: 'Mobile Friendliness',
      status: scoreToStatus(score),
      details,
      score,
    };
  } catch (err) {
    log.error('Mobile friendliness check failed', err);
    return {
      name: 'Mobile Friendliness',
      status: 'fail',
      details: 'Check could not be completed',
      score: 0,
    };
  }
}

// ---------- 3. CTA Analysis ----------

const CTA_KEYWORDS = [
  'buy',
  'sign up',
  'get started',
  'contact',
  'try',
  'start',
  'subscribe',
  'download',
  'learn more',
  'request',
  'book',
  'schedule',
  'free trial',
];

export async function checkCTA(page: Page): Promise<DiagnosticResult> {
  try {
    const ctaResults = await page.evaluate((keywords: string[]) => {
      const elements = [
        ...Array.from(document.querySelectorAll('a')),
        ...Array.from(document.querySelectorAll('button')),
        ...Array.from(document.querySelectorAll('[role="button"]')),
      ];

      const found: string[] = [];

      for (const el of elements) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (!text) continue;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden';

        if (!visible) continue;

        for (const kw of keywords) {
          if (text.includes(kw)) {
            const label = text.length > 40 ? text.substring(0, 40) + '...' : text;
            found.push(label);
            break;
          }
        }
      }

      // Deduplicate
      return [...new Set(found)];
    }, CTA_KEYWORDS);

    let score: number;
    let details: string;

    if (ctaResults.length >= 2) {
      score = 100;
      details = `Found ${ctaResults.length} CTAs: ${ctaResults.slice(0, 5).join(', ')}`;
    } else if (ctaResults.length === 1) {
      score = 75;
      details = `Found 1 CTA: ${ctaResults[0]}`;
    } else {
      score = 0;
      details = 'No visible call-to-action elements found';
    }

    return { name: 'CTA Analysis', status: scoreToStatus(score), details, score };
  } catch (err) {
    log.error('CTA check failed', err);
    return { name: 'CTA Analysis', status: 'fail', details: 'Check could not be completed', score: 0 };
  }
}

// ---------- 4. SEO Basics ----------

export async function checkSEO(page: Page): Promise<DiagnosticResult> {
  try {
    const seo = await page.evaluate(() => {
      const titleEl = document.querySelector('title');
      const titleText = titleEl?.textContent?.trim() || '';

      const metaDesc = document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content')
        ?.trim() || '';

      const h1Count = document.querySelectorAll('h1').length;

      const images = Array.from(document.querySelectorAll('img')).slice(0, 20);
      const imagesWithAlt = images.filter(
        (img) => (img.getAttribute('alt') || '').trim().length > 0
      ).length;

      return {
        titleLength: titleText.length,
        hasTitle: titleText.length > 0,
        descLength: metaDesc.length,
        hasDesc: metaDesc.length > 0,
        h1Count,
        totalImages: images.length,
        imagesWithAlt,
      };
    });

    let totalWeight = 0;
    let earnedWeight = 0;
    const issues: string[] = [];

    // Title: weight 30
    totalWeight += 30;
    if (!seo.hasTitle) {
      issues.push('missing title tag');
    } else if (seo.titleLength >= 50 && seo.titleLength <= 60) {
      earnedWeight += 30;
    } else if (seo.titleLength > 0 && seo.titleLength < 80) {
      earnedWeight += 20;
      issues.push(`title length ${seo.titleLength} chars (ideal: 50-60)`);
    } else {
      earnedWeight += 10;
      issues.push(`title length ${seo.titleLength} chars (ideal: 50-60)`);
    }

    // Meta description: weight 25
    totalWeight += 25;
    if (!seo.hasDesc) {
      issues.push('missing meta description');
    } else if (seo.descLength >= 150 && seo.descLength <= 160) {
      earnedWeight += 25;
    } else if (seo.descLength > 0 && seo.descLength < 200) {
      earnedWeight += 15;
      issues.push(`meta description length ${seo.descLength} chars (ideal: 150-160)`);
    } else {
      earnedWeight += 5;
      issues.push(`meta description length ${seo.descLength} chars (ideal: 150-160)`);
    }

    // H1: weight 25
    totalWeight += 25;
    if (seo.h1Count === 1) {
      earnedWeight += 25;
    } else if (seo.h1Count === 0) {
      issues.push('no h1 tag found');
    } else {
      earnedWeight += 10;
      issues.push(`${seo.h1Count} h1 tags found (should be exactly 1)`);
    }

    // Image alt: weight 20
    totalWeight += 20;
    if (seo.totalImages === 0) {
      earnedWeight += 20; // No images to check
    } else {
      const ratio = seo.imagesWithAlt / seo.totalImages;
      earnedWeight += Math.round(ratio * 20);
      if (ratio < 1) {
        const missing = seo.totalImages - seo.imagesWithAlt;
        issues.push(`${missing}/${seo.totalImages} images missing alt text`);
      }
    }

    const score = Math.round((earnedWeight / totalWeight) * 100);
    const details =
      issues.length === 0
        ? 'All SEO basics look good'
        : `Issues: ${issues.join('; ')}`;

    return { name: 'SEO Basics', status: scoreToStatus(score), details, score };
  } catch (err) {
    log.error('SEO check failed', err);
    return { name: 'SEO Basics', status: 'fail', details: 'Check could not be completed', score: 0 };
  }
}

// ---------- 5. Broken Links ----------

export async function checkBrokenLinks(
  page: Page,
  url: string
): Promise<DiagnosticResult> {
  try {
    const links: string[] = await page.evaluate((baseUrl: string) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const urls: string[] = [];

      for (const a of anchors) {
        if (urls.length >= 20) break;
        try {
          const href = a.getAttribute('href') || '';
          if (
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            href === '#' ||
            href.startsWith('#')
          ) {
            continue;
          }
          const resolved = new URL(href, baseUrl).href;
          if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
            urls.push(resolved);
          }
        } catch {
          // Invalid URL, skip
        }
      }

      return [...new Set(urls)];
    }, url);

    if (links.length === 0) {
      return {
        name: 'Broken Links',
        status: 'pass',
        details: 'No links found to check',
        score: 100,
      };
    }

    const broken: string[] = [];

    const checkLink = async (link: string): Promise<void> => {
      try {
        const response = await withTimeout(
          fetch(link, {
            method: 'HEAD',
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 DeepProblemScanner/1.0' },
          }),
          5000
        );
        if (response.status >= 400) {
          broken.push(`${link} (${response.status})`);
        }
      } catch {
        // Timeout or network error - count as broken
        broken.push(`${link} (unreachable)`);
      }
    };

    // Check links in parallel batches of 5
    for (let i = 0; i < links.length; i += 5) {
      const batch = links.slice(i, i + 5);
      await Promise.all(batch.map(checkLink));
    }

    let score: number;
    if (broken.length === 0) score = 100;
    else if (broken.length <= 2) score = 75;
    else score = 25;

    const details =
      broken.length === 0
        ? `All ${links.length} links are reachable`
        : `${broken.length} broken link(s): ${broken.join(', ')}`;

    return {
      name: 'Broken Links',
      status: scoreToStatus(score),
      details,
      score,
    };
  } catch (err) {
    log.error('Broken links check failed', err);
    return {
      name: 'Broken Links',
      status: 'fail',
      details: 'Check could not be completed',
      score: 0,
    };
  }
}

// ---------- Run All ----------

export async function runDiagnostics(
  page: Page,
  url: string,
  loadTimeMs: number
): Promise<DiagnosticResult[]> {
  const results = await Promise.allSettled([
    checkPageSpeed(page, loadTimeMs),
    checkMobileFriendliness(page),
    checkCTA(page),
    checkSEO(page),
    checkBrokenLinks(page, url),
  ]);

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const names = [
      'Page Speed',
      'Mobile Friendliness',
      'CTA Analysis',
      'SEO Basics',
      'Broken Links',
    ];
    log.error(`Diagnostic "${names[index]}" threw unexpectedly`, result.reason);
    return {
      name: names[index],
      status: 'fail' as const,
      details: 'Diagnostic threw an unexpected error',
      score: 0,
    };
  });
}
