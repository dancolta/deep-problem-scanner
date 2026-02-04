import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

export const DEFAULT_EMAIL_TEMPLATE = `Generate a cold outreach email following this pattern. Adapt naturally based on the findings.

RECIPIENT:
- First name: {{firstName}}
- Company: {{companyName}}
- Domain: {{domain}}

SCAN FINDINGS:
- Page load time: {{loadTime}}
- Conversion loss: {{conversionLoss}}
- Number of issues found: {{issueCount}}
- Hero section issues: {{heroIssues}}
- Most critical: {{worstProblem}}
- Full diagnostics: {{diagnosticsSummary}}

---

EMAIL PATTERN:

Subject: [3-7 words, reference their main problem]

Hi {{firstName}},

[HOOK: Start directly with load time and conversion impact. Example: "Your homepage takes 7.1 seconds to load, {{conversionLoss}}."]

Also, your hero section has some {{issueWord}} I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

EXAMPLE (5-8 seconds load time):

Hi Sarah,

Your homepage takes 7.1 seconds to load, that's likely costing you 30-35% of your conversions before visitors even see your offer.

Also, your hero section has an issue I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

EXAMPLE (12+ seconds load time):

Hi Mike,

Your homepage takes 13.2 seconds to load, that's likely costing you 50%+ of your conversions before visitors even see your offer.

Also, your hero section has some issues I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

RULES:
1. Body: 75-100 words max (under 80 ideal). Be concise.
2. Subject: 3-7 words, specific to their problem
3. First sentence MUST start with "Your homepage takes X seconds to load" (use exact load time from findings)
4. First sentence MUST include conversion loss percentage (e.g., "that's likely costing you 30-35% of your conversions before visitors even see your offer")
5. NO em dashes. Use commas instead.
6. Second paragraph MUST be: "Also, your hero section has some {{issueWord}} I've flagged below:"
7. CTA MUST be: "Want me to walk you through the rest of the findings? Takes 15 minutes."
8. NO signature - Gmail will add it automatically
9. Tone: Direct, expert, helpful
10. NO: ROI claims, pricing, buzzwords, "hope this finds you well"

SPACING RULES:
- After "hero section:" → single newline → [IMAGE] (NO blank line between text and image)
- After [IMAGE] → blank line → CTA (one blank line after image)

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line",
  "body": "Hi {{firstName}},\\n\\nYour homepage takes X seconds to load, {{conversionLoss}}.\\n\\nAlso, your hero section has some {{issueWord}} I've flagged below:\\n[IMAGE]\\n\\nWant me to walk you through the rest of the findings? Takes 15 minutes."
}`;

/**
 * Get conversion loss percentage based on load time in seconds
 * Based on industry research on page load times and conversion rates
 */
function getConversionLoss(loadTimeSeconds: number): string {
  if (loadTimeSeconds <= 3) {
    return "that's likely costing you 10-15% of your conversions before visitors even see your offer";
  } else if (loadTimeSeconds <= 5) {
    return "that's likely costing you 20-25% of your conversions before visitors even see your offer";
  } else if (loadTimeSeconds <= 8) {
    return "that's likely costing you 30-35% of your conversions before visitors even see your offer";
  } else if (loadTimeSeconds <= 12) {
    return "that's likely costing you 40-50% of your conversions before visitors even see your offer";
  } else {
    return "that's likely costing you 50%+ of your conversions before visitors even see your offer";
  }
}

export function buildEmailPrompt(
  context: PromptContext,
  options?: Partial<EmailGenerationOptions>,
  customTemplate?: string
): string {
  const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };
  const firstName = context.contactName.split(' ')[0];
  const loadTime = context.loadTimeSeconds ? `${context.loadTimeSeconds} seconds` : null;
  const conversionLoss = context.loadTimeSeconds ? getConversionLoss(context.loadTimeSeconds) : "that's likely costing you conversions before visitors even see your offer";

  // Extract domain from URL (e.g., "talentflow.com" from "https://www.talentflow.com/page")
  let domain = context.websiteUrl;
  try {
    const url = new URL(context.websiteUrl.startsWith('http') ? context.websiteUrl : `https://${context.websiteUrl}`);
    domain = url.hostname.replace(/^www\./, '');
  } catch {
    // Keep original if URL parsing fails
  }

  // Singular/plural for issues
  const issueCount = context.annotationLabels.length || context.problemCount || 1;
  const issueWord = issueCount === 1 ? 'issue' : 'issues';

  // Use custom template or default
  const template = customTemplate || DEFAULT_EMAIL_TEMPLATE;

  // Interpolate placeholders
  return template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{companyName\}\}/g, context.companyName)
    .replace(/\{\{domain\}\}/g, domain)
    .replace(/\{\{loadTime\}\}/g, loadTime || 'see diagnostics')
    .replace(/\{\{conversionLoss\}\}/g, conversionLoss)
    .replace(/\{\{issueCount\}\}/g, String(issueCount))
    .replace(/\{\{heroIssues\}\}/g, context.annotationLabels.length > 0 ? context.annotationLabels.join(', ') : 'general issues')
    .replace(/\{\{worstProblem\}\}/g, context.worstProblem)
    .replace(/\{\{diagnosticsSummary\}\}/g, context.diagnosticsSummary)
    .replace(/\{\{issueWord\}\}/g, issueWord);
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

  // Extract load time from Page Speed diagnostic
  const pageSpeedDiag = params.diagnostics.find(d => d.name === 'Page Speed');
  let loadTimeSeconds: number | undefined;
  if (pageSpeedDiag?.details) {
    const match = pageSpeedDiag.details.match(/(\d+\.?\d*)\s*s/);
    if (match) {
      loadTimeSeconds = parseFloat(match[1]);
    }
  }

  return {
    companyName: params.companyName,
    contactName: params.contactName,
    websiteUrl: params.websiteUrl,
    diagnosticsSummary: buildDiagnosticsSummary(params.diagnostics),
    screenshotUrl: params.screenshotUrl,
    annotationLabels: params.annotationLabels,
    problemCount: failedDiagnostics.length + warningDiagnostics.length,
    worstProblem: worstProblem ? `${worstProblem.name} (${worstProblem.details})` : 'general improvements needed',
    loadTimeSeconds,
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
