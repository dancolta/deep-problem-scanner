import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Column header variants to match (normalized: lowercase, spaces→underscores)
// Must match csv-parser.ts COLUMN_VARIANTS
const LEAD_COLUMN_VARIANTS: Record<string, string[]> = {
  processed: [
    'processed', 'proccesed', 'proccessed', 'done', 'completed', 'sent', 'emailed'
  ],
  company_name: [
    'company_name', 'company', 'companyname', 'business', 'business_name',
    'company_name_for_emails', 'company_name_-_cleaned', 'organization', 'org', 'client', 'account'
  ],
  website_url: [
    'website_url', 'website', 'url', 'site', 'web', 'homepage', 'domain'
  ],
  contact_name: [
    'contact_name', 'name', 'contactname', 'contact', 'full_name', 'fullname',
    'contact_full_name'
  ],
  contact_email: [
    'contact_email', 'email', 'contactemail', 'mail', 'email_address',
    'primary_email', 'email_1', 'work_email', 'business_email'
  ],
  first_name: [
    'first_name', 'firstname', 'first'
  ],
  last_name: [
    'last_name', 'lastname', 'last', 'surname'
  ],
};

export interface SheetImportResult {
  leads: Array<{
    company_name: string;
    website_url: string;
    contact_name: string;
    contact_email: string;
    sourceRowNumber: number;  // 1-based row number for marking as processed
  }>;
  sheetName: string;
  totalRows: number;
  headers: string[];
  alreadyProcessed: number;  // Count of rows with Processed=TRUE
  spreadsheetId: string;     // For tracking source sheet
}

export function extractSpreadsheetId(urlOrId: string): string | null {
  // Already a spreadsheetId (alphanumeric with dashes/underscores, no slashes)
  if (/^[a-zA-Z0-9_-]+$/.test(urlOrId) && urlOrId.length > 10) {
    return urlOrId;
  }

  // Extract from URL patterns
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function extractGid(url: string): number | null {
  const match = url.match(/[#&]gid=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export class SheetsLeadImporter {
  private sheets: sheets_v4.Sheets;

  constructor(authClient: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
  }

  async importLeads(spreadsheetId: string, gid?: number | null): Promise<SheetImportResult> {
    // 1. Get sheet metadata for name
    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.title,sheets.properties',
    });

    const spreadsheetName = meta.data.properties?.title || 'Untitled';

    // Find the correct sheet by gid, or use first sheet
    let sheetName = 'Sheet1';
    const sheets = meta.data.sheets || [];

    if (gid !== null && gid !== undefined) {
      const targetSheet = sheets.find(s => s.properties?.sheetId === gid);
      if (targetSheet?.properties?.title) {
        sheetName = targetSheet.properties.title;
      }
    } else if (sheets[0]?.properties?.title) {
      sheetName = sheets[0].properties.title;
    }

    // 2. Read all data from first sheet
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:BZ`,  // Extended range to capture all columns
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      throw new Error('EMPTY_SHEET');
    }

    // 3. Parse headers and build column map
    const headers = rows[0].map((h: any) => String(h || ''));
    const normalizedHeaders = headers.map((h: string) =>
      h.toLowerCase().trim().replace(/\s+/g, '_')
    );
    console.log('[SheetsImporter] Normalized headers:', normalizedHeaders);
    const columnMap = this.buildColumnMap(normalizedHeaders);
    console.log('[SheetsImporter] Column map:', columnMap);

    // Find the processed column index
    const processedColIndex = columnMap['processed'];
    console.log('[SheetsImporter] Processed column index:', processedColIndex);

    // 4. Convert rows to leads, skipping already-processed ones
    const leads: SheetImportResult['leads'] = [];
    let alreadyProcessed = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      // Check if this row is already processed (checkbox is TRUE)
      if (processedColIndex !== undefined) {
        const processedValue = row[processedColIndex];
        // Google Sheets checkboxes return TRUE/FALSE as strings or booleans
        if (processedValue === true ||
            processedValue === 'TRUE' ||
            processedValue === 'true' ||
            processedValue === '1' ||
            processedValue === 1) {
          alreadyProcessed++;
          console.log(`[SheetsImporter] Row ${i + 1} already processed, skipping`);
          continue;
        }
      }

      const lead = this.rowToLead(row, columnMap);
      if (i === 1) {
        console.log('[SheetsImporter] First row data:', row);
        console.log('[SheetsImporter] First lead parsed:', lead);
      }
      if (lead) {
        leads.push({
          ...lead,
          sourceRowNumber: i + 1,  // 1-based row number (row 1 = header, row 2 = first data)
        });
      }
    }
    console.log('[SheetsImporter] Total leads parsed:', leads.length);
    console.log('[SheetsImporter] Already processed:', alreadyProcessed);

    // Count only rows that have actual data (not empty/formatted rows)
    const actualDataRows = rows.slice(1).filter((row: any[]) =>
      row && row.some((cell: any) => cell && String(cell).trim())
    ).length;

    return {
      leads,
      sheetName: spreadsheetName,
      totalRows: actualDataRows,
      headers,
      alreadyProcessed,
      spreadsheetId,
    };
  }

  private buildColumnMap(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const [field, variants] of Object.entries(LEAD_COLUMN_VARIANTS)) {
      const index = headers.findIndex(h => variants.includes(h));
      if (index !== -1) {
        map[field] = index;
      }
    }

    return map;
  }

  private rowToLead(row: any[], columnMap: Record<string, number>) {
    const getValue = (field: string): string => {
      const index = columnMap[field];
      return index !== undefined && row[index] ? String(row[index]).trim() : '';
    };

    // Build contact_name from first_name + last_name if not directly available
    let contactName = getValue('contact_name');
    if (!contactName) {
      const firstName = getValue('first_name');
      const lastName = getValue('last_name');
      contactName = [firstName, lastName].filter(Boolean).join(' ');
    }

    const lead = {
      company_name: getValue('company_name'),
      website_url: getValue('website_url'),
      contact_name: contactName,
      contact_email: getValue('contact_email'),
    };

    // Skip rows without email (minimum requirement to parse)
    // Let validation handle company_name and website_url requirements
    if (!lead.contact_email) {
      return null;
    }

    return lead;
  }

  /**
   * Mark a lead as processed by setting the "Processed" checkbox to TRUE.
   * This prevents the lead from being imported again on subsequent uploads.
   */
  async markAsProcessed(
    spreadsheetId: string,
    rowNumber: number,
    sheetName?: string
  ): Promise<void> {
    // Get sheet name if not provided
    const targetSheetName = sheetName || await this.getFirstSheetName(spreadsheetId);

    console.log(`[SheetsImporter] Marking row ${rowNumber} as processed in "${targetSheetName}"`);

    // Write TRUE to Column A of the specified row (Processed checkbox column)
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${targetSheetName}'!A${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[true]],
      },
    });

    console.log(`[SheetsImporter] Successfully marked row ${rowNumber} as processed`);
  }

  /**
   * Get the name of the first sheet in the spreadsheet.
   */
  private async getFirstSheetName(spreadsheetId: string): Promise<string> {
    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    return meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
  }
}
