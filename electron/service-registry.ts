import { PlaywrightScanner } from '../src/services/scanner/playwright-scanner';
import { AnnotationService } from '../src/services/annotation/annotation-service';
import { GoogleAuthService } from '../src/services/google/auth';
import { SheetsService } from '../src/services/google/sheets';
import { DriveService } from '../src/services/google/drive';
import { EmailGenerator } from '../src/services/email/email-generator';
import { LeadPipeline } from '../src/services/csv/lead-pipeline';
import { CsvParser } from '../src/services/csv/csv-parser';
import { GmailService } from '../src/services/google/gmail';
import { EmailScheduler } from '../src/services/scheduler/email-scheduler';
import type { SchedulerConfig } from '../src/services/scheduler/types';

export class ServiceRegistry {
  private static instance: ServiceRegistry;

  private _scanner: PlaywrightScanner | null = null;
  private _annotation: AnnotationService | null = null;
  private _googleAuth: GoogleAuthService | null = null;
  private _emailGenerator: EmailGenerator | null = null;
  private _csvParser: CsvParser | null = null;
  private _scheduler: EmailScheduler | null = null;

  private constructor() {}

  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  get scanner(): PlaywrightScanner {
    if (!this._scanner) {
      this._scanner = new PlaywrightScanner();
    }
    return this._scanner;
  }

  get annotation(): AnnotationService {
    if (!this._annotation) {
      this._annotation = new AnnotationService();
    }
    return this._annotation;
  }

  get googleAuth(): GoogleAuthService {
    if (!this._googleAuth) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error(
          'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables'
        );
      }
      this._googleAuth = new GoogleAuthService(clientId, clientSecret);
    }
    return this._googleAuth;
  }

  get emailGenerator(): EmailGenerator {
    if (!this._emailGenerator) {
      this._emailGenerator = new EmailGenerator();
    }
    return this._emailGenerator;
  }

  get csvParser(): CsvParser {
    if (!this._csvParser) {
      this._csvParser = new CsvParser();
    }
    return this._csvParser;
  }

  async getSheets(): Promise<SheetsService> {
    const client = await this.googleAuth.getAuthenticatedClient();
    return new SheetsService(client);
  }

  async getDrive(): Promise<DriveService> {
    const client = await this.googleAuth.getAuthenticatedClient();
    return new DriveService(client);
  }

  async getAuthenticatedGmail(): Promise<GmailService> {
    const client = await this.googleAuth.getAuthenticatedClient();
    return new GmailService(client);
  }

  getScheduler(config?: SchedulerConfig): EmailScheduler {
    if (config) {
      // Always create fresh scheduler when config is provided
      this._scheduler = new EmailScheduler(config);
    }
    if (!this._scheduler) {
      this._scheduler = new EmailScheduler({
        intervalMinutes: 15,
        timezone: 'UTC',
        maxRetries: 3,
        startHour: 9,
        endHour: 17,
        distributionPattern: 'spread',
      });
    }
    return this._scheduler;
  }

  getLeadPipeline(sheets?: SheetsService): LeadPipeline {
    return new LeadPipeline(sheets);
  }
}
