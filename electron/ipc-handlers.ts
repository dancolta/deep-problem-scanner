import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { ServiceRegistry } from './service-registry';
import { buildPromptContext, buildDiagnosticsSummary } from '../src/services/email/prompt-template';
import { analyzePageSections, SectionIssue } from '../src/services/annotation/gemini-vision';
import { drawAnnotations } from '../src/services/annotation/drawing';
import { compressImage, compressForEmail } from '../src/services/annotation/compression';
import { AnnotationCoord } from '../src/services/annotation/types';
import { VerifiedIssue } from '../src/services/scanner/playwright-scanner';
import type { ScanPhase, ScanCompletionSummary, Lead, ScanSource } from '../src/shared/types';
import { SheetsLeadImporter, extractSpreadsheetId, extractGid } from '../src/services/google/sheets-lead-importer';

const PHASE_DESCRIPTIONS: Record<ScanPhase, string> = {
  initializing: 'Initializing scan...',
  opening_page: 'Opening webpage...',
  ai_analysis: 'AI analyzing for conversion issues...',
  capturing_screenshot: 'Capturing screenshot...',
  drawing_annotations: 'Drawing issue annotations...',
  uploading_drive: 'Uploading to Google Drive...',
  generating_email: 'Generating personalized email...',
  creating_draft: 'Creating Gmail draft...',
  completed: 'Scan complete',
};

// Fallback selectors for common sections
const SECTION_FALLBACKS: Record<string, string[]> = {
  hero: ['.hero', '[class*="hero"]', 'main > section:first-child', 'section:first-of-type', '.banner'],
  cta: ['[class*="cta"]', '.call-to-action', 'section:has(button.primary)'],
  trust: ['[class*="trust"]', '[class*="client"]', '[class*="partner"]', '[class*="logo-section"]'],
  testimonials: ['[class*="testimonial"]', '[class*="review"]'],
  navigation: ['nav', 'header', '[class*="nav"]'],
  pricing: ['[class*="pricing"]', '[class*="plan"]'],
  footer: ['footer', '[class*="footer"]'],
};

// Fallback element selectors based on issue keywords
const ELEMENT_FALLBACKS: Record<string, string> = {
  headline: 'h1, .hero h1, section:first-of-type h1, [class*="title"]:first-of-type, [class*="heading"]:first-of-type',
  cta: 'a[href*="start"], a[href*="demo"], a[href*="contact"], a[href*="signup"], button.primary, .btn-primary, [class*="cta"] a, [class*="cta"] button',
  button: 'button, .btn, [role="button"], a[class*="button"], a[class*="btn"]',
  trust: '[class*="logo"] img, [class*="client"] img, [class*="partner"], [class*="trust"]',
  navigation: 'nav, header nav, [class*="nav"]:not(footer *)',
  value: 'h1, h2:first-of-type, [class*="subtitle"], [class*="tagline"]',
};

function getElementFallbackSelector(issueLabel: string): string | undefined {
  const labelLower = issueLabel.toLowerCase();
  for (const [keyword, selector] of Object.entries(ELEMENT_FALLBACKS)) {
    if (labelLower.includes(keyword)) {
      return selector;
    }
  }
  return undefined;
}

/**
 * Returns a random integer between min and max (inclusive)
 */
function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Validates if a given datetime is in the future for a specific timezone.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeMinutes - Time in minutes from midnight (0-1439)
 * @param targetTimezone - IANA timezone string (e.g., 'America/New_York')
 * @returns true if the selected time is in the future for that timezone
 */
/**
 * Calculate the next available business hours time slot in a timezone.
 * Business hours: 9am-6pm. If current time is past 6pm, schedules for next day 9am.
 * @param timezone - IANA timezone string
 * @param offsetIndex - How many slots into the queue (for spacing emails)
 * @param intervalMinutes - Minutes between emails
 * @returns Timestamp in milliseconds (UTC)
 */
