import { CsvParser } from './csv-parser';
import { Lead } from '../../shared/types';
import { LeadValidator } from '../validation/lead-validator';

export interface PipelineResult {
  leads: Lead[];
  totalParsed: number;
  invalidLeads: { lead: Lead; reasons: string[] }[];
  duplicateEmails: Lead[];
  alreadyScanned: Lead[];
  alreadyProcessed: number;  // Leads with "Processed" checkbox marked in source sheet
  skippedByRange: number;
}

interface SheetsChecker {
  checkDuplicates(spreadsheetId: string, websiteUrls: string[]): Promise<string[]>;
}

export class LeadPipeline {
  private csvParser: CsvParser;
  private validator: LeadValidator;

  constructor(private sheetsChecker?: SheetsChecker) {
    this.csvParser = new CsvParser();
    this.validator = new LeadValidator();
  }

  async processUpload(
    csvContent: string,
    spreadsheetId?: string,
    rowRange?: { start: number; end: number }
  ): Promise<PipelineResult> {
    console.log('[LeadPipeline] Starting CSV processing pipeline');

    // 1. Parse CSV
    const parseResult = this.csvParser.parse(csvContent);
    if (parseResult.errors.length > 0) {
      const msg = `CSV validation failed: ${parseResult.errors.join(', ')}`;
      console.error(`[LeadPipeline] ${msg}`);
      throw new Error(msg);
    }

    const totalParsed = parseResult.leads.length;
    console.log(`[LeadPipeline] Parsed ${totalParsed} leads from CSV`);

    // 2. CLEANUP: Validate and remove invalid leads (FIRST step after parsing)
    const cleanupResult = this.validator.cleanLeads(parseResult.leads);

    // 3. Filter duplicate emails
    const { unique, duplicates } = this.csvParser.filterDuplicateEmails(cleanupResult.cleanedLeads);

    // 4. Check already scanned (via Sheets)
    let readyLeads = unique;
    let alreadyScanned: Lead[] = [];

    if (spreadsheetId && this.sheetsChecker) {
      try {
        const urls = readyLeads.map(l => l.website_url);
        const existingUrls = await this.sheetsChecker.checkDuplicates(spreadsheetId, urls);
        const existingSet = new Set(existingUrls.map(u => u.toLowerCase().replace(/\/+$/, '')));

        alreadyScanned = readyLeads.filter(l =>
          existingSet.has(l.website_url.toLowerCase().replace(/\/+$/, ''))
        );
        readyLeads = readyLeads.filter(l =>
          !existingSet.has(l.website_url.toLowerCase().replace(/\/+$/, ''))
        );

        if (alreadyScanned.length > 0) {
          console.log(`[LeadPipeline] Filtered ${alreadyScanned.length} already-scanned leads`);
        }
      } catch (err) {
        console.error(`[LeadPipeline] Sheets duplicate check failed, proceeding without filter:`, err);
      }
    }

    // 5. Apply row range
    let skippedByRange = 0;
    if (rowRange) {
      const before = readyLeads.length;
      readyLeads = readyLeads.slice(rowRange.start, rowRange.end + 1);
      skippedByRange = before - readyLeads.length;
    }

    console.log(`[LeadPipeline] Pipeline complete: ${readyLeads.length} leads ready for processing`);

    return {
      leads: readyLeads,
      totalParsed,
      invalidLeads: cleanupResult.removedLeads,
      duplicateEmails: duplicates,
      alreadyScanned,
      alreadyProcessed: 0,  // CSV imports don't have processed checkbox
      skippedByRange,
    };
  }
}
