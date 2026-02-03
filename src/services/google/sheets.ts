import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { SheetRow, ScanStatus } from '../../shared/types';

const SHEET_HEADERS = [
  'Company', 'Website URL', 'Contact Name', 'Contact Email',
  'Scan Status', 'Screenshot URL', 'Diagnostics', 'Email Subject',
  'Email Body', 'Email Status', 'Draft ID', 'Scheduled Time', 'Sent Time',
];

const COLUMN_MAP: Record<keyof SheetRow, string> = {
  company_name: 'A',
  website_url: 'B',
  contact_name: 'C',
  contact_email: 'D',
  scan_status: 'E',
  screenshot_url: 'F',
  diagnostics_summary: 'G',
  email_subject: 'H',
  email_body: 'I',
  email_status: 'J',
  draft_id: 'K',
  scheduled_time: 'L',
  sent_time: 'M',
};

const DATA_START_ROW = 2;
// Sheet name cache per spreadsheet
const sheetNameCache: Record<string, string> = {};

function rowToArray(row: SheetRow): string[] {
  return [
    row.company_name,
    row.website_url,
    row.contact_name,
    row.contact_email,
    row.scan_status,
    row.screenshot_url,
    row.diagnostics_summary,
    row.email_subject,
    row.email_body,
    row.email_status,
    row.draft_id || '',
    row.scheduled_time || '',
    row.sent_time || '',
  ];
}

function arrayToRow(arr: string[]): SheetRow {
  return {
    company_name: arr[0] || '',
    website_url: arr[1] || '',
    contact_name: arr[2] || '',
    contact_email: arr[3] || '',
    scan_status: (arr[4] as ScanStatus) || 'FAILED',
    screenshot_url: arr[5] || '',
    diagnostics_summary: arr[6] || '',
    email_subject: arr[7] || '',
    email_body: arr[8] || '',
    email_status: (arr[9] as SheetRow['email_status']) || 'draft',
    draft_id: arr[10] || undefined,
    scheduled_time: arr[11] || undefined,
    sent_time: arr[12] || undefined,
  };
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().trim().replace(/\/+$/, '');
}

export class SheetsService {
  private sheets: sheets_v4.Sheets;

  constructor(private authClient: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
  }

  private async getSheetName(spreadsheetId: string): Promise<string> {
    if (sheetNameCache[spreadsheetId]) return sheetNameCache[spreadsheetId];
    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    const name = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
    sheetNameCache[spreadsheetId] = name;
    return name;
  }

  async ensureHeaders(spreadsheetId: string): Promise<void> {
    try {
      const sheetName = await this.getSheetName(spreadsheetId);
      const lastCol = String.fromCharCode(64 + SHEET_HEADERS.length); // A=65, so 13 → 'M'
      const headerRange = `'${sheetName}'!A1:${lastCol}1`;
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: headerRange,
      });

      const existing = res.data.values?.[0];
      const headersMatch =
        existing &&
        existing.length === SHEET_HEADERS.length &&
        existing.every((val, i) => val === SHEET_HEADERS[i]);

      if (!headersMatch) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId,
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: { values: [SHEET_HEADERS] },
        });
      }
    } catch (error) {
      console.error('[SheetsService] Failed to ensure headers:', error);
      throw error;
    }
  }

  async appendScanResults(spreadsheetId: string, rows: SheetRow[]): Promise<void> {
    if (rows.length === 0) return;

    try {
      const sheetName = await this.getSheetName(spreadsheetId);
      const rowArrays = rows.map(rowToArray);
      await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A:M`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rowArrays },
      });
    } catch (error) {
      console.error('[SheetsService] Failed to append scan results:', error);
      throw error;
    }
  }

  async readRows(spreadsheetId: string): Promise<SheetRow[]> {
    try {
      const sheetName = await this.getSheetName(spreadsheetId);
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A${DATA_START_ROW}:L`,
      });

      const values = res.data.values;
      if (!values || values.length === 0) {
        return [];
      }

      return values.map((arr) => arrayToRow(arr));
    } catch (error) {
      console.error('[SheetsService] Failed to read rows:', error);
      throw error;
    }
  }

  async checkDuplicates(spreadsheetId: string, websiteUrls: string[]): Promise<string[]> {
    try {
      const sheetName = await this.getSheetName(spreadsheetId);
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!B${DATA_START_ROW}:B`,
      });

      const existingRaw = res.data.values;
      if (!existingRaw || existingRaw.length === 0) {
        return [];
      }

      const existingNormalized = new Set(
        existingRaw.map((row) => normalizeUrl(row[0] || ''))
      );

      return websiteUrls.filter((url) => existingNormalized.has(normalizeUrl(url)));
    } catch (error) {
      console.error('[SheetsService] Failed to check duplicates:', error);
      throw error;
    }
  }

  async updateRowStatus(
    spreadsheetId: string,
    rowIndex: number,
    updates: Partial<SheetRow>
  ): Promise<void> {
    const sheetRow = rowIndex + DATA_START_ROW;

    try {
      const sheetName = await this.getSheetName(spreadsheetId);
      const updatePromises = Object.entries(updates).map(([field, value]) => {
        const column = COLUMN_MAP[field as keyof SheetRow];
        if (!column) {
          console.error(`[SheetsService] Unknown field: ${field}`);
          return Promise.resolve();
        }

        return this.sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetName}'!${column}${sheetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[value ?? '']] },
        });
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error('[SheetsService] Failed to update row status:', error);
      throw error;
    }
  }

  async getApprovedRows(
    spreadsheetId: string
  ): Promise<{ row: SheetRow; rowIndex: number }[]> {
    try {
      const rows = await this.readRows(spreadsheetId);
      return rows
        .map((row, index) => ({ row, rowIndex: index }))
        .filter(({ row }) => row.email_status === 'draft');
    } catch (error) {
      console.error('[SheetsService] Failed to get approved rows:', error);
      throw error;
    }
  }

  async getScheduledRows(
    spreadsheetId: string
  ): Promise<{ row: SheetRow; rowIndex: number }[]> {
    try {
      const rows = await this.readRows(spreadsheetId);
      return rows
        .map((row, index) => ({ row, rowIndex: index }))
        .filter(({ row }) => row.email_status === 'scheduled');
    } catch (error) {
      console.error('[SheetsService] Failed to get scheduled rows:', error);
      throw error;
    }
  }
}
