import { Lead } from '../../shared/types';

export interface ParseResult {
  leads: Lead[];
  headers: string[];
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  missingColumns: string[];
  columnMap: Record<string, string>;
}

const COLUMN_VARIANTS: Record<string, string[]> = {
  company_name: ['company_name', 'company', 'companyname', 'business', 'business_name'],
  website_url: ['website_url', 'website', 'url', 'site', 'web', 'homepage'],
  contact_name: ['contact_name', 'name', 'contactname', 'contact', 'full_name', 'fullname'],
  contact_email: ['contact_email', 'email', 'contactemail', 'mail', 'email_address'],
};

const REQUIRED_COLUMNS = Object.keys(COLUMN_VARIANTS);

export class CsvParser {
  validateHeaders(headers: string[]): ValidationResult {
    const normalized = headers.map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
    const columnMap: Record<string, string> = {};
    const missingColumns: string[] = [];

    for (const requiredField of REQUIRED_COLUMNS) {
      const variants = COLUMN_VARIANTS[requiredField];
      const matchIndex = normalized.findIndex(h => variants.includes(h));
      if (matchIndex !== -1) {
        columnMap[normalized[matchIndex]] = requiredField;
      } else {
        missingColumns.push(requiredField);
      }
    }

    return {
      valid: missingColumns.length === 0,
      missingColumns,
      columnMap,
    };
  }

  parse(csvContent: string): ParseResult {
    const errors: string[] = [];

    if (!csvContent || !csvContent.trim()) {
      return { leads: [], headers: [], errors: ['CSV content is empty'] };
    }

    const rows = this.parseRows(csvContent);

    if (rows.length === 0) {
      return { leads: [], headers: [], errors: ['CSV content is empty'] };
    }

    const headers = rows[0];
    const validation = this.validateHeaders(headers);

    if (!validation.valid) {
      return {
        leads: [],
        headers,
        errors: [`Missing required columns: ${validation.missingColumns.join(', ')}`],
      };
    }

    const normalizedHeaders = headers.map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
    const leads: Lead[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Skip completely empty rows
      if (row.length === 1 && row[0] === '') continue;

      const lead: Record<string, string> = {
        company_name: '',
        website_url: '',
        contact_name: '',
        contact_email: '',
      };

      for (let j = 0; j < normalizedHeaders.length; j++) {
        const value = j < row.length ? row[j] : '';
        const standardField = validation.columnMap[normalizedHeaders[j]];
        if (standardField) {
          lead[standardField] = value.trim();
        } else {
          // Extra column - store with normalized header name
          lead[normalizedHeaders[j]] = value.trim();
        }
      }

      leads.push(lead as Lead);
    }

    if (leads.length === 0) {
      errors.push('No data rows found in CSV');
    }

    return { leads, headers, errors };
  }

  validateLeads(leads: Lead[]): { valid: Lead[]; invalid: { lead: Lead; reason: string }[] } {
    const valid: Lead[] = [];
    const invalid: { lead: Lead; reason: string }[] = [];

    for (const lead of leads) {
      const reasons: string[] = [];

      if (!lead.company_name || !lead.company_name.trim()) {
        reasons.push('company_name is empty');
      }

      if (!lead.website_url || (!lead.website_url.includes('.') && !lead.website_url.startsWith('http'))) {
        reasons.push('website_url is invalid');
      }

      if (!lead.contact_email || !this.isValidEmail(lead.contact_email)) {
        reasons.push('contact_email is invalid');
      }

      if (reasons.length > 0) {
        invalid.push({ lead, reason: reasons.join('; ') });
      } else {
        valid.push(lead);
      }
    }

    console.log(`[CsvParser] Validated ${leads.length} leads: ${valid.length} valid, ${invalid.length} invalid`);
    return { valid, invalid };
  }

  filterDuplicateEmails(leads: Lead[]): { unique: Lead[]; duplicates: Lead[] } {
    const seen = new Set<string>();
    const unique: Lead[] = [];
    const duplicates: Lead[] = [];

    for (const lead of leads) {
      const email = lead.contact_email.toLowerCase().trim();
      if (seen.has(email)) {
        duplicates.push(lead);
      } else {
        seen.add(email);
        unique.push(lead);
      }
    }

    if (duplicates.length > 0) {
      console.log(`[CsvParser] Filtered ${duplicates.length} duplicate emails`);
    }

    return { unique, duplicates };
  }

  private isValidEmail(email: string): boolean {
    const atIndex = email.indexOf('@');
    if (atIndex < 1) return false;
    const domain = email.substring(atIndex + 1);
    return domain.includes('.');
  }

  /**
   * Parse CSV content into an array of rows, each row being an array of field strings.
   * Handles quoted fields, escaped quotes (""), newlines inside quotes, and mixed quoting.
   */
  private parseRows(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
      const ch = content[i];

      if (inQuotes) {
        if (ch === '"') {
          // Check for escaped quote ""
          if (i + 1 < content.length && content[i + 1] === '"') {
            currentField += '"';
            i += 2;
          } else {
            // End of quoted field
            inQuotes = false;
            i++;
          }
        } else {
          currentField += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          currentRow.push(currentField);
          currentField = '';
          i++;
        } else if (ch === '\r') {
          // Handle \r\n or bare \r
          currentRow.push(currentField);
          currentField = '';
          if (i + 1 < content.length && content[i + 1] === '\n') {
            i += 2;
          } else {
            i++;
          }
          rows.push(currentRow);
          currentRow = [];
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          i++;
          rows.push(currentRow);
          currentRow = [];
        } else {
          currentField += ch;
          i++;
        }
      }
    }

    // Push last field and row
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    // Remove trailing empty rows
    while (rows.length > 0) {
      const last = rows[rows.length - 1];
      if (last.length === 1 && last[0] === '') {
        rows.pop();
      } else {
        break;
      }
    }

    return rows;
  }
}
