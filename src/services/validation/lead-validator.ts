import { Lead } from '../../shared/types';

export interface CleanupResult {
  cleanedLeads: Lead[];
  removedLeads: { lead: Lead; reasons: string[] }[];
  totalInput: number;
  totalCleaned: number;
  totalRemoved: number;
}

export class LeadValidator {
  /**
   * Validates and cleans leads, removing invalid entries.
   * This should be the FIRST processing step after data ingestion.
   *
   * Validation rules:
   * - company_name: must not be empty
   * - website_url: must contain '.' or start with 'http'
   * - contact_email: must have '@' at position >= 1 with domain containing '.'
   */
  cleanLeads(leads: Lead[]): CleanupResult {
    const cleanedLeads: Lead[] = [];
    const removedLeads: { lead: Lead; reasons: string[] }[] = [];

    for (const lead of leads) {
      const reasons = this.validateLead(lead);

      if (reasons.length > 0) {
        removedLeads.push({ lead, reasons });
      } else {
        cleanedLeads.push(lead);
      }
    }

    console.log(
      `[LeadValidator] Cleaned ${leads.length} leads: ${cleanedLeads.length} valid, ${removedLeads.length} removed`
    );

    return {
      cleanedLeads,
      removedLeads,
      totalInput: leads.length,
      totalCleaned: cleanedLeads.length,
      totalRemoved: removedLeads.length,
    };
  }

  /**
   * Validates a single lead and returns an array of validation failure reasons.
   * Returns empty array if the lead is valid.
   */
  private validateLead(lead: Lead): string[] {
    const reasons: string[] = [];

    // Rule 1: company_name must not be empty
    if (!lead.company_name || !lead.company_name.trim()) {
      reasons.push('company_name is empty');
    }

    // Rule 2: website_url must contain '.' or start with 'http'
    if (!lead.website_url || (!lead.website_url.includes('.') && !lead.website_url.startsWith('http'))) {
      reasons.push('website_url is invalid');
    }

    // Rule 3: contact_email must have '@' at position >= 1 with domain containing '.'
    if (!lead.contact_email || !this.isValidEmail(lead.contact_email)) {
      reasons.push('contact_email is invalid');
    }

    return reasons;
  }

  private isValidEmail(email: string): boolean {
    const atIndex = email.indexOf('@');
    if (atIndex < 1) return false;
    const domain = email.substring(atIndex + 1);
    return domain.includes('.');
  }
}
