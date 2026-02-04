import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';

/**
 * Buzzword blacklist - words/phrases that should never appear in generated emails.
 * Each entry has a regex pattern and its replacement.
 * Order matters: more specific patterns (e.g., "hero section") should come before general ones (e.g., "hero").
 */
export const BUZZWORD_BLACKLIST: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bhero\s+section\b/gi, replacement: 'above-the-fold area' },
  { pattern: /\bhero\b/gi, replacement: 'header' },
  // Add more blacklisted buzzwords here as needed:
  // { pattern: /\bsynergy\b/gi, replacement: '' },
  // { pattern: /\bleverage\b/gi, replacement: 'use' },
];

/**
 * CTA options for rotation - alternates between emails
 */
export const CTA_OPTIONS = [
  "Want me to walk you through the rest of the findings? Takes 15 minutes.",
  "Worth a 15-min call to see if the other issues are worth fixing?"
];

/**
 * User-editable email template (simplified version for UI)
 * This is what users see and can customize in the Setup page.
 * The core prompt logic wraps this template with AI instructions.
 */
export const USER_EMAIL_TEMPLATE = `Subject: [3-7 words, reference their main problem]

Hi {{firstName}},

{{introHook}}

[TRANSITION_SENTENCE]
[IMAGE]

{{cta}}`;

/**
 * Core AI prompt template - contains instructions for the AI.
 * The {{emailPattern}} placeholder is replaced with the user's custom template.
 */
export const CORE_PROMPT_TEMPLATE = `Generate a cold outreach email following this pattern. Adapt naturally based on the findings.

RECIPIENT:
- First name: {{firstName}}
- Company: {{companyName}}
- Domain: {{domain}}

SCAN FINDINGS:
- Intro metric: {{introMetric}}
- Number of issues found: {{issueCount}}
- Most critical: {{worstProblem}}
- Full diagnostics: {{diagnosticsSummary}}

---

EMAIL PATTERN:

{{emailPattern}}

---

EXAMPLE:

Hi Sarah,

{{exampleIntro}}

[TRANSITION_SENTENCE]
[IMAGE]

{{cta}}

---

SUBJECT LINE FORMULAS (pick one based on available data):

Formula 1 - Problem + Metric (when you have specific numbers):
- "your site takes 4.3 seconds to load"
- "homepage loads in 4.3 seconds"

Formula 2 - Problem + Impact (emphasize business cost):
- "your homepage might be losing conversions"
- "hero section could be costing you leads"

Formula 3 - Just the Metric (maximum curiosity):
- "4.3 seconds"
- "47 http requests"

Formula 4 - Casual Observation (fallback when no metric):
- "noticed a few issues on your site"
- "quick thing about your homepage"

SUBJECT LINE RULES:
- ALL LOWERCASE (no caps except proper nouns)
- NO PUNCTUATION (no periods, exclamation marks, question marks)
- 3-7 words maximum
- NO clickbait ("you won't believe", "shocking")
- NO salesy words ("free", "opportunity", "limited time")

BODY RULES:
1. Body: 75-100 words max (under 80 ideal). Be concise.
2. First sentence MUST follow the intro hook pattern provided
3. First sentence MUST include the impact statement if a metric is provided
4. NO em dashes. Use commas instead.
5. Second paragraph: Output exactly "[TRANSITION_SENTENCE]" - this is a placeholder that will be filled in later.
6. CTA MUST be exactly: "{{cta}}"
7. NO signature - Gmail will add it automatically
8. Tone: Direct, expert, helpful
9. NO: ROI claims, pricing, buzzwords, "hope this finds you well"
10. NEVER use "hero" or "hero section" in the OPENING sentence. The transition sentence will mention "hero section" separately, so avoid it in your intro to prevent repetition.

SPACING RULES:
- After [TRANSITION_SENTENCE] → single newline → [IMAGE] (NO blank line between text and image)
- After [IMAGE] → blank line → CTA (one blank line after image)

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line",
  "body": "Hi {{firstName}},\\n\\n[Your intro sentence here]\\n\\n[TRANSITION_SENTENCE]\\n[IMAGE]\\n\\n{{cta}}"
}`;

