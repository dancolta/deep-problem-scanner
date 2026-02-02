// scripts/smoke-test.ts
// Usage: npx ts-node scripts/smoke-test.ts
// Requires: .env with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GEMINI_API_KEY

import 'dotenv/config';

import { CsvParser } from '../src/services/csv/csv-parser';
import { ScannerService } from '../src/services/scanner/scanner-service';
import { AnnotationService } from '../src/services/annotation/annotation-service';
import { compressImage } from '../src/services/annotation/compression';
import { GoogleAuthService } from '../src/services/google/auth';
import { DriveService } from '../src/services/google/drive';
import { GmailService } from '../src/services/google/gmail';
import { EmailGenerator } from '../src/services/email/email-generator';
import type { PromptContext } from '../src/services/email/types';
import type { ScanResult, Lead, EmailDraft, DiagnosticResult } from '../src/shared/types';

async function main() {
  console.log('\n\uD83D\uDD2C Deep Problem Scanner \u2014 Smoke Test\n');

  let passed = 0;
  const total = 10;

  let scanResult: ScanResult | null = null;
  let screenshotBuffer: Buffer | null = null;
  let annotatedBuffer: Buffer | null = null;
  let compressedBuffer: Buffer | null = null;
  let authClient: any = null;
  let driveLink: string = '';
  let generatedEmail: { subject: string; body: string; wordCount: number } | null = null;
  let leads: Lead[] = [];

  // Step 1: Load env
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!geminiKey) throw new Error('GEMINI_API_KEY not set');
    if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID not set');
    console.log(`  \u2713 Step 1: Load env \u2014 GEMINI_API_KEY and GOOGLE_CLIENT_ID present`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 1: Load env \u2014 ${err}`);
  }

  // Step 2: Parse CSV
  try {
    const csvContent = [
      'company_name,website_url,contact_name,contact_email',
      'Acme Corp,https://example.com,John Doe,john@acme.test',
      'Beta Inc,https://example.com,Jane Smith,jane@beta.test',
      'Gamma LLC,https://example.com,Bob Jones,bob@gamma.test',
    ].join('\n');

    const parser = new CsvParser();
    const result = parser.parse(csvContent);
    leads = result.leads;
    if (result.errors.length > 0) throw new Error(`Parse errors: ${result.errors.join(', ')}`);
    if (leads.length !== 3) throw new Error(`Expected 3 leads, got ${leads.length}`);
    console.log(`  \u2713 Step 2: Parse CSV \u2014 ${leads.length} leads parsed, headers: ${result.headers.join(', ')}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 2: Parse CSV \u2014 ${err}`);
  }

  // Step 3: Scan URL
  let scanner: ScannerService | null = null;
  try {
    scanner = new ScannerService();
    await scanner.initialize();
    scanResult = await scanner.scanHomepage('https://example.com');
    const diagCount = scanResult.diagnostics.length;
    console.log(`  \u2713 Step 3: Scan URL \u2014 status=${scanResult.status}, diagnostics=${diagCount}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 3: Scan URL \u2014 ${err}`);
  } finally {
    if (scanner) await scanner.shutdown().catch(() => {});
  }

  // Step 4: Annotate
  try {
    if (!scanResult?.screenshotBase64) {
      console.log(`  \u26A0 Step 4: Annotate \u2014 skipped, screenshot is null`);
    } else {
      screenshotBuffer = Buffer.from(scanResult.screenshotBase64, 'base64');
      const annotationService = new AnnotationService();
      const companySlug = leads[0]?.company_name?.toLowerCase().replace(/\s+/g, '-') || 'test';
      const annotated = await annotationService.annotateScreenshot(
        screenshotBuffer,
        scanResult.diagnostics,
        scanResult.url,
        companySlug,
      );
      annotatedBuffer = annotated.buffer;
      console.log(`  \u2713 Step 4: Annotate \u2014 ${annotated.annotationCount} annotations, ${annotated.sizeKB.toFixed(1)} KB`);
      passed++;
    }
  } catch (err) {
    console.error(`  \u2717 Step 4: Annotate \u2014 ${err}`);
  }

  // Step 5: Compress
  try {
    const bufferToCompress = annotatedBuffer || screenshotBuffer;
    if (!bufferToCompress) {
      console.log(`  \u26A0 Step 5: Compress \u2014 skipped, no image buffer available`);
    } else {
      const originalKB = (bufferToCompress.length / 1024).toFixed(1);
      compressedBuffer = await compressImage(bufferToCompress);
      const compressedKB = (compressedBuffer.length / 1024).toFixed(1);
      console.log(`  \u2713 Step 5: Compress \u2014 ${originalKB} KB -> ${compressedKB} KB`);
      passed++;
    }
  } catch (err) {
    console.error(`  \u2717 Step 5: Compress \u2014 ${err}`);
  }

  // Step 6: Google Auth
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set');
    const authService = new GoogleAuthService(clientId, clientSecret);
    await authService.authenticate();
    authClient = await authService.getAuthenticatedClient();
    console.log(`  \u2713 Step 6: Google Auth \u2014 authenticated successfully`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 6: Google Auth \u2014 ${err}`);
  }

  // Step 7: Upload to Drive
  try {
    if (!authClient) throw new Error('No auth client (step 6 failed)');
    const uploadBuffer = compressedBuffer || annotatedBuffer || screenshotBuffer;
    if (!uploadBuffer) throw new Error('No image buffer to upload');
    const driveService = new DriveService(authClient);
    const filename = `smoke-test-${Date.now()}.png`;
    const uploadResult = await driveService.uploadScreenshot(uploadBuffer, filename);
    driveLink = uploadResult.webViewLink;
    console.log(`  \u2713 Step 7: Upload to Drive \u2014 ${driveLink}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 7: Upload to Drive \u2014 ${err}`);
  }

  // Step 8: Generate Email
  try {
    const emailGen = new EmailGenerator();
    const diagnostics: DiagnosticResult[] = scanResult?.diagnostics || [];
    const failedDiags = diagnostics.filter(d => d.status === 'fail');
    const worstProblem = failedDiags.length > 0
      ? failedDiags.sort((a, b) => a.score - b.score)[0].name
      : 'general improvements needed';

    const context: PromptContext = {
      companyName: leads[0]?.company_name || 'Test Company',
      contactName: leads[0]?.contact_name || 'Test Contact',
      websiteUrl: 'https://example.com',
      diagnosticsSummary: diagnostics.map(d => `${d.name}: ${d.status} (${d.details})`).join('; '),
      screenshotUrl: driveLink || 'https://example.com/screenshot.png',
      annotationLabels: diagnostics.filter(d => d.status !== 'pass').map(d => d.name),
      problemCount: failedDiags.length,
      worstProblem,
    };

    generatedEmail = await emailGen.generateEmail(context);
    const wordCount = generatedEmail.wordCount;
    console.log(`  \u2713 Step 8: Generate Email \u2014 subject="${generatedEmail.subject}", ${wordCount} words`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 8: Generate Email \u2014 ${err}`);
  }

  // Step 9: Create Gmail Draft
  try {
    if (!authClient) throw new Error('No auth client (step 6 failed)');
    if (!generatedEmail) throw new Error('No generated email (step 8 failed)');
    const gmailService = new GmailService(authClient);
    const draft: EmailDraft = {
      to: leads[0]?.contact_email || 'test@example.com',
      subject: generatedEmail.subject,
      body: generatedEmail.body,
      screenshotDriveUrl: driveLink || '',
      leadData: leads[0] || { company_name: 'Test', website_url: 'https://example.com', contact_name: 'Test', contact_email: 'test@example.com' },
      status: 'draft',
    };
    const draftResult = await gmailService.createDraft(draft);
    console.log(`  \u2713 Step 9: Create Gmail Draft \u2014 draftId=${draftResult.draftId}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 9: Create Gmail Draft \u2014 ${err}`);
  }

  // Step 10: Summary
  try {
    console.log(`\n  \u2713 Step 10: Summary`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 Step 10: Summary \u2014 ${err}`);
  }

  console.log(`\n\uD83D\uDCCA ${passed}/${total} steps passed\n`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
