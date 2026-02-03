import type { Page } from 'playwright';
import sharp from 'sharp';
import { SectionIssue } from './gemini-vision';
import { AnnotationCoord, AnnotationSeverity } from './types';

export interface SectionScreenshot {
  buffer: Buffer;
  width: number;
  height: number;
  issue: SectionIssue;
  elementBounds?: { x: number; y: number; width: number; height: number };
}

// Fallback selectors for common page sections
const SECTION_FALLBACKS: Record<string, string[]> = {
  hero: [
    '.hero',
    '[class*="hero"]',
    'section:first-of-type',
    'main > section:first-child',
    'main > div:first-child',
    '.banner',
    '[class*="banner"]',
    'header + section',
    'header + div',
  ],
  cta: [
    '.cta',
    '[class*="cta"]',
    '.call-to-action',
    'section:has(button)',
    'section:has(.btn)',
  ],
  trust: [
    '.trust',
    '[class*="trust"]',
    '.clients',
    '[class*="client"]',
    '.partners',
    '[class*="partner"]',
    '.logos',
    '[class*="logo-section"]',
  ],
  testimonials: [
    '.testimonials',
    '[class*="testimonial"]',
    '.reviews',
    '[class*="review"]',
    '.quotes',
  ],
  pricing: [
    '.pricing',
    '[class*="pricing"]',
    '.plans',
    '[class*="plan"]',
  ],
  navigation: [
    'nav',
    'header',
    '.navbar',
    '[class*="nav"]',
  ],
  footer: [
    'footer',
    '.footer',
    '[class*="footer"]',
  ],
};

async function findElement(page: Page, selectors: string[]): Promise<{ selector: string; bounds: any } | null> {
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        const bounds = await element.boundingBox();
        if (bounds && bounds.width > 50 && bounds.height > 50) {
          return { selector, bounds };
        }
      }
    } catch {
      // Selector didn't work, try next
    }
  }
  return null;
}

export async function captureSectionScreenshots(
  page: Page,
  sections: SectionIssue[]
): Promise<SectionScreenshot[]> {
  const results: SectionScreenshot[] = [];
  const viewportHeight = page.viewport()?.height || 900;
  const viewportWidth = page.viewport()?.width || 1440;
  const deviceScaleFactor = page.viewport()?.deviceScaleFactor || 2;

  for (const section of sections.slice(0, 2)) { // Max 2 sections
    console.log(`[section-capture] Capturing section: ${section.section}`);

    // Try to find the section element
    const selectorOptions = [
      section.sectionSelector,
      ...(SECTION_FALLBACKS[section.section] || []),
    ].filter(Boolean);

    const found = await findElement(page, selectorOptions);

    if (!found) {
      console.log(`[section-capture] Could not find section "${section.section}", using viewport fallback`);
      // Fallback: capture above-the-fold for hero, or scroll to approximate position
      const fallbackY = section.section === 'hero' ? 0 : viewportHeight * 0.5;

      await page.evaluate((y) => window.scrollTo(0, y), fallbackY);
      await new Promise(r => setTimeout(r, 300)); // Wait for scroll

      const screenshot = await page.screenshot({
        type: 'png',
        clip: {
          x: 0,
          y: 0,
          width: viewportWidth,
          height: viewportHeight,
        },
      }) as Buffer;

      results.push({
        buffer: screenshot,
        width: viewportWidth * deviceScaleFactor,
        height: viewportHeight * deviceScaleFactor,
        issue: section,
      });
      continue;
    }

    console.log(`[section-capture] Found section at ${JSON.stringify(found.bounds)}`);

    // Scroll to section
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 50)), found.bounds.y);
    await new Promise(r => setTimeout(r, 300));

    // Calculate clip region (full width, section height with padding)
    const padding = 40;
    const clipY = Math.max(0, found.bounds.y - padding);
    const clipHeight = Math.min(found.bounds.height + padding * 2, viewportHeight * 1.5);

    // Capture the section
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: clipY,
        width: viewportWidth,
        height: clipHeight,
      },
    }) as Buffer;

    // Also try to find the specific problematic element within the section
    let elementBounds;
    if (section.issue?.elementSelector) {
      const elementSelectors = section.issue.elementSelector.split(',').map(s => s.trim());
      const element = await findElement(page, elementSelectors);
      if (element) {
        // Adjust bounds relative to the section screenshot
        elementBounds = {
          x: (element.bounds.x) * deviceScaleFactor,
          y: (element.bounds.y - clipY) * deviceScaleFactor,
          width: element.bounds.width * deviceScaleFactor,
          height: element.bounds.height * deviceScaleFactor,
        };
        console.log(`[section-capture] Found element within section at ${JSON.stringify(elementBounds)}`);
      }
    }

    results.push({
      buffer: screenshot,
      width: viewportWidth * deviceScaleFactor,
      height: Math.round(clipHeight * deviceScaleFactor),
      issue: section,
      elementBounds,
    });
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));

  return results;
}

export function createAnnotationFromSection(
  sectionScreenshot: SectionScreenshot
): AnnotationCoord {
  const { issue, elementBounds, width, height } = sectionScreenshot;

  // If we found the element, use its bounds
  if (elementBounds) {
    return {
      x: Math.max(10, elementBounds.x),
      y: Math.max(10, elementBounds.y),
      width: Math.max(100, Math.min(elementBounds.width, width - 20)),
      height: Math.max(50, Math.min(elementBounds.height, height - 20)),
      label: issue.issue?.label || 'Issue Detected',
      severity: (issue.issue?.severity as AnnotationSeverity) || 'warning',
      description: issue.issue?.description || '',
      conversionImpact: issue.issue?.conversionImpact,
    };
  }

  // Fallback: place annotation in center-ish area of the screenshot
  const defaultX = Math.round(width * 0.1);
  const defaultY = Math.round(height * 0.2);
  const defaultWidth = Math.round(width * 0.4);
  const defaultHeight = Math.round(height * 0.3);

  return {
    x: defaultX,
    y: defaultY,
    width: defaultWidth,
    height: defaultHeight,
    label: issue.issue?.label || 'Issue Detected',
    severity: (issue.issue?.severity as AnnotationSeverity) || 'warning',
    description: issue.issue?.description || '',
    conversionImpact: issue.issue?.conversionImpact,
  };
}
