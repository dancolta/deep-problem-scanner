import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

export const DEFAULT_EMAIL_TEMPLATE = `Generate a cold outreach email following this pattern. Adapt naturally based on the findings.

RECIPIENT:
- First name: {{firstName}}
- Company: {{companyName}}
- Domain: {{domain}}

SCAN FINDINGS:
- Intro metric: {{introMetric}}
- Number of issues found: {{issueCount}}
- Hero section issues: {{heroIssues}}
- Most critical: {{worstProblem}}
- Full diagnostics: {{diagnosticsSummary}}

---

EMAIL PATTERN:

Subject: [3-7 words, reference their main problem]

Hi {{firstName}},

[HOOK: {{introHook}}]

Also, your hero section has some {{issueWord}} I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

EXAMPLE:

Hi Sarah,

{{exampleIntro}}

Also, your hero section has an issue I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

RULES:
1. Body: 75-100 words max (under 80 ideal). Be concise.
2. Subject: 3-7 words, specific to their problem
3. First sentence MUST follow the intro hook pattern provided
4. First sentence MUST include the impact statement
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
  "body": "Hi {{firstName}},\\n\\n{{introHook}}\\n\\nAlso, your hero section has some {{issueWord}} I've flagged below:\\n[IMAGE]\\n\\nWant me to walk you through the rest of the findings? Takes 15 minutes."
}`;

/**
 * Industry standard thresholds for PageSpeed metrics
 * Scores BELOW these thresholds are considered "poor" and can be used in outreach
 */
const INDUSTRY_THRESHOLDS: Record<string, number> = {
  'Performance Score': 50,      // Below 50 = poor performance
  'Accessibility Score': 70,    // Below 70 = accessibility issues
  'SEO Score': 80,              // Below 80 = SEO problems
  'Best Practices Score': 70,   // Below 70 = best practices issues
};

/**
 * Get impact message based on PageSpeed metric and score
 */
function getMetricImpact(metricName: string, score: number): string {
  const impacts: Record<string, string> = {
    'Performance Score': "that's likely costing you conversions before visitors even see your offer",
    'Accessibility Score': "that's likely turning away visitors who can't easily use your site",
    'SEO Score': "that's likely hurting your visibility in search results",
    'Best Practices Score': "that could be affecting your site's security and user trust",
  };
  return impacts[metricName] || "that could be affecting your conversions";
}

/**
 * Get intro sentence for a PageSpeed metric
 */
function getMetricIntro(metricName: string, score: number): string {
  const intros: Record<string, string> = {
    'Performance Score': `Your website scores ${score}/100 on performance`,
    'Accessibility Score': `Your website scores ${score}/100 on accessibility`,
    'SEO Score': `Your website scores ${score}/100 on SEO`,
    'Best Practices Score': `Your website scores ${score}/100 on best practices`,
  };
  return intros[metricName] || `Your website scores ${score}/100`;
}

/**
 * Find the poorest metric that is BELOW industry threshold
 * Returns null if all metrics meet standards (are "good")
 */
function findPoorestPoorMetric(diagnostics: DiagnosticResult[]): { name: string; score: number; details: string } | null {
  const pageSpeedMetrics = ['Performance Score', 'Accessibility Score', 'SEO Score', 'Best Practices Score'];

  // Filter to PageSpeed metrics that are BELOW their industry threshold
  const poorMetrics = diagnostics.filter(d => {
    if (!pageSpeedMetrics.includes(d.name)) return false;
    const threshold = INDUSTRY_THRESHOLDS[d.name] || 70;
    return d.score < threshold;
  });

  if (poorMetrics.length === 0) return null;

  // Return the worst one
  return poorMetrics.reduce((poorest, current) =>
    current.score < poorest.score ? current : poorest
  );
}

export function buildEmailPrompt(
  context: PromptContext,
  options?: Partial<EmailGenerationOptions>,
  customTemplate?: string
): string {
  const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };
  const firstName = context.contactName.split(' ')[0];

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

  // Parse diagnostics to find PageSpeed scores
  const parsedDiagnostics = context.diagnosticsSummary
    .split(' | ')
    .map(d => {
      const match = d.match(/^(.+?):\s*\w+\s*\((\d+)\/100\)\s*-\s*(.+)$/);
      if (match) {
        const score = parseInt(match[2], 10);
        return {
          name: match[1],
          status: (score >= 90 ? 'pass' : score >= 50 ? 'warning' : 'fail') as 'pass' | 'warning' | 'fail',
          details: match[3],
          score,
        };
      }
      return null;
    })
    .filter((d): d is DiagnosticResult => d !== null);

  // Find poorest metric that is BELOW industry threshold (genuinely poor)
  const poorestMetric = findPoorestPoorMetric(parsedDiagnostics);

  // Build intro hook from poorest poor metric
  let introHook: string;
  let introMetric: string;
  let exampleIntro: string;

  if (poorestMetric) {
    // Use the genuinely poor PageSpeed metric
    const intro = getMetricIntro(poorestMetric.name, poorestMetric.score);
    const impact = getMetricImpact(poorestMetric.name, poorestMetric.score);
    introHook = `${intro}, ${impact}.`;
    introMetric = `${poorestMetric.name}: ${poorestMetric.score}/100 (below industry threshold)`;
    exampleIntro = `Your website scores 35/100 on performance, that's likely costing you conversions before visitors even see your offer.`;
  } else {
    // All metrics are good - fallback to hero section focus
    introHook = `I ran a quick audit on your website and found some conversion opportunities.`;
    introMetric = `All PageSpeed metrics meet industry standards - focusing on hero section issues`;
    exampleIntro = `I ran a quick audit on your website and found some conversion opportunities.`;
  }

  // Use custom template or default
  const template = customTemplate || DEFAULT_EMAIL_TEMPLATE;

  // Interpolate placeholders
  return template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{companyName\}\}/g, context.companyName)
    .replace(/\{\{domain\}\}/g, domain)
    .replace(/\{\{introHook\}\}/g, introHook)
    .replace(/\{\{introMetric\}\}/g, introMetric)
    .replace(/\{\{exampleIntro\}\}/g, exampleIntro)
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

  // Extract load time from LCP diagnostic
  const pageSpeedDiag = params.diagnostics.find(d =>
    d.name === 'LCP (Visual Load Time)' || d.name === 'Page Speed'
  );
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
