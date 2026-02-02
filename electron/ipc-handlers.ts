import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { ServiceRegistry } from './service-registry';
import { buildPromptContext, buildDiagnosticsSummary } from '../src/services/email/prompt-template';

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
  ipcMain.handle(IPC_CHANNELS.CSV_PARSE, async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // Try to get sheets for duplicate checking
      let sheets;
      try {
        sheets = await registry.getSheets();
      } catch {
        /* Not authenticated yet, skip sheets check */
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

  // --- Scan (full pipeline) ---
  ipcMain.handle(
    IPC_CHANNELS.SCAN_START,
    async (event, { leads, spreadsheetId }: { leads: any[]; spreadsheetId?: string }) => {
      try {
        const scanner = registry.scanner;
        await scanner.initialize();

        const drive = await registry.getDrive();
        const sheets = await registry.getSheets();
        const annotation = registry.annotation;
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
            results,
          });

          try {
            // 1. Scan homepage
            const scanResult = await scanner.scanHomepage(lead.website_url);

            if (scanResult.status !== 'SUCCESS' || !scanResult.screenshot) {
              results.push({
                lead,
                scanStatus: scanResult.status,
                error: scanResult.error,
              });
              continue;
            }

            // 2. Annotate screenshot
            const slug = lead.company_name
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '-')
              .substring(0, 50);
            const annotated = await annotation.annotateScreenshot(
              scanResult.screenshot,
              scanResult.diagnostics,
              lead.website_url,
              slug
            );

            // 3. Upload to Drive
            const driveResult = await drive.uploadScreenshot(annotated.buffer, annotated.filename);

            // 4. Generate email
            const promptContext = buildPromptContext({
              companyName: lead.company_name,
              contactName: lead.contact_name,
              websiteUrl: lead.website_url,
              diagnostics: scanResult.diagnostics,
              screenshotUrl: driveResult.directLink,
              annotationLabels: [],
            });

            const email = await emailGen.generateEmail(promptContext);

            // 5. Build sheet row
            const sheetRow = {
              company_name: lead.company_name,
              website_url: lead.website_url,
              contact_name: lead.contact_name,
              contact_email: lead.contact_email,
              scan_status: scanResult.status,
              screenshot_url: driveResult.directLink,
              diagnostics_summary: buildDiagnosticsSummary(scanResult.diagnostics),
              email_subject: email.subject,
              email_body: email.body,
              email_status: 'draft' as const,
            };

            results.push({ lead, scanStatus: 'SUCCESS', sheetRow, email, driveResult });
          } catch (error) {
            console.error(`[IPC] Scan failed for ${lead.website_url}:`, error);
            results.push({ lead, scanStatus: 'FAILED', error: String(error) });
          }
        }

        // 6. Append all successful results to Sheet
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
    // Set a cancel flag - scanner will check this
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

  ipcMain.handle(
    IPC_CHANNELS.SHEETS_CHECK_DUPLICATES,
    async (_event, { spreadsheetId, urls }: { spreadsheetId: string; urls: string[] }) => {
      try {
        const sheets = await registry.getSheets();
        const duplicates = await sheets.checkDuplicates(spreadsheetId, urls);
        return { success: true, duplicates };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  // --- Drive ---
  ipcMain.handle(
    IPC_CHANNELS.DRIVE_UPLOAD,
    async (_event, { buffer, filename }: { buffer: number[]; filename: string }) => {
      try {
        const drive = await registry.getDrive();
        const result = await drive.uploadScreenshot(Buffer.from(buffer), filename);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  // --- Gmail (Phase 6 placeholders) ---
  ipcMain.handle(IPC_CHANNELS.GMAIL_CREATE_DRAFT, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });
  ipcMain.handle(IPC_CHANNELS.GMAIL_SEND, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });

  // --- Scheduler (Phase 6 placeholders) ---
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_START, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STOP, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_STATUS, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });
  ipcMain.handle(IPC_CHANNELS.SCHEDULER_PROGRESS, async () => {
    return { success: false, error: 'Not implemented yet — coming in Phase 6' };
  });
}
