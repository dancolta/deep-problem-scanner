import { DiagnosticResult } from '../scanner/types';
import { PromptContext, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS, IntroHook } from './types';

/**
 * Metrics to EXCLUDE from intro hook selection
 * - LCP: Now typically shows good scores, not useful for cold outreach
 * - Broken Links: Not impactful enough for intro hook
 */
const EXCLUDED_INTRO_METRICS = [
  'LCP (Visual Load Time)',
  'Page Speed',  // Legacy name
  'Broken Links',
];

/**
 * Map diagnostic names to intro hook templates
 * Structure: [observation, impact]
 */
const METRIC_HOOK_TEMPLATES: Record<string, { observation: string; impact: string }> = {
  'Mobile Friendliness': {
    observation: "Your site isn't optimized for mobile",
    impact: "that's likely costing you 50%+ of visitors who browse on their phones",
  },
  'CTA Analysis': {
    observation: "Your homepage doesn't have a clear call-to-action",
    impact: "that's likely costing you conversions from visitors who don't know what to do next",
  },
  'SEO Basics': {
    observation: "Your homepage has SEO issues",
    impact: "that's likely hurting your visibility in search results",
  },
};

/**
 * Find the best poor metric to use as intro hook
 * Excludes LCP and Broken Links, prioritizes failed metrics over warnings
 */
function findIntroHook(diagnostics: DiagnosticResult[]): IntroHook | undefined {
  // Filter to eligible metrics (not LCP, not Broken Links)
  const eligibleMetrics = diagnostics.filter(
    d => !EXCLUDED_INTRO_METRICS.includes(d.name)
  );

  // Find failed metrics first (most impactful)
  const failedMetrics = eligibleMetrics.filter(d => d.status === 'fail');
  const warningMetrics = eligibleMetrics.filter(d => d.status === 'warning');

  // Sort by score (lowest = worst = best for outreach)
  const sortedPoorMetrics = [...failedMetrics, ...warningMetrics].sort(
    (a, b) => a.score - b.score
  );

  // Find first metric that has a hook template
  for (const metric of sortedPoorMetrics) {
    const template = METRIC_HOOK_TEMPLATES[metric.name];
    if (template) {
      return {
        metricName: metric.name,
        observation: template.observation,
        impact: template.impact,
      };
    }
  }

  return undefined;
}

