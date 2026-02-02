import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const BOT_DETECTION_KEYWORDS = [
  'cloudflare',
  'captcha',
  'access denied',
  'please verify',
  'checking your browser',
  'ddos protection',
  'ray id',
  'cf-browser-verification',
  'hcaptcha',
  'recaptcha',
];

export async function launchStealthBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  }) as unknown as Browser;
}

export async function detectBotProtection(
  page: Page
): Promise<{ blocked: boolean; type?: string }> {
  try {
    const title = await page.title();
    const bodyText = await page.evaluate(
      () => document.body?.innerText?.toLowerCase() || ''
    );
    const fullText = `${title.toLowerCase()} ${bodyText}`;

    for (const keyword of BOT_DETECTION_KEYWORDS) {
      if (fullText.includes(keyword)) {
        if (
          keyword.includes('cloudflare') ||
          keyword.includes('ray id') ||
          keyword.includes('cf-browser')
        ) {
          return { blocked: true, type: 'cloudflare' };
        }
        if (
          keyword.includes('captcha') ||
          keyword.includes('hcaptcha') ||
          keyword.includes('recaptcha')
        ) {
          return { blocked: true, type: 'captcha' };
        }
        return { blocked: true, type: 'access-denied' };
      }
    }

    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}