function getNextBusinessHoursTime(timezone: string, offsetIndex: number = 0, intervalMinutes: number = 15): number {
  const now = new Date();

  // Get current time in target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const currentHour = parseInt(getPart('hour'));
  const currentMinute = parseInt(getPart('minute'));
  const currentYear = parseInt(getPart('year'));
  const currentMonth = parseInt(getPart('month'));
  const currentDay = parseInt(getPart('day'));

  // Business hours: 9am (540 min) to 6pm (1080 min)
  const businessStartMinutes = 9 * 60;  // 9:00 AM
  const businessEndMinutes = 18 * 60;   // 6:00 PM
  const currentMinutesOfDay = currentHour * 60 + currentMinute;

  let targetDate: string;
  let targetMinutes: number;

  if (currentMinutesOfDay >= businessEndMinutes) {
    // Past 6pm - schedule for next day 9am
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowParts = formatter.formatToParts(tomorrow);
    const getPartT = (type: string) => tomorrowParts.find(p => p.type === type)?.value || '0';
    targetDate = `${getPartT('year')}-${getPartT('month')}-${getPartT('day')}`;
    targetMinutes = businessStartMinutes;
  } else if (currentMinutesOfDay < businessStartMinutes) {
    // Before 9am - schedule for 9am today
    targetDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
    targetMinutes = businessStartMinutes;
  } else {
    // Within business hours - schedule for now + small buffer
    targetDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
    targetMinutes = currentMinutesOfDay + 5; // 5 min buffer
  }

  // Add offset for queue position
  targetMinutes += offsetIndex * intervalMinutes;

  // If offset pushes past 6pm, roll to next day
  while (targetMinutes >= businessEndMinutes) {
    targetMinutes = businessStartMinutes + (targetMinutes - businessEndMinutes);
    const nextDay = new Date(`${targetDate}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    targetDate = nextDay.toISOString().split('T')[0];
  }

  // Convert target time in timezone to UTC
  const targetHour = Math.floor(targetMinutes / 60);
  const targetMinute = targetMinutes % 60;
  const dateTimeStr = `${targetDate}T${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}:00`;

  // Calculate offset between local and target timezone
  const localDate = new Date(dateTimeStr);
  const localFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });

  const refTime = new Date();
  const targetRefParts = formatter.formatToParts(refTime);
  const localRefParts = localFormatter.formatToParts(refTime);

  const getMinutes = (p: Intl.DateTimeFormatPart[]) => {
    const h = parseInt(p.find(x => x.type === 'hour')?.value || '0');
    const m = parseInt(p.find(x => x.type === 'minute')?.value || '0');
    return h * 60 + m;
  };

  const offsetMins = getMinutes(localRefParts) - getMinutes(targetRefParts);
  return localDate.getTime() + (offsetMins * 60_000);
}

function isValidFutureTimeInTimezone(dateStr: string, timeMinutes: number, targetTimezone: string): boolean {
  // Get current time in target timezone
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Format current time in target timezone for comparison
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const currentYear = parseInt(getPart('year'));
  const currentMonth = parseInt(getPart('month'));
  const currentDay = parseInt(getPart('day'));
  const currentHour = parseInt(getPart('hour'));
  const currentMinute = parseInt(getPart('minute'));
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  // Parse selected date
  const [selectedYear, selectedMonth, selectedDay] = dateStr.split('-').map(Number);

  // Compare dates first
  if (selectedYear > currentYear) return true;
  if (selectedYear < currentYear) return false;

  if (selectedMonth > currentMonth) return true;
  if (selectedMonth < currentMonth) return false;

  if (selectedDay > currentDay) return true;
  if (selectedDay < currentDay) return false;

  // Same day - compare time in minutes (allow some buffer)
  return timeMinutes > currentTotalMinutes + 2;
}

export function registerAllHandlers(): void {
  const registry = ServiceRegistry.getInstance();

  // --- Google Auth ---
  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_START, async () => {
    try {
      const tokens = await registry.googleAuth.authenticate();
      return { success: true, tokens };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_STATUS, async () => {
    try {
      const status = await registry.googleAuth.getAuthStatus();
      return { success: true, status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_REVOKE, async () => {
    try {
      await registry.googleAuth.revoke();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // --- CSV ---
  ipcMain.handle(IPC_CHANNELS.CSV_PARSE, async (_event, content: string) => {
    try {
      let sheets;
      try {
        sheets = await registry.getSheets();
      } catch {
        /* Not authenticated yet */
      }
      const pipeline = registry.getLeadPipeline(sheets);
      const result = await pipeline.processUpload(content);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CSV_VALIDATE, async (_event, content: string) => {
    try {
      const parser = registry.csvParser;
      const parseResult = parser.parse(content);
      return { success: true, result: parseResult };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // --- Settings ---
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      const content = await fs.readFile(settingsPath, 'utf-8');
      return { success: true, settings: JSON.parse(content) };
    } catch {
      return { success: true, settings: {} };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, settings: Record<string, unknown>) => {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // --- Gemini ---
  ipcMain.handle(IPC_CHANNELS.GEMINI_TEST_KEY, async (_event, apiKey: string) => {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent('Reply with only the word OK');
      const text = result.response.text();
      return { success: true, response: text.trim() };
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes('API_KEY_INVALID') || msg.includes('401')) {
        return { success: false, error: 'Invalid API key' };
      }
      return { success: false, error: msg };
    }
  });

  // --- PageSpeed ---
  ipcMain.handle(IPC_CHANNELS.PAGESPEED_TEST_KEY, async (_event, apiKey: string) => {
    try {
      // Test with a simple, fast-loading page
      const testUrl = 'https://example.com';
      const params = new URLSearchParams({
        url: testUrl,
        strategy: 'desktop',
        category: 'performance',
        key: apiKey,
      });

      const response = await fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error?.message || `API returned ${response.status}`;
        if (response.status === 400 && errorMsg.includes('API key')) {
          return { success: false, error: 'Invalid API key' };
        }
        if (response.status === 403) {
          return { success: false, error: 'API key not authorized for PageSpeed Insights API' };
        }
        return { success: false, error: errorMsg };
      }

      const data = await response.json();
      const score = data.lighthouseResult?.categories?.performance?.score;

      if (score !== undefined) {
        return { success: true, score: Math.round(score * 100) };
      }

      return { success: false, error: 'Invalid response from PageSpeed API' };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  // --- Sheets test ---
  ipcMain.handle(IPC_CHANNELS.SHEETS_TEST, async (_event, spreadsheetId: string) => {
    try {
      const sheets = await registry.getSheets();
      await sheets.ensureHeaders(spreadsheetId);
      return { success: true };
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes('404') || msg.includes('not found')) {
        return { success: false, error: 'Sheet not found. Check the URL.' };
      }
      if (msg.includes('403') || msg.includes('permission')) {
        return { success: false, error: 'No access. Make sure you own or have edit access to this sheet.' };
      }
      return { success: false, error: msg };
    }
  });

  // --- Scan (full pipeline with section-based screenshots) ---
  ipcMain.handle(
    IPC_CHANNELS.SCAN_START,
    async (event, { leads, spreadsheetId, scanSource = 'list' }: { leads: any[]; spreadsheetId?: string; scanSource?: ScanSource }) => {
      try {
        // Load settings for API keys and sender email
        let pageSpeedApiKey: string | undefined;
        let selectedSenderEmail: string | undefined;
        try {
          const settingsPath = path.join(app.getPath('userData'), 'settings.json');
          const settingsContent = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsContent);
          if (settings.geminiApiKey) {
            process.env.GEMINI_API_KEY = settings.geminiApiKey;
            console.log('[IPC] Synced GEMINI_API_KEY from settings.json');
          }
          if (settings.pageSpeedApiKey) {
            pageSpeedApiKey = settings.pageSpeedApiKey;
            console.log('[IPC] Loaded PageSpeed API key from settings.json');
          }
          if (settings.selectedSenderEmail) {
            selectedSenderEmail = settings.selectedSenderEmail;
            console.log('[IPC] Using sender email:', selectedSenderEmail);
          }
        } catch {
          // settings.json may not exist yet
        }

        const scanner = registry.scanner;
        await scanner.initialize();

        const drive = await registry.getDrive();
        const sheets = await registry.getSheets();
        const gmail = await registry.getAuthenticatedGmail();
        const emailGen = registry.emailGenerator;
        const pageSpeed = registry.getPageSpeed(pageSpeedApiKey);

        const results: any[] = [];
        const window = BrowserWindow.fromWebContents(event.sender);
        const scanStartTime = Date.now();

        // Helper to send phase progress
        const sendPhaseProgress = (phase: ScanPhase, leadIndex: number, currentUrl: string) => {
          window?.webContents.send(IPC_CHANNELS.SCAN_PROGRESS, {
            total: leads.length,
            completed: results.filter((r: any) => r.scanStatus === 'SUCCESS').length,
            failed: results.filter((r: any) => r.scanStatus === 'FAILED').length,
            currentUrl,
            currentPhase: phase,
            phaseDescription: PHASE_DESCRIPTIONS[phase],
            currentLeadIndex: leadIndex,
            results: [], // Include empty results array so frontend updates
          });
        };

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];

          // Send initial progress for this lead
          sendPhaseProgress('opening_page', i, lead.website_url);

          try {
            // Start PageSpeed fetch in parallel (runs while we open page and do AI analysis)
            console.log(`[IPC] Starting PageSpeed fetch for ${lead.website_url}`);
            const pageSpeedPromise = pageSpeed.getScores(lead.website_url, 'desktop');

            // 1. Open page and get viewport screenshot
            console.time(`[IPC] scan-${i}`);
            const session = await scanner.openPageForAnalysis(lead.website_url);
            console.timeEnd(`[IPC] scan-${i}`);

            if (!session) {
              console.error(`[IPC] SCREENSHOT FAILURE: Could not open page for ${lead.website_url} - page load timeout or navigation error`);
              results.push({ lead, scanStatus: 'FAILED', error: 'Could not open page - timeout or navigation error' });
              continue;
            }

            // 2. GEMINI AI ANALYSIS - Analyze screenshot for conversion issues
            sendPhaseProgress('ai_analysis', i, lead.website_url);
            console.time(`[IPC] gemini-${i}`);
            const geminiAnalysis = await analyzePageSections(
              session.viewportScreenshot,
              session.diagnostics,
              lead.website_url
            );
            console.timeEnd(`[IPC] gemini-${i}`);

            console.log(`[IPC] Gemini found ${geminiAnalysis.sections.length} issues:`,
              geminiAnalysis.sections.map(s => s.issue?.label));

            // 3. Convert Gemini issues to annotation format with element positions
            const viewportSize = session.page.viewportSize();
            const viewportHeight = viewportSize?.height || 1080;
            const viewportWidth = viewportSize?.width || 1920;

            const selectedIssues: VerifiedIssue[] = [];

            for (const section of geminiAnalysis.sections.slice(0, 3)) {
              if (!section.issue) continue;

              // Try to find the element using Gemini's selector
              let elementBounds = { x: viewportWidth * 0.2, y: viewportHeight * 0.3, width: 300, height: 80 };
              let yPosition = viewportHeight * 0.3;

              // Build selector list: Gemini's selector + fallbacks
              const selectors = [
                section.issue.elementSelector,
                section.sectionSelector,
                ...SECTION_FALLBACKS[section.section] || [],
                getElementFallbackSelector(section.issue.label),
              ].filter(Boolean);

              // Try each selector to find element bounds
              for (const selector of selectors) {
                try {
                  const el = await session.page.$(selector as string);
                  if (el) {
                    const bounds = await el.boundingBox();
                    if (bounds && bounds.width > 20 && bounds.height > 10) {
                      elementBounds = {
                        x: Math.round(bounds.x),
                        y: Math.round(bounds.y),
                        width: Math.round(bounds.width),
                        height: Math.round(bounds.height),
                      };
                      yPosition = bounds.y;
                      console.log(`[IPC] Found element for "${section.issue.label}" using "${selector}" at (${elementBounds.x}, ${elementBounds.y})`);
                      break;
                    }
                  }
                } catch {
                  // Try next selector
                }
              }

              selectedIssues.push({
                type: section.section as any,
                label: section.issue.label,
                description: section.issue.description || '',
                severity: section.issue.severity === 'critical' ? 'critical' : 'warning',
                conversionImpact: section.issue.conversionImpact,
                yPosition,
                elementBounds,
                verified: true,
              });
            }

            console.log(`[IPC] Converted ${selectedIssues.length} Gemini issues to annotations`);

            // Zero issues is VALID - well-optimized pages may have no issues
            if (selectedIssues.length === 0) {
              console.log(`[IPC] Zero issues found for ${lead.website_url} - page appears well-optimized`);

              // Close the page session
              await scanner.closePageSession(session);

              // Mark as success with 0 issues (valid outcome for optimized pages)
              results.push({
                lead,
                scanStatus: 'SUCCESS',
                sheetRow: {
                  company_name: lead.company_name,
                  website_url: lead.website_url,
                  contact_name: lead.contact_name,
                  contact_email: lead.contact_email,
                  scan_status: 'NO_ISSUES',
                  screenshot_url: 'No conversion issues detected',
                  diagnostics_summary: 'Page appears well-optimized - no actionable issues found',
                  email_subject: '',
                  email_body: '',
                  email_status: 'skip' as const,
                  scan_source: scanSource,
                },
                issueCount: 0,
              });
              continue;
            }

            // 4. ALWAYS capture at top of page (scroll position 0)
            // This ensures hero section with trust signals is always visible
            const bestScrollY = 0;

            console.log(`[IPC] Capturing at top of page (scroll: 0), ${selectedIssues.length} issues to annotate`);

            // 5. Capture screenshot at optimal position
            sendPhaseProgress('capturing_screenshot', i, lead.website_url);
            const screenshotBuffer = await scanner.captureAtPosition(session.page, bestScrollY);

            // 6. Build annotations - cards are placed on right side, so include ALL issues
            const annotations: AnnotationCoord[] = [];
            const annotationLabels: string[] = [];

            for (const issue of selectedIssues) {
              const bounds = issue.elementBounds;
              annotations.push({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                label: issue.label,
                severity: issue.severity,
                description: issue.description,
                conversionImpact: issue.conversionImpact,
              });
              annotationLabels.push(issue.label);
              console.log(`[IPC] Adding annotation: "${issue.label}"`);
            }

            // 7. Draw ALL annotations on the screenshot
            // CRITICAL: Never proceed with unannotated screenshots
            if (annotations.length === 0) {
              console.log(`[IPC] No annotations could be positioned for ${lead.website_url} - SKIPPING`);
              await scanner.closePageSession(session);
              results.push({
                lead,
                scanStatus: 'SUCCESS',
                sheetRow: {
                  company_name: lead.company_name,
                  website_url: lead.website_url,
                  contact_name: lead.contact_name,
                  contact_email: lead.contact_email,
                  scan_status: 'NO_ANNOTATIONS',
                  screenshot_url: 'Could not position annotations on page',
                  diagnostics_summary: `Found ${selectedIssues.length} issue(s) but could not locate elements`,
                  email_subject: '',
                  email_body: '',
                  email_status: 'skip' as const,
                },
                issueCount: 0,
              });
              continue;
            }

            console.log(`[IPC] Drawing ${annotations.length} verified annotations`);
            sendPhaseProgress('drawing_annotations', i, lead.website_url);
            const annotatedBuffer = await drawAnnotations(screenshotBuffer, annotations);
            const finalScreenshot = await compressForEmail(annotatedBuffer, 400, 1200);

            // Store as single screenshot with all annotations
            const sectionScreenshots = [{
              buffer: finalScreenshot,
              label: annotationLabels.join(' | '),
              description: '',
              impact: '',
            }];

            // Close the page session
            await scanner.closePageSession(session);

            // 4. Upload screenshots to Drive
            sendPhaseProgress('uploading_drive', i, lead.website_url);
            console.time(`[IPC] drive-${i}`);
            const slug = lead.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
            const dateStr = new Date().toISOString().split('T')[0];
            const driveResults: { directLink: string; fileId: string }[] = [];

            for (let j = 0; j < sectionScreenshots.length; j++) {
              const ss = sectionScreenshots[j];
              const filename = `${slug}_issue_${j + 1}_${dateStr}.png`;
              const driveResult = await drive.uploadScreenshot(ss.buffer, filename);
              driveResults.push({ directLink: driveResult.directLink, fileId: driveResult.fileId });
            }
            console.timeEnd(`[IPC] drive-${i}`);

            // 5. Generate email with issue details (using PageSpeed scores)
            sendPhaseProgress('generating_email', i, lead.website_url);
            console.time(`[IPC] email-${i}`);

            // Wait for PageSpeed results (started in parallel earlier)
            console.log(`[IPC] ========== PAGESPEED DEBUG ==========`);
            const pageSpeedResult = await pageSpeedPromise;
            console.log(`[IPC] PageSpeed result:`, JSON.stringify(pageSpeedResult, null, 2));
            let diagnosticsForEmail = session.diagnostics;

            if (pageSpeedResult.success && pageSpeedResult.scores) {
              // Check for 0 performance score - indicates something failed, skip this lead
              if (pageSpeedResult.scores.performance === 0) {
                console.log(`[IPC] ⚠️ SKIPPING LEAD: Performance score is 0 (likely a failed scan)`);
                await scanner.closePageSession(session);
                results.push({
                  lead,
                  scanStatus: 'SKIPPED',
                  sheetRow: {
                    company_name: lead.company_name,
                    website_url: lead.website_url,
                    contact_name: lead.contact_name,
                    contact_email: lead.contact_email,
                    scan_status: 'SKIPPED',
                    screenshot_url: '',
                    diagnostics_summary: 'PageSpeed returned 0 score - scan failed',
                    email_subject: '',
                    email_body: '',
                    email_status: 'skip' as const,
                  },
                  issueCount: 0,
                });
                continue;
              }

              // Use PageSpeed scores as diagnostics
              diagnosticsForEmail = pageSpeed.scoresToDiagnostics(pageSpeedResult.scores);
              console.log(`[IPC] ✅ USING PAGESPEED SCORES:`);
              console.log(`[IPC]   Performance: ${pageSpeedResult.scores.performance}/100`);
              console.log(`[IPC]   Accessibility: ${pageSpeedResult.scores.accessibility}/100`);
              console.log(`[IPC]   SEO: ${pageSpeedResult.scores.seo}/100`);
              console.log(`[IPC]   Best Practices: ${pageSpeedResult.scores.bestPractices}/100`);
            } else {
              console.log(`[IPC] ❌ PAGESPEED FAILED: ${pageSpeedResult.error}`);
              console.log(`[IPC] Using fallback scanner diagnostics instead`);
            }
            console.log(`[IPC] ======================================`);

            // For manual scans without contact info, use generic greeting
            const isManualScan = scanSource === 'manual' || !lead.contact_email;
            const contactNameForEmail = isManualScan ? '' : lead.contact_name;

            const promptContext = buildPromptContext({
              companyName: lead.company_name,
              contactName: contactNameForEmail,
              websiteUrl: lead.website_url,
              diagnostics: diagnosticsForEmail,
              screenshotUrl: driveResults[0]?.directLink || '',
              annotationLabels: annotationLabels,
            });

            // Load custom template from settings if available
            let customTemplate: string | undefined;
            try {
              const templateSettingsPath = path.join(app.getPath('userData'), 'settings.json');
              const templateSettingsContent = await fs.readFile(templateSettingsPath, 'utf-8');
              const templateSettings = JSON.parse(templateSettingsContent);
              customTemplate = templateSettings.customEmailTemplate;
            } catch {
              // No custom template, use default
            }

            const email = await emailGen.generateEmail(promptContext, undefined, customTemplate, i);
            console.timeEnd(`[IPC] email-${i}`);

            // 6. Build sheet row
            const sheetRow: Record<string, any> = {
              company_name: lead.company_name,
              website_url: lead.website_url,
              contact_name: lead.contact_name,
              contact_email: lead.contact_email,
              scan_status: 'SUCCESS',
              screenshot_url: driveResults.map(r => r.directLink).join(' | '),
              diagnostics_summary: buildDiagnosticsSummary(diagnosticsForEmail),
              email_subject: email.subject,
              email_body: email.body,
              email_status: 'draft' as const,
              scan_source: scanSource,
            };

            // 7. Create Gmail draft with embedded images (always, even for manual scans)
            sendPhaseProgress('creating_draft', i, lead.website_url);
            if (sectionScreenshots.length > 0) {
              const draftPayload = {
                to: lead.contact_email || '',  // Empty for manual scans - user can add recipient in Gmail
                subject: email.subject,
                body: email.body,
                screenshotDriveUrl: driveResults[0]?.directLink || '',
                leadData: lead,
                status: 'draft' as const,
                fromEmail: selectedSenderEmail,  // Use configured sender alias
              };

              // Apply "NOT FROM LIST" label for manual scans (no recipient)
              const labelForDraft = isManualScan ? 'NOT FROM LIST' : undefined;

              gmail.createDraft(draftPayload, sectionScreenshots[0].buffer, labelForDraft).then(
                (draftResult) => {
                  sheetRow.draft_id = draftResult.draftId;
                  console.log(`[IPC] Gmail draft created: ${draftResult.draftId}${labelForDraft ? ` with label "${labelForDraft}"` : ''}`);
                },
                (draftError) => {
                  console.error(`[IPC] Gmail draft failed:`, draftError);
                }
              );
            }

            results.push({
              lead,
              scanStatus: 'SUCCESS',
              sheetRow,
              email,
              driveResults,
              issueCount: sectionScreenshots.length,
            });

          } catch (error) {
            console.error(`[IPC] Scan failed for ${lead.website_url}:`, error);
            results.push({ lead, scanStatus: 'FAILED', error: String(error) });
          }
        }

        // 8. Append all successful results to Sheet
        const successRows = results.filter((r: any) => r.sheetRow).map((r: any) => r.sheetRow);

        if (successRows.length > 0 && spreadsheetId) {
          await sheets.ensureHeaders(spreadsheetId);
          await sheets.appendScanResults(spreadsheetId, successRows);
        }

        await scanner.shutdown();

        // Build completion summary
        const completionSummary: ScanCompletionSummary = {
          totalProcessed: leads.length,
          successCount: results.filter((r: any) => r.scanStatus === 'SUCCESS').length,
          failedCount: results.filter((r: any) => r.scanStatus === 'FAILED').length,
          skippedCount: results.filter((r: any) => r.sheetRow?.email_status === 'skip').length,
          totalElapsedMs: Date.now() - scanStartTime,
          completedAt: new Date().toISOString(),
        };

        // Final progress
        window?.webContents.send(IPC_CHANNELS.SCAN_COMPLETE, { results, completionSummary });

        return { success: true, results };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.SCAN_CANCEL, async () => {
    return { success: true };
  });

  // --- Sheets ---
  ipcMain.handle(IPC_CHANNELS.SHEETS_READ, async (_event, spreadsheetId: string) => {
    try {
      const sheets = await registry.getSheets();
      const rows = await sheets.readRows(spreadsheetId);
      return { success: true, rows };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHEETS_UPDATE_ROW, async (_event, arg1: any, arg2?: number, arg3?: Record<string, any>) => {
    try {
      // Support both calling conventions:
      // 1. Object: { spreadsheetId, rowIndex, updates }
      // 2. Separate args: spreadsheetId, rowIndex, updates
      let spreadsheetId: string;
      let rowIndex: number;
      let updates: Record<string, any>;

      if (typeof arg1 === 'object' && arg1.spreadsheetId !== undefined) {
        // Called with object
        spreadsheetId = arg1.spreadsheetId;
        rowIndex = arg1.rowIndex;
        updates = arg1.updates;
      } else {
        // Called with separate args
        spreadsheetId = arg1;
        rowIndex = arg2!;
        updates = arg3!;
      }

      // Validate rowIndex to prevent writing to wrong rows
      if (typeof rowIndex !== 'number' || isNaN(rowIndex) || rowIndex < 0) {
        console.error(`[IPC] Invalid rowIndex: ${rowIndex}`);
        return { success: false, error: `Invalid row index: ${rowIndex}` };
      }

      const sheets = await registry.getSheets();
      console.log(`[IPC] Updating row ${rowIndex} with:`, updates);
      await sheets.updateRowStatus(spreadsheetId, rowIndex, updates as any);
      return { success: true };
    } catch (error) {
      console.error('[IPC] SHEETS_UPDATE_ROW error:', error);
      return { success: false, error: String(error) };
    }
  });

  // --- Mark Leads as Processed (before scan starts) ---
  ipcMain.handle(IPC_CHANNELS.SHEETS_MARK_PROCESSED, async (_event, {
    spreadsheetId,
    sheetName,
    rowNumbers,
  }: {
    spreadsheetId: string;
    sheetName: string;
    rowNumbers: number[];
  }) => {
    try {
      console.log(`[IPC] SHEETS_MARK_PROCESSED - Marking ${rowNumbers.length} rows in "${sheetName}"`);
      const authClient = await registry.googleAuth.getAuthenticatedClient();
      const importer = new SheetsLeadImporter(authClient);
      const result = await importer.markRowsAsProcessed(spreadsheetId, rowNumbers, sheetName);
      return { success: result.success, markedCount: result.markedCount, errors: result.errors };
    } catch (error) {
      console.error('[IPC] SHEETS_MARK_PROCESSED error:', error);
      return { success: false, error: String(error), markedCount: 0 };
    }
  });

  // --- Google Sheets Lead Import ---
  ipcMain.handle(IPC_CHANNELS.SHEETS_IMPORT_LEADS, async (_event, url: string) => {
    try {
      // 1. Extract spreadsheet ID and gid from URL
      const spreadsheetId = extractSpreadsheetId(url);
      if (!spreadsheetId) {
        return { success: false, error: 'Please enter a valid Google Sheets URL' };
      }
      const gid = extractGid(url);

      // 2. Get authenticated client and create importer
      const authClient = await registry.googleAuth.getAuthenticatedClient();
      const importer = new SheetsLeadImporter(authClient);

      // 3. Import leads from the sheet (using specific tab if gid provided)
      const {
        leads,
        sheetName,
        sheetTabName,  // Actual tab name for marking as processed
        totalRows,
        headers,
        alreadyProcessed,
        spreadsheetId: sourceSpreadsheetId,
      } = await importer.importLeads(spreadsheetId, gid);

      // Log for debugging
      console.log('[IPC] SHEETS_IMPORT_LEADS - Spreadsheet name:', sheetName);
      console.log('[IPC] SHEETS_IMPORT_LEADS - Sheet tab name:', sheetTabName);
      console.log('[IPC] SHEETS_IMPORT_LEADS - Headers found:', headers);
      console.log('[IPC] SHEETS_IMPORT_LEADS - Leads parsed from sheet:', leads.length, 'of', totalRows);
      console.log('[IPC] SHEETS_IMPORT_LEADS - Already processed:', alreadyProcessed);

      // If no leads parsed, return early with debug info
      if (leads.length === 0) {
        return {
          success: true,
          result: {
            leads: [],
            totalParsed: totalRows,
            invalidLeads: [],
            duplicateEmails: [],
            alreadyScanned: [],
            alreadyProcessed,
            skippedByRange: 0,
          },
          sheetName,
          debug: {
            headers,
            message: `No leads matched. Expected columns: company/business, website/url, email. Found: ${headers.join(', ')}`
          }
        };
      }

      // Add source tracking to each lead (for marking as processed after scan)
      const leadsWithSource = leads.map(lead => ({
        ...lead,
        sourceSpreadsheetId,
        sourceSheetName: sheetTabName,  // Use actual tab name for API calls
      }));

      // 4. CLEANUP: Validate and remove invalid leads (FIRST step after import)
      const validator = registry.validator;
      const cleanupResult = validator.cleanLeads(leadsWithSource);
      const invalidLeads = cleanupResult.removedLeads;

      // 5. Filter duplicate emails within the imported data
      const csvParser = registry.csvParser;
      const { unique: uniqueLeads, duplicates: duplicateEmails } = csvParser.filterDuplicateEmails(cleanupResult.cleanedLeads);

      // 6. Check for already-scanned leads via the output sheet (if configured)
      let readyLeads = uniqueLeads;
      let alreadyScanned: Lead[] = [];

      try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        const settingsContent = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(settingsContent);

        if (settings.googleSheetUrl) {
          const outputSheetMatch = settings.googleSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
          const outputSpreadsheetId = outputSheetMatch ? outputSheetMatch[1] : null;

          if (outputSpreadsheetId) {
            const sheets = await registry.getSheets();
            const urls = readyLeads.map(l => l.website_url);
            const existingUrls = await sheets.checkDuplicates(outputSpreadsheetId, urls);
            const existingSet = new Set(existingUrls.map(u => u.toLowerCase().replace(/\/+$/, '')));

            alreadyScanned = readyLeads.filter(l =>
              existingSet.has(l.website_url.toLowerCase().replace(/\/+$/, ''))
            );
            readyLeads = readyLeads.filter(l =>
              !existingSet.has(l.website_url.toLowerCase().replace(/\/+$/, ''))
            );
          }
        }
      } catch {
        // Settings may not exist or output sheet not configured - proceed without duplicate check
      }

      // 7. Return PipelineResult-like structure
      return {
        success: true,
        result: {
          leads: readyLeads,
          totalParsed: totalRows,
          invalidLeads,
          duplicateEmails,
          alreadyScanned,
          alreadyProcessed,
          skippedByRange: 0,
        },
        sheetName,
      };
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[IPC] SHEETS_IMPORT_LEADS error:', msg);

      // Handle specific error types with user-friendly messages
      if (msg.includes('404') || msg.includes('not found') || msg.includes('Requested entity was not found')) {
        return { success: false, error: 'Spreadsheet not found. Check URL or if deleted.' };
      }
      if (msg.includes('403') || msg.includes('permission') || msg.includes('does not have permission')) {
        return { success: false, error: "Unable to access. Share sheet with your Google account or set to 'Anyone with link'" };
      }
      if (msg.includes('EMPTY_SHEET') || msg.includes('empty') || msg.includes('No data')) {
        return { success: false, error: 'Sheet appears empty. Add data below headers.' };
      }

      return { success: false, error: msg };
    }
  });

  // --- Gmail SendAs ---
  ipcMain.handle(IPC_CHANNELS.GMAIL_GET_SEND_AS, async () => {
    try {
      const gmail = await registry.getAuthenticatedGmail();
      const addresses = await gmail.getSendAsAddresses();
      return { success: true, addresses };
    } catch (error) {
      console.error('[IPC] GMAIL_GET_SEND_AS error:', error);
      return { success: false, error: String(error), addresses: [] };
    }
  });

  // --- Scheduler ---
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_START, async (event, config?: any) => {
    try {
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      const settingsContent = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);

      if (!settings.googleSheetUrl) {
        return { success: false, error: 'No Google Sheet URL configured' };
      }

      const match = settings.googleSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      const spreadsheetId = match ? match[1] : settings.googleSheetUrl;

      const sheets = await registry.getSheets();
      const gmail = await registry.getAuthenticatedGmail();
      const rows = await sheets.readRows(spreadsheetId);

      // Filter for draft, approved, OR scheduled emails WITH actual lead data
      // This allows restoring scheduled emails after app restart
      console.log(`[IPC] Total rows from sheet: ${rows.length}`);
      const drafts = rows.filter((r: any, idx: number) => {
        const hasValidStatus = r.email_status === 'draft' || r.email_status === 'approved' || r.email_status === 'scheduled';
        const hasCompanyName = Boolean(r.company_name?.trim());
        const hasContactEmail = Boolean(r.contact_email?.trim());
        const hasEmailContent = Boolean(r.email_subject?.trim() || r.email_body?.trim());
        const isValid = hasValidStatus && hasCompanyName && hasContactEmail && hasEmailContent;
        if (hasValidStatus && !isValid) {
          console.log(`[IPC] Row ${idx} EXCLUDED: status=${r.email_status}, company=${r.company_name}, email=${r.contact_email}`);
        }
        return isValid;
      });
      console.log(`[IPC] Valid emails after filter: ${drafts.length} (including scheduled)`);

      if (drafts.length === 0) {
        return { success: false, error: 'No draft emails to schedule' };
      }

      // Get scheduling parameters with defaults (time in minutes from midnight)
      const startDate = config?.scheduleStartDate || new Date().toISOString().split('T')[0];
      // Support both new (minutes) and old (hours) format for backwards compatibility
      const startTime = config?.scheduleStartTime ?? (config?.scheduleStartHour ? config.scheduleStartHour * 60 : null) ?? (settings as any).scheduleStartTime ?? (settings.scheduleStartHour ? settings.scheduleStartHour * 60 : 9 * 60);
      const endTime = config?.scheduleEndTime ?? (config?.scheduleEndHour ? config.scheduleEndHour * 60 : null) ?? (settings as any).scheduleEndTime ?? (settings.scheduleEndHour ? settings.scheduleEndHour * 60 : 17 * 60);
      const timezone = settings.timezone || 'America/New_York';

      // New random interval parameters (replacing emailsPerHour and distributionPattern)
      const minIntervalMinutes = config?.minIntervalMinutes ?? settings.minIntervalMinutes ?? 10;
      const maxIntervalMinutes = config?.maxIntervalMinutes ?? settings.maxIntervalMinutes ?? 20;

      // Sender alias selection
      const selectedSenderEmail = config?.selectedSenderEmail ?? settings.selectedSenderEmail;

      // Validate that start time is in the future for the lead's timezone
      const startHourForDisplay = Math.floor(startTime / 60);
      const startMinuteForDisplay = startTime % 60;
      if (!isValidFutureTimeInTimezone(startDate, startTime, timezone)) {
        return {
          success: false,
          error: `The scheduled start time (${startDate} at ${startHourForDisplay}:${String(startMinuteForDisplay).padStart(2, '0')}) is in the past for timezone ${timezone}. Please select a future date and time.`,
        };
      }

      const schedulerConfig = {
        intervalMinutes: minIntervalMinutes, // Base interval for scheduler
        timezone,
        maxRetries: 3,
        startHour: startHourForDisplay,
        endHour: Math.floor(endTime / 60),
      };

      const scheduler = registry.getScheduler(schedulerConfig);

      // Calculate start time in milliseconds, converting from lead's timezone to UTC
      const startHour = Math.floor(startTime / 60);
      const startMinute = startTime % 60;

      // Create a datetime string and convert from lead's timezone to local time
      // This ensures "8 PM Bucharest" sends at "6 PM London" if user is in London
      const dateTimeStr = `${startDate}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`;

      // Calculate timezone offset: get the same instant in both timezones and find difference
      const localDate = new Date(dateTimeStr); // Interpreted as local time
      const utcTime = localDate.getTime();

      // Get what the local time would be when it's dateTimeStr in the target timezone
      // We do this by finding the offset between local and target timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      const localFormatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });

      // Use a reference time to calculate offset between timezones
      const refTime = new Date();
      const targetParts = formatter.formatToParts(refTime);
      const localParts = localFormatter.formatToParts(refTime);

      const getMinutes = (parts: Intl.DateTimeFormatPart[]) => {
        const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
        const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
        return h * 60 + m;
      };

      const targetMinutes = getMinutes(targetParts);
      const localMinutes = getMinutes(localParts);
      const offsetMinutes = localMinutes - targetMinutes; // How many minutes ahead local is from target

      // Adjust: if target timezone is ahead, we need to send earlier in local time
      const startTimeMs = utcTime + (offsetMinutes * 60_000);

      console.log(`[IPC] Timezone conversion: ${dateTimeStr} in ${timezone} = ${new Date(startTimeMs).toISOString()} UTC (offset: ${offsetMinutes}min)`);

      // Convert drafts to EmailDraft format and schedule with random intervals
      // Handle both new drafts and previously scheduled emails (restore on app restart)
      let currentScheduledTime = startTimeMs;
      let rescheduledCount = 0;

      console.log(`[IPC] Using interval range: ${minIntervalMinutes}-${maxIntervalMinutes} minutes`);
      const emailDrafts = drafts.map((row: any, index: number) => {
        let scheduledTimeMs: number;
        let isRescheduled = false;

        // Check if this was previously scheduled
        if (row.email_status === 'scheduled' && row.scheduled_time) {
          // Try to parse the existing scheduled time
          // Format is like "2026-02-06 10:30 (London)|ISO:2026-02-06T10:30:00.000Z"
          // Extract the ISO timestamp at the end for precise parsing
          const isoMatch = row.scheduled_time.match(/\|ISO:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/);
          if (isoMatch) {
            const existingDateTime = new Date(isoMatch[1]);
            const existingTimeMs = existingDateTime.getTime();

            if (!isNaN(existingTimeMs) && existingTimeMs > Date.now()) {
              // Scheduled time is still in the future - use it
              scheduledTimeMs = existingTimeMs;
              console.log(`[IPC] Email ${index}: ${row.company_name} -> RESTORED existing schedule at ${row.scheduled_time}`);
            } else if (!isNaN(existingTimeMs)) {
              // Scheduled time has passed - reschedule for next business hours
              scheduledTimeMs = getNextBusinessHoursTime(timezone, rescheduledCount, getRandomInterval(minIntervalMinutes, maxIntervalMinutes));
              rescheduledCount++;
              isRescheduled = true;
              console.log(`[IPC] Email ${index}: ${row.company_name} -> RESCHEDULED (was ${row.scheduled_time}, now ${new Date(scheduledTimeMs).toISOString()})`);
            } else {
              // Parsing failed - treat as new
              console.log(`[IPC] Email ${index}: ${row.company_name} -> PARSE FAILED, treating as new`);
              scheduledTimeMs = currentScheduledTime;
            }
          } else {
            // Couldn't find ISO timestamp - try legacy format
            const legacyMatch = row.scheduled_time.match(/^(\d{4}-\d{2}-\d{2})[|\s](\d{2}:\d{2})/);
            if (legacyMatch) {
              const existingDateTime = new Date(`${legacyMatch[1]}T${legacyMatch[2]}:00`);
              const existingTimeMs = existingDateTime.getTime();
              if (!isNaN(existingTimeMs) && existingTimeMs > Date.now()) {
                scheduledTimeMs = existingTimeMs;
                console.log(`[IPC] Email ${index}: ${row.company_name} -> RESTORED from legacy format at ${row.scheduled_time}`);
              } else {
                scheduledTimeMs = currentScheduledTime;
              }
            } else {
              // Couldn't parse - treat as new
              scheduledTimeMs = currentScheduledTime;
            }
          }
        } else {
          // New draft (status is 'draft' or 'approved') - use normal scheduling
          // Each new email gets scheduled with a random interval from the previous one
          const randomInterval = getRandomInterval(minIntervalMinutes, maxIntervalMinutes);
          currentScheduledTime += randomInterval * 60_000;
          scheduledTimeMs = currentScheduledTime;
          console.log(`[IPC] Email ${index}: ${row.company_name} -> NEW scheduling at offset +${randomInterval}min`);
        }

        const scheduledTime = new Date(scheduledTimeMs);

        // Store scheduled time in human-readable format with timezone label
        // Format: "2026-02-06 13:00 (Los Angeles)" - readable in sheet
        // Also store ISO at end for UI parsing: "|ISO:2026-02-06T21:00:00.000Z"
        const formattedTime = scheduledTime.toLocaleString('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).replace(',', '');
        const tzShort = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
        const readableScheduledTime = `${formattedTime} (${tzShort})|ISO:${scheduledTime.toISOString()}`;

        if (row.email_status !== 'scheduled' || isRescheduled) {
          console.log(`[IPC] Email ${index}: ${row.company_name} -> scheduled at ${readableScheduledTime}`);
        }

        // Update sheet row with scheduled status (only if changed)
        const rowIndex = rows.indexOf(row);
        if (rowIndex >= 0 && (row.email_status !== 'scheduled' || isRescheduled)) {
          sheets.updateRowStatus(spreadsheetId, rowIndex, {
            email_status: 'scheduled',
            scheduled_time: readableScheduledTime,
          } as any).catch((err: any) => console.error('[IPC] Failed to update row:', err));
        }

        return {
          to: row.contact_email,
          subject: row.email_subject,
          body: row.email_body,
          screenshotDriveUrl: row.screenshot_url,
          leadData: {
            company_name: row.company_name,
            contact_name: row.contact_name,
            website_url: row.website_url,
            contact_email: row.contact_email,
          },
          status: 'scheduled' as const,
          scheduledAt: scheduledTimeMs, // Include scheduled time for each email
          fromEmail: selectedSenderEmail, // Sender alias
          existingDraftId: row.draft_id, // Use existing draft from scan
        };
      });

      if (rescheduledCount > 0) {
        console.log(`[IPC] Rescheduled ${rescheduledCount} missed emails to next business hours (9am-6pm ${timezone})`);
      }

      scheduler.addToQueue(emailDrafts as any, startTimeMs);

      console.log(`[IPC] Loaded ${emailDrafts.length} emails into scheduler queue (start: ${new Date(startTimeMs).toISOString()}, interval: ${minIntervalMinutes}-${maxIntervalMinutes} min)`);

      // Start the scheduler with send function
      const sendFn = async (draft: any) => {
        let draftId: string;

        // Use existing draft if available, otherwise create new one
        if (draft.existingDraftId) {
          draftId = draft.existingDraftId;
          console.log(`[IPC] Using existing draft ${draftId} for ${draft.to}`);
        } else {
          const result = await gmail.createDraft(draft);
          draftId = result.draftId;
          console.log(`[IPC] Created new draft ${draftId} for ${draft.to}`);
        }

        const sendResult = await gmail.sendDraft(draftId);

        // Update sheet row to 'sent'
        const rowIndex = rows.findIndex((r: any) => r.contact_email === draft.to);
        if (rowIndex >= 0) {
          await sheets.updateRowStatus(spreadsheetId, rowIndex, {
            email_status: 'sent',
            sent_time: new Date().toISOString(),
          } as any);
        }

        return { draftId, messageId: sendResult.messageId };
      };

      scheduler.start(sendFn as any);

      // Send progress events to renderer
      const window = BrowserWindow.fromWebContents(event.sender);
      scheduler.onEvent = (evt) => {
        window?.webContents.send(IPC_CHANNELS.SCHEDULER_PROGRESS, evt);
      };

      return { success: true, queueSize: emailDrafts.length };
    } catch (error) {
      console.error('[IPC] SCHEDULER_START error:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STOP, async () => {
    try {
      const scheduler = registry.getScheduler();
      scheduler.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STATUS, async () => {
    try {
      const scheduler = registry.getScheduler();
      const status = scheduler.getStatus();
      return { success: true, status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  console.log('IPC handlers registered successfully');
}
