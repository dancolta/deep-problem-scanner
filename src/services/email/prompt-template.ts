import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

export function buildEmailPrompt(
  context: PromptContext,
  options?: Partial<EmailGenerationOptions>
): string {
  const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };

  const issuesList = context.annotationLabels.length > 0
    ? context.annotationLabels.join(', ')
    : 'various areas needing improvement';

  return `You are writing a personalized cold outreach email. Generate a subject line and email body.

RECIPIENT:
- Name: ${context.contactName}
- Company: ${context.companyName}
- Website: ${context.websiteUrl}

FINDINGS FROM WEBSITE SCAN:
- Problems found: ${context.problemCount}
- Key issues: ${issuesList}
- Most critical: ${context.worstProblem}
- Full diagnostics: ${context.diagnosticsSummary}

RULES:
1. Subject line: max ${opts.maxSubjectChars} characters, specific to their website, NOT generic
2. Email body: STRICTLY ${opts.maxBodyWords} words or fewer. Count carefully.
3. Tone: ${opts.tone}, not salesy
${opts.includeScreenshotMention ? '4. Reference the annotated screenshot that shows the problems visually' : ''}
5. Mention 1-2 specific problems from the scan (use the actual findings above)
6. End with a soft, non-pushy call to action
7. Do NOT use: "I hope this email finds you well", "I noticed", "I came across", or other overused openers
8. Start with something direct and specific to their website
9. Use the recipient's first name naturally
10. Keep it conversational, not corporate

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line here",
  "body": "your email body here"
}`;
}

export function buildDiagnosticsSummary(diagnostics: DiagnosticResult[]): string {
  return diagnostics
    .map(d => {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1);
      return `${d.name}: ${statusLabel} (${d.score}/100)`;
    })
    .join(' | ');
}

export function buildPromptContext(params: {
  companyName: string;
  contactName: string;
  websiteUrl: string;
  diagnostics: DiagnosticResult[];
  screenshotUrl: string;
  annotationLabels: string[];
}): PromptContext {
  const failedDiagnostics = params.diagnostics.filter(d => d.status === 'fail');
  const warningDiagnostics = params.diagnostics.filter(d => d.status === 'warning');
  const worstProblem = failedDiagnostics.length > 0
    ? failedDiagnostics.sort((a, b) => a.score - b.score)[0]
    : warningDiagnostics.sort((a, b) => a.score - b.score)[0]
    || params.diagnostics[0];

  return {
    companyName: params.companyName,
    contactName: params.contactName,
    websiteUrl: params.websiteUrl,
    diagnosticsSummary: buildDiagnosticsSummary(params.diagnostics),
    screenshotUrl: params.screenshotUrl,
    annotationLabels: params.annotationLabels,
    problemCount: failedDiagnostics.length + warningDiagnostics.length,
    worstProblem: worstProblem ? `${worstProblem.name} (${worstProblem.details})` : 'general improvements needed',
  };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length <= maxWords) return text.trim();

  const truncated = words.slice(0, maxWords).join(' ');
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?')
  );

  if (lastSentenceEnd > truncated.length * 0.5) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  return truncated + '...';
}
