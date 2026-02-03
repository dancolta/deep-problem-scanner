import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sourceCode = readFileSync(
  join(__dirname, '../src/services/scanner/scanner-service.ts'),
  'utf-8'
);

describe('cookie banner auto-dismiss', () => {
  it('has dismissCookieBanners method', () => {
    expect(sourceCode).toContain('dismissCookieBanners');
  });

  it('is called after networkidle2 and before screenshot', () => {
    const networkIdlePos = sourceCode.indexOf('networkidle2');
    const dismissPos = sourceCode.indexOf('dismissCookieBanners(page)');
    const screenshotPos = sourceCode.indexOf('page.screenshot');
    expect(dismissPos).toBeGreaterThan(networkIdlePos);
    expect(dismissPos).toBeLessThan(screenshotPos);
  });

  it('includes OneTrust selector', () => {
    expect(sourceCode).toContain('#onetrust-accept-btn-handler');
  });

  it('includes CookieBot selector', () => {
    expect(sourceCode).toContain('CybotCookiebotDialog');
  });

  it('includes CookieConsent (cc-btn) selector', () => {
    expect(sourceCode).toContain('.cc-btn.cc-allow');
  });

  it('includes generic accept button selectors', () => {
    expect(sourceCode).toContain('button[id*="accept"]');
    expect(sourceCode).toContain('button[class*="accept"]');
  });

  it('has CSS fallback to hide banner containers', () => {
    expect(sourceCode).toContain('#onetrust-banner-sdk');
    expect(sourceCode).toContain("display = 'none'");
  });

  it('is wrapped in try/catch (best-effort)', () => {
    // The method should have a top-level try/catch that catches everything
    const methodStart = sourceCode.indexOf('private async dismissCookieBanners');
    const nextMethod = sourceCode.indexOf('async scanBatch');
    const methodBody = sourceCode.slice(methodStart, nextMethod);
    // Should have catch block with empty body (best-effort, never fails)
    expect(methodBody).toContain('catch');
  });
});
