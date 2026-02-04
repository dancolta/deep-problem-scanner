import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

/**
 * Get bounce rate impact text based on load time in seconds
 * Based on industry research on page load times and bounce rates
 */
function getBounceImpact(loadTimeSeconds: number): string {
  if (loadTimeSeconds <= 3) {
    return 'which keeps most visitors engaged';
  } else if (loadTimeSeconds <= 5) {
    return 'that typically bounces 20-25% of visitors before they see your offer';
  } else if (loadTimeSeconds <= 8) {
    return 'that typically bounces 30-35% of visitors before they see your offer';
  } else if (loadTimeSeconds <= 12) {
    return 'that typically bounces 40%+ of visitors before they see your offer';
  } else {
    return 'that typically bounces 50%+ of visitors before they see your offer';
  }
}

export function buildEmailPrompt(
  context: PromptContext,
  options?: Partial<EmailGenerationOptions>
): string {
  const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };
  const firstName = context.contactName.split(' ')[0];
  const loadTime = context.loadTimeSeconds ? `${context.loadTimeSeconds} seconds` : null;
  const bounceImpact = context.loadTimeSeconds ? getBounceImpact(context.loadTimeSeconds) : 'that may be costing you conversions';

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

  return `Generate a cold outreach email following this pattern. Adapt naturally based on the findings.

RECIPIENT:
- First name: ${firstName}
- Company: ${context.companyName}
- Domain: ${domain}

SCAN FINDINGS:
- Page load time: ${loadTime || 'see diagnostics'}
- Bounce impact: ${bounceImpact}
- Number of issues found: ${issueCount}
- Hero section issues: ${context.annotationLabels.length > 0 ? context.annotationLabels.join(', ') : 'general issues'}
- Most critical: ${context.worstProblem}
- Full diagnostics: ${context.diagnosticsSummary}

---

EMAIL PATTERN:

Subject: [3-7 words, reference their main problem]

Hi ${firstName},

[HOOK: Start with "I ran a diagnostic on ${domain}." Then state load time + bounce impact. Example: "Your site takes 7.1 seconds to load, ${bounceImpact}."]

Also, here are some ${issueWord} I've identified on your hero section:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

EXAMPLE (7+ seconds load time):

Hi Sarah,

I ran a diagnostic on talentflow.com. Your site takes 7.1 seconds to load, that typically bounces 40%+ of visitors before they see your offer.

Also, here is an issue I've identified on your hero section:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

EXAMPLE (12+ seconds load time):

Hi Mike,

I ran a diagnostic on shopbright.com. Your site takes 13.2 seconds to load, that typically bounces 50%+ of visitors before they see your offer.

Also, here are some issues I've identified on your hero section:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

RULES:
1. Body: 75-100 words max (under 80 ideal). Be concise.
2. Subject: 3-7 words, specific to their problem
3. MUST use domain only (${domain}), NOT full URL
4. MUST include "I ran a diagnostic on {domain}." in first sentence
5. MUST include load time in seconds AND bounce impact (e.g., "takes X seconds to load, that typically bounces Y% of visitors before they see your offer")
6. NO em dashes. Use commas instead.
7. Second paragraph MUST be: "Also, here are some ${issueWord} I've identified on your hero section:"
8. CTA MUST be: "Want me to walk you through the rest of the findings? Takes 15 minutes."
9. NO signature - Gmail will add it automatically
10. Tone: Direct, expert, helpful
11. NO: ROI claims, pricing, buzzwords, "hope this finds you well"

SPACING RULES:
- After "hero section:" → single newline → [IMAGE] (NO blank line between text and image)
- After [IMAGE] → blank line → CTA (one blank line after image)

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line",
  "body": "Hi ${firstName},\\n\\nI ran a diagnostic on ${domain}. Your site takes X seconds to load, ${bounceImpact}.\\n\\nAlso, here are some ${issueWord} I've identified on your hero section:\\n[IMAGE]\\n\\nWant me to walk you through the rest of the findings? Takes 15 minutes."
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
