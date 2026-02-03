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
    async (event, { leads, spreadsheetId }: { leads: any[]; spreadsheetId?: string }) => {
      try {
        // Sync Gemini API key from settings.json → process.env
        try {
          const settingsPath = path.join(app.getPath('userData'), 'settings.json');
          const settingsContent = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsContent);
          if (settings.geminiApiKey) {
            process.env.GEMINI_API_KEY = settings.geminiApiKey;
            console.log('[IPC] Synced GEMINI_API_KEY from settings.json');
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

        const results: any[] = [];
        const window = BrowserWindow.fromWebContents(event.sender);

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];

          // Send progress
          window?.webContents.send(IPC_CHANNELS.SCAN_PROGRESS, {
            total: leads.length,
            completed: i,
            failed: results.filter((r: any) => r.scanStatus === 'FAILED').length,
            currentUrl: lead.website_url,
          });

          try {
            // 1. Open page and get viewport screenshot
            console.time(`[IPC] scan-${i}`);
            const session = await scanner.openPageForAnalysis(lead.website_url);
            console.timeEnd(`[IPC] scan-${i}`);

            if (!session) {
              console.error(`[IPC] SCREENSHOT FAILURE: Could not open page for ${lead.website_url} - page load timeout or navigation error`);
              results.push({ lead, scanStatus: 'FAILED', error: 'Could not open page - timeout or navigation error' });
              continue;
            }

            // 2. FULL PAGE SCAN - Check ALL potential issues with DOM verification
            console.time(`[IPC] fullscan-${i}`);
            const fullScan = await scanner.fullPageScan(session.page);
            console.timeEnd(`[IPC] fullscan-${i}`);

            console.log(`[IPC] Full scan found ${fullScan.issues.length} verified issues`);
            console.log(`[IPC] Verified data:`, JSON.stringify(fullScan.verifiedData, null, 2));

            // 3. Select 2-3 issues - MINIMUM 2 REQUIRED
            let selectedIssues = fullScan.issues.slice(0, 3);

            // RULE: MINIMUM 2 annotations required - if less than 2, skip this lead
            if (selectedIssues.length < 2) {
              console.log(`[IPC] Only ${selectedIssues.length} issue(s) found for ${lead.website_url} - SKIPPING (minimum 2 required)`);

              // Close the page session
              await scanner.closePageSession(session);

              // No screenshot, no email - just mark as "no issues"
              results.push({
                lead,
                scanStatus: 'SUCCESS',
                sheetRow: {
                  company_name: lead.company_name,
                  website_url: lead.website_url,
                  contact_name: lead.contact_name,
                  contact_email: lead.contact_email,
                  scan_status: 'NO_ISSUES',
                  screenshot_url: 'No critical issues found - well optimized page',
                  diagnostics_summary: `Found ${selectedIssues.length} issue(s) - minimum 2 required for outreach`,
                  email_subject: '',
                  email_body: '',
                  email_status: 'skip' as const,
                },
                issueCount: selectedIssues.length,
              });
              continue;
            }

            // 4. Find best viewport position (where most issues cluster)
            const viewportHeight = fullScan.viewportHeight;
            const issueYPositions = selectedIssues.map(issue => issue.yPosition);

            // Find scroll position that captures most issues
            let bestScrollY = 0;
            let maxIssuesInView = 0;

            for (const issue of selectedIssues) {
              // Try scrolling so this issue is in upper third of viewport
              const testScrollY = Math.max(0, issue.yPosition - viewportHeight * 0.3);

              // Count how many issues would be visible at this scroll position
              const issuesInView = selectedIssues.filter(i => {
                const relativeY = i.yPosition - testScrollY;
                return relativeY >= 0 && relativeY < viewportHeight;
              }).length;

              if (issuesInView > maxIssuesInView) {
                maxIssuesInView = issuesInView;
                bestScrollY = testScrollY;
              }
            }

            console.log(`[IPC] Best scroll position: ${bestScrollY}px (${maxIssuesInView} issues in view)`);

            // 5. Capture screenshot at optimal position
            const screenshotBuffer = await scanner.captureAtPosition(session.page, bestScrollY);

            // 6. Build annotations with positions relative to viewport
            const annotations: AnnotationCoord[] = [];
            const annotationLabels: string[] = [];

            for (const issue of selectedIssues) {
              // Calculate position relative to current viewport
              const relativeY = issue.yPosition - bestScrollY;

              // Only include if visible in viewport
              if (relativeY >= -50 && relativeY < viewportHeight + 50) {
                const bounds = issue.elementBounds;
                annotations.push({
                  x: bounds.x,
                  y: Math.max(0, bounds.y - bestScrollY), // Adjust Y for scroll
                  width: bounds.width,
                  height: bounds.height,
                  label: issue.label,
                  severity: issue.severity,
                  description: issue.description,
                  conversionImpact: issue.conversionImpact,
                });
                annotationLabels.push(issue.label);
                console.log(`[IPC] Adding annotation: "${issue.label}" at relative Y=${relativeY}`);
              }
            }

            // 7. Draw ALL annotations on the screenshot
            let finalScreenshot: Buffer;
            if (annotations.length > 0) {
              console.log(`[IPC] Drawing ${annotations.length} verified annotations`);
              const annotatedBuffer = await drawAnnotations(screenshotBuffer, annotations);
              finalScreenshot = await compressForEmail(annotatedBuffer, 400, 1200);
            } else {
              console.error(`[IPC] WARNING: No annotations visible in viewport for ${lead.website_url}`);
              finalScreenshot = await compressForEmail(screenshotBuffer, 400, 1200);
            }

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

            // 5. Generate email with issue details (using verified data)
            console.time(`[IPC] email-${i}`);
            const promptContext = buildPromptContext({
              companyName: lead.company_name,
              contactName: lead.contact_name,
              websiteUrl: lead.website_url,
              diagnostics: session.diagnostics,
              screenshotUrl: driveResults[0]?.directLink || '',
              annotationLabels: annotationLabels,
            });

            const email = await emailGen.generateEmail(promptContext);
            console.timeEnd(`[IPC] email-${i}`);

            // 6. Build sheet row
            const sheetRow: Record<string, any> = {
              company_name: lead.company_name,
              website_url: lead.website_url,
              contact_name: lead.contact_name,
              contact_email: lead.contact_email,
              scan_status: 'SUCCESS',
              screenshot_url: driveResults.map(r => r.directLink).join(' | '),
              diagnostics_summary: buildDiagnosticsSummary(session.diagnostics),
              email_subject: email.subject,
              email_body: email.body,
              email_status: 'draft' as const,
            };

            // 7. Create Gmail draft with embedded images
            if (sectionScreenshots.length > 0) {
              const draftPayload = {
                to: lead.contact_email,
                subject: email.subject,
                body: email.body,
                screenshotDriveUrl: driveResults[0]?.directLink || '',
                leadData: lead,
                status: 'draft' as const,
              };

              gmail.createDraft(draftPayload, sectionScreenshots[0].buffer).then(
                (draftResult) => {
                  sheetRow.draft_id = draftResult.draftId;
                  console.log(`[IPC] Gmail draft created: ${draftResult.draftId}`);
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

        // Final progress
        window?.webContents.send(IPC_CHANNELS.SCAN_COMPLETE, { results });

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

  ipcMain.handle(IPC_CHANNELS.SHEETS_UPDATE_ROW, async (_event, spreadsheetId: string, rowIndex: number, updates: Record<string, any>) => {
    try {
      const sheets = await registry.getSheets();
      console.log(`[IPC] Updating row ${rowIndex} with:`, updates);
      await sheets.updateRowStatus(spreadsheetId, rowIndex, updates as any);
      return { success: true };
    } catch (error) {
      console.error('[IPC] SHEETS_UPDATE_ROW error:', error);
      return { success: false, error: String(error) };
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

      // Filter for draft or approved emails
      const drafts = rows.filter((r: any) =>
        r.email_status === 'draft' || r.email_status === 'approved'
      );

      if (drafts.length === 0) {
        return { success: false, error: 'No draft emails to schedule' };
      }

      // Calculate scheduled times
      const startDate = config?.scheduleStartDate || new Date().toISOString().split('T')[0];
      const startHour = config?.scheduleStartHour ?? settings.scheduleStartHour ?? 9;
      const endHour = config?.scheduleEndHour ?? settings.scheduleEndHour ?? 17;
      const emailsPerHour = config?.emailsPerHour ?? settings.emailsPerHour ?? 4;

      const intervalMinutes = Math.max(5, Math.floor(60 / emailsPerHour));

      const schedulerConfig = {
        intervalMinutes,
        timezone: settings.timezone || 'America/New_York',
        maxRetries: 3,
        startHour,
        endHour,
        distributionPattern: config?.distributionPattern ?? settings.distributionPattern ?? 'spread',
      };

      const scheduler = registry.getScheduler(schedulerConfig);

      // Calculate start time
      const startDateTime = new Date(`${startDate}T${String(startHour).padStart(2, '0')}:00:00`);
      const startTime = startDateTime.getTime();

      // Convert drafts to EmailDraft format and schedule
      const emailDrafts = drafts.map((row: any, index: number) => {
        const scheduledTime = new Date(startTime + index * intervalMinutes * 60_000);

        // Update sheet row with scheduled status
        const rowIndex = rows.indexOf(row);
        if (rowIndex >= 0) {
          sheets.updateRowStatus(spreadsheetId, rowIndex, {
            email_status: 'scheduled',
            scheduled_time: scheduledTime.toISOString(),
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
        };
      });

      scheduler.addToQueue(emailDrafts as any, startTime);

      console.log(`[IPC] Loaded ${emailDrafts.length} emails into scheduler queue (start: ${startDateTime.toISOString()})`);

      // Start the scheduler with send function
      const sendFn = async (draft: any) => {
        const result = await gmail.createDraft(draft);
        const sendResult = await gmail.sendDraft(result.draftId);

        // Update sheet row to 'sent'
        const rowIndex = rows.findIndex((r: any) => r.contact_email === draft.to);
        if (rowIndex >= 0) {
          await sheets.updateRowStatus(spreadsheetId, rowIndex, {
            email_status: 'sent',
            sent_time: new Date().toISOString(),
          } as any);
        }

        return { draftId: result.draftId, messageId: sendResult.messageId };
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
