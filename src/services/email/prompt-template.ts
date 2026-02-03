import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

export function buildEmailPrompt(
  context: PromptContext,
  options?: Partial<EmailGenerationOptions>
): string {
  const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };

  return `Generate a cold outreach email. You MUST follow the EXACT template below — no deviations.

RECIPIENT:
- Name: ${context.contactName}
- Company: ${context.companyName}
- Website: ${context.websiteUrl}

SCAN FINDINGS:
- Problems found: ${context.problemCount}
- Annotation labels: ${context.annotationLabels.length > 0 ? context.annotationLabels.join(', ') : 'general issues'}
- Most critical problem: ${context.worstProblem}
- Full diagnostics: ${context.diagnosticsSummary}

MANDATORY TEMPLATE (follow this EXACTLY):

Subject: [<8 words, reference their #1 problem specifically]

Hi {first_name},

[First sentence: "I ran a diagnostic on {website}." followed by ONE specific finding with a NUMBER/METRIC from the diagnostics above — load time in seconds, score out of 100, number of broken links, etc. Make the metric feel alarming but factual.]

[Second sentence: "I also found two other issues" + brief phrase about impact relevant to their business/industry.]

[IMAGE]

Want me to walk you through what I found? Takes 15 minutes.

Dan

STRICT RULES:
1. Total body MUST be under ${opts.maxBodyWords} words. Count carefully.
2. Subject MUST be under 8 words and reference their specific #1 problem
3. First line MUST include "I ran a diagnostic on {website}" and contain a specific number from the diagnostics (e.g., "7.1 seconds to load", "34/100 on Core Web Vitals", "3 broken links")
4. Second line MUST start with "I also found two other issues"
5. CTA MUST be exactly: "Want me to walk you through what I found? Takes 15 minutes."
6. Sign off MUST be exactly: "Dan"
7. Include "[IMAGE]" on its own line between the findings and the CTA — this is where the screenshot goes
8. Tone: Direct, expert, concerned — NOT salesy
9. NO ROI claims, NO pricing, NO buzzwords, NO "hope this finds you well"
10. Use the recipient's first name only (extract from "${context.contactName}")
11. Adapt the impact phrase in the second line to their likely industry based on their company name and website

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line here",
  "body": "Hi Name,\\n\\nFirst paragraph here.\\n\\nI also found two other issues affecting your [context].\\n\\n[IMAGE]\\n\\nWant me to walk you through what I found? Takes 15 minutes.\\n\\nDan"
}`;
}

export function buildDiagnosticsSummary(diagnostics: DiagnosticResult[]): string {
  return diagnostics
    .map(d => {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1);
      return `${d.name}: ${statusLabel} (${d.score}/100) - ${d.details}`;
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