export const DEFAULT_EMAIL_TEMPLATE = `Generate a cold outreach email following this pattern. Adapt naturally based on the findings.

RECIPIENT:
- First name: {{firstName}}
- Company: {{companyName}}
- Domain: {{domain}}

SCAN FINDINGS:
- Number of issues found: {{issueCount}}
- Hero section issues: {{heroIssues}}
- Most critical: {{worstProblem}}
- Full diagnostics: {{diagnosticsSummary}}

INTRO HOOK (use this if provided):
{{introHookSection}}

---

EMAIL PATTERN:

Subject: [3-7 words, reference their main problem]

Hi {{firstName}},

{{introInstructions}}

Your hero section has some {{issueWord}} I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.

---

{{exampleSection}}

---

RULES:
1. Body: 75-100 words max (under 80 ideal). Be concise.
2. Subject: 3-7 words, specific to their problem
3. {{introRule}}
4. NO em dashes. Use commas instead.
5. {{heroSectionRule}}
6. CTA MUST be: "Want me to walk you through the rest of the findings? Takes 15 minutes."
7. NO signature - Gmail will add it automatically
8. Tone: Direct, expert, helpful
9. NO: ROI claims, pricing, buzzwords, "hope this finds you well"

SPACING RULES:
- After "hero section:" → single newline → [IMAGE] (NO blank line between text and image)
- After [IMAGE] → blank line → CTA (one blank line after image)

FORMAT: Respond ONLY with valid JSON:
{
  "subject": "your subject line",
  "body": "{{exampleBody}}"
}`;

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

  // Build dynamic intro sections based on whether we have a hook
  const hasIntroHook = !!context.introHook;

  let introHookSection: string;
  let introInstructions: string;
  let introRule: string;
  let heroSectionRule: string;
  let exampleSection: string;
  let exampleBody: string;

  if (hasIntroHook) {
    // We have a poor metric to use as intro
    const hook = context.introHook!;
    introHookSection = `Metric: ${hook.metricName}\nObservation: ${hook.observation}\nImpact: ${hook.impact}`;
    introInstructions = `[HOOK: Start with the metric observation and impact. Example: "${hook.observation}, ${hook.impact}."]`;
    introRule = `First sentence MUST follow this pattern: "${hook.observation}, ${hook.impact}."`;
    heroSectionRule = `Second paragraph MUST start with: "Your hero section has some {{issueWord}} I've flagged below:"`;
    exampleSection = `EXAMPLE:

Hi Sarah,

${hook.observation}, ${hook.impact}.

Your hero section has an issue I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.`;
    exampleBody = `Hi {{firstName}},\\n\\n${hook.observation}, ${hook.impact}.\\n\\nYour hero section has some {{issueWord}} I've flagged below:\\n[IMAGE]\\n\\nWant me to walk you through the rest of the findings? Takes 15 minutes.`;
  } else {
    // No poor metrics, skip intro and go straight to hero section
    introHookSection = `No poor metrics detected. Skip intro and focus on hero section issues.`;
    introInstructions = `[NO INTRO - Start directly with hero section issues]`;
    introRule = `NO intro sentence. Start directly with hero section.`;
    heroSectionRule = `First paragraph MUST be: "Your hero section has some {{issueWord}} I've flagged below:"`;
    exampleSection = `EXAMPLE (no intro, straight to hero):

Hi Sarah,

Your hero section has an issue I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.`;
    exampleBody = `Hi {{firstName}},\\n\\nYour hero section has some {{issueWord}} I've flagged below:\\n[IMAGE]\\n\\nWant me to walk you through the rest of the findings? Takes 15 minutes.`;
  }

  // Use custom template or default
  const template = customTemplate || DEFAULT_EMAIL_TEMPLATE;

  // Interpolate placeholders
  return template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{companyName\}\}/g, context.companyName)
    .replace(/\{\{domain\}\}/g, domain)
    .replace(/\{\{issueCount\}\}/g, String(issueCount))
    .replace(/\{\{heroIssues\}\}/g, context.annotationLabels.length > 0 ? context.annotationLabels.join(', ') : 'general issues')
    .replace(/\{\{worstProblem\}\}/g, context.worstProblem)
    .replace(/\{\{diagnosticsSummary\}\}/g, context.diagnosticsSummary)
    .replace(/\{\{issueWord\}\}/g, issueWord)
    .replace(/\{\{introHookSection\}\}/g, introHookSection)
    .replace(/\{\{introInstructions\}\}/g, introInstructions)
    .replace(/\{\{introRule\}\}/g, introRule)
    .replace(/\{\{heroSectionRule\}\}/g, heroSectionRule)
    .replace(/\{\{exampleSection\}\}/g, exampleSection)
    .replace(/\{\{exampleBody\}\}/g, exampleBody);
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

  // Extract load time from LCP diagnostic (kept for backwards compatibility)
  const lcpDiag = params.diagnostics.find(d =>
    d.name === 'LCP (Visual Load Time)' || d.name === 'Page Speed'
  );
  let loadTimeSeconds: number | undefined;
  if (lcpDiag?.details) {
    const match = lcpDiag.details.match(/(\d+\.?\d*)\s*s/);
    if (match) {
      loadTimeSeconds = parseFloat(match[1]);
    }
  }

  // Find best poor metric for intro hook (excludes LCP and Broken Links)
  const introHook = findIntroHook(params.diagnostics);

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
    introHook,
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