/**
 * Industry standard thresholds for PageSpeed metrics
 * Scores BELOW these thresholds are considered "poor" and can be used in outreach
 */
const INDUSTRY_THRESHOLDS: Record<string, number> = {
  'Performance Score': 80,      // Below 80 = flag it
  'Accessibility Score': 80,    // Below 80 = flag it
  'SEO Score': 80,              // Below 80 = flag it
  'Best Practices Score': 80,   // Below 80 = flag it
};

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
  customTemplate?: string,
  emailIndex: number = 0
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
  let secondParagraph: string;

  if (poorestMetric) {
    // Use the genuinely poor PageSpeed metric - let AI craft the impact statement
    const intro = getMetricIntro(poorestMetric.name, poorestMetric.score);
    introHook = `${intro}, [add a brief, natural impact statement about how this affects their business].`;
    introMetric = `${poorestMetric.name}: ${poorestMetric.score}/100 (below industry threshold)`;
    exampleIntro = `Your website scores 35/100 on performance, that's likely costing you conversions.`;
    secondParagraph = `Also, your hero section has some ${issueWord} I've flagged below:`;
  } else {
    // All metrics are good - fallback (no hero mention in intro, save it for second paragraph)
    introHook = `I analyzed your site and spotted some conversion gaps that could be impacting your results.`;
    introMetric = `All PageSpeed metrics meet industry standards - focusing on visual design issues`;
    exampleIntro = `I analyzed your site and spotted some conversion gaps that could be impacting your results.`;
    secondParagraph = `Your hero section has some ${issueWord} I've flagged below:`;
  }

  // Select CTA based on email index (rotates between options)
  const cta = CTA_OPTIONS[emailIndex % CTA_OPTIONS.length];

  // Use user's custom email pattern or default
  const emailPattern = customTemplate || USER_EMAIL_TEMPLATE;

  // Build final prompt: core AI instructions + user's email pattern
  const template = CORE_PROMPT_TEMPLATE.replace(/\{\{emailPattern\}\}/g, emailPattern);

  // Interpolate placeholders (NOTE: secondParagraph is NOT interpolated here -
  // it's replaced AFTER AI generation to hide "hero" from the AI)
  return template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{companyName\}\}/g, context.companyName)
    .replace(/\{\{domain\}\}/g, domain)
    .replace(/\{\{introHook\}\}/g, introHook)
    .replace(/\{\{introMetric\}\}/g, introMetric)
    .replace(/\{\{exampleIntro\}\}/g, exampleIntro)
    .replace(/\{\{issueCount\}\}/g, String(issueCount))
    .replace(/\{\{worstProblem\}\}/g, context.worstProblem)
    .replace(/\{\{diagnosticsSummary\}\}/g, context.diagnosticsSummary)
    .replace(/\{\{issueWord\}\}/g, issueWord)
    .replace(/\{\{cta\}\}/g, cta);
}

/**
 * Get the transition sentence (second paragraph) for an email.
 * This is kept separate from buildEmailPrompt to hide "hero" from the AI.
 */
export function getTransitionSentence(context: PromptContext): string {
  const issueCount = context.annotationLabels.length || context.problemCount || 1;
  const issueWord = issueCount === 1 ? 'issue' : 'issues';

  // Check if we have a poor metric (determines "Also," prefix)
  const parsedDiagnostics = context.diagnosticsSummary
    .split(' | ')
    .map(d => {
      const match = d.match(/^(.+?):\s*\w+\s*\((\d+)\/100\)/);
      if (match) {
        return { name: match[1], score: parseInt(match[2], 10) };
      }
      return null;
    })
    .filter((d): d is { name: string; score: number } => d !== null);

  const pageSpeedMetrics = ['Performance Score', 'Accessibility Score', 'SEO Score', 'Best Practices Score'];
  const hasPoorMetric = parsedDiagnostics.some(d =>
    pageSpeedMetrics.includes(d.name) && d.score < 80
  );

  return `Also, your hero section has some ${issueWord} I've flagged below:`;
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
