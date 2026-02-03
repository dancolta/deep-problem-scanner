import { GoogleGenerativeAI } from '@google/generative-ai';
import { DiagnosticResult } from '../scanner/types';
import {
  AnnotationCoord,
  AnnotationOptions,
  AnnotationResult,
  AnnotationSeverity,
  DEFAULT_ANNOTATION_OPTIONS,
} from './types';

export interface SectionIssue {
  section: 'hero' | 'cta' | 'trust' | 'pricing' | 'testimonials' | 'footer' | 'navigation';
  sectionSelector: string; // CSS selector to capture this section
  issue: {
    label: string;
    description: string;
    conversionImpact: string;
    severity: AnnotationSeverity;
    elementSelector: string; // CSS selector for the specific problematic element within section
  };
}

export interface AnalysisResult {
  sections: SectionIssue[];
  rawAnalysis: string;
}

function buildAnalysisPrompt(
  url: string,
  diagnostics: DiagnosticResult[]
): string {
  const diagnosticLines = diagnostics
    .map((d) => `- ${d.name}: ${d.status} (score: ${d.score}/100) - ${d.details}`)
    .join('\n');

  return `You are an expert homepage conversion auditor. Analyze this homepage screenshot from ${url}.

## DIAGNOSTIC DATA
${diagnosticLines}

## YOUR TASK
Identify the TOP 2 most critical conversion-killing issues on this page. Each issue must be:
1. CLEARLY VISIBLE in the screenshot
2. A REAL conversion problem (not minor nitpicks)
3. Located in a SPECIFIC page section

## STRICT ISSUE CRITERIA (only flag if truly problematic)

### HERO SECTION ISSUES (section: "hero", selector: "section:first-of-type, .hero, [class*='hero'], header + section, main > section:first-child")
- **Flag if**: Headline is completely generic ("Welcome", "Solutions") with NO value proposition
- **Flag if**: NO CTA button visible above the fold at all
- **Flag if**: Obvious stock photo (handshake, generic office) that damages credibility
- **Do NOT flag**: Minor headline improvements, stylistic preferences

### CTA BUTTON ISSUES (section: "cta", selector: "[class*='cta'], .btn-primary, button[type='submit'], a[href*='contact'], a[href*='demo'], a[href*='signup']")
- **Flag if**: Button is ghost/outline style AND blends into background (hard to see)
- **Flag if**: Button text is completely generic ("Submit", "Click Here") with no value
- **Flag if**: Primary CTA is missing or hidden
- **Do NOT flag**: Minor color preferences, small size differences

### TRUST SIGNALS (section: "trust", selector: "[class*='logo'], [class*='client'], [class*='partner'], [class*='trust'], [class*='testimonial']")
- **Flag if**: ZERO client logos, badges, or social proof visible on entire page
- **Flag if**: Testimonials are clearly fake (stock photos, no names)
- **Do NOT flag**: If some trust elements exist but could be "better"

### NAVIGATION (section: "navigation", selector: "nav, header, [class*='nav'], [class*='header']")
- **Flag if**: More than 8 menu items creating confusion
- **Flag if**: Critical pages (Contact, Pricing) are hidden or missing
- **Do NOT flag**: Minor label improvements

## CONVERSION IMPACT STATS (use these exactly)
- Ghost/outline CTA buttons: "30% fewer clicks than solid buttons"
- Missing trust signals: "42% conversion lift when logos added"
- No CTA above fold: "84% less engagement"
- Generic headline: "Up to 50% bounce rate increase"
- Missing testimonials: "34% conversion increase when added"
- Confusing navigation: "Up to 50% higher bounce rate"

## OUTPUT FORMAT

Return ONLY valid JSON with exactly 2 issues (or fewer if page is well-optimized):

{
  "sections": [
    {
      "section": "hero" | "cta" | "trust" | "pricing" | "testimonials" | "footer" | "navigation",
      "sectionSelector": "<CSS selector to capture this entire section>",
      "issue": {
        "label": "<SPECIFIC problem statement - see examples>",
        "conversionImpact": "<exact stat from list above>",
        "severity": "critical" | "warning",
        "elementSelector": "<CSS selector for the SPECIFIC problematic element>"
      }
    }
  ]
}

## LABEL EXAMPLES (be specific and direct)

GOOD labels (specific, actionable):
- "No Client Logos Above Fold"
- "Missing CTA Button In Hero"
- "Generic 'Welcome' Headline"
- "Ghost Button Hard To See"
- "No Social Proof Visible"
- "Too Many Nav Menu Items"
- "No Contact Link In Header"

BAD labels (too vague):
- "Headline Could Be Better"
- "Trust Signals Missing"
- "CTA Issues"

## ELEMENT SELECTOR PATTERNS

For HEADLINE issues: "h1, .hero h1, section:first-of-type h1, [class*='hero'] h1"
For CTA/BUTTON issues: "a[href*='start'], a[href*='demo'], button.primary, .btn-primary"
For TRUST/LOGO issues: "[class*='logo'] img, [class*='client'] img, [class*='trust']"
For NAVIGATION issues: "nav, header nav, [class*='nav']"

## EXAMPLES

Good issue:
{
  "section": "trust",
  "sectionSelector": "section:first-of-type",
  "issue": {
    "label": "No Client Logos Above Fold",
    "conversionImpact": "42% conversion lift when logos added",
    "severity": "warning",
    "elementSelector": "[class*='hero'], section:first-of-type"
  }
}

Bad issue (too vague):
{
  "section": "hero",
  "issue": {
    "label": "Headline Could Be More Compelling",
    ...
  }
}

IMPORTANT: Only return issues that would meaningfully impact conversions. If the page is decent, return fewer issues or an empty array.`;
}

function parseAnalysisResponse(text: string): SectionIssue[] {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.sections)) {
      return parsed.sections.slice(0, 2); // Max 2 sections
    }
  } catch {
    // Try to extract JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && Array.isArray(parsed.sections)) {
          return parsed.sections.slice(0, 2);
        }
      } catch {
        // Could not parse
      }
    }
  }
  return [];
}

export async function analyzePageSections(
  screenshotBuffer: Buffer,
  diagnostics: DiagnosticResult[],
  url: string
): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('[gemini-vision] API key present:', !!apiKey);

  if (!apiKey) {
    console.error('[gemini-vision] GEMINI_API_KEY is not set');
    return { sections: [], rawAnalysis: 'Error: API key not configured' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = buildAnalysisPrompt(url, diagnostics);
  const realBuffer = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer);
  const base64Image = realBuffer.toString('base64');

  console.log('[gemini-vision] Analyzing page sections...');

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
    ]);

    const rawText = result.response.text();
    console.log('[gemini-vision] Analysis response length:', rawText.length);

    const sections = parseAnalysisResponse(rawText);
    console.log('[gemini-vision] Issues found:', sections.length, sections.map(s => s.issue?.label));

    return { sections, rawAnalysis: rawText };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[gemini-vision] Analysis failed:', message);
    return { sections: [], rawAnalysis: `Error: ${message}` };
  }
}

// Legacy function for backward compatibility
function buildPrompt(
  url: string,
  diagnostics: DiagnosticResult[],
  opts: AnnotationOptions
): string {
  return buildAnalysisPrompt(url, diagnostics);
}

const VALID_SEVERITIES: AnnotationSeverity[] = ['critical', 'warning', 'info'];

function validateAnnotations(
  raw: unknown[],
  opts: AnnotationOptions
): AnnotationCoord[] {
  if (!Array.isArray(raw)) return [];

  const validated: AnnotationCoord[] = [];

  for (const item of raw.slice(0, opts.maxAnnotations)) {
    if (!item || typeof item !== 'object') continue;

    const a = item as Record<string, unknown>;

    let x = typeof a.x === 'number' ? a.x : 100;
    let y = typeof a.y === 'number' ? a.y : 100;
    let width = typeof a.width === 'number' ? a.width : 200;
    let height = typeof a.height === 'number' ? a.height : 80;
    const label = typeof a.label === 'string' ? a.label : 'Issue';
    const severity: AnnotationSeverity = VALID_SEVERITIES.includes(a.severity as AnnotationSeverity)
      ? (a.severity as AnnotationSeverity)
      : 'warning';
    const description = typeof a.description === 'string' ? a.description : '';
    const conversionImpact = typeof a.conversionImpact === 'string' ? a.conversionImpact : undefined;

    width = Math.max(100, Math.min(width, opts.screenshotWidth - 50));
    height = Math.max(50, Math.min(height, opts.screenshotHeight - 50));
    x = Math.max(10, Math.min(x, opts.screenshotWidth - width - 10));
    y = Math.max(10, Math.min(y, opts.screenshotHeight - height - 10));

    validated.push({ x, y, width, height, label, severity, description, conversionImpact });
  }

  return validated;
}

function parseJsonResponse(text: string): { annotations: unknown[] } | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.annotations)) {
      return parsed;
    }
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && Array.isArray(parsed.annotations)) {
          return parsed;
        }
      } catch {
        // Could not parse
      }
    }
  }
  return null;
}

export async function detectAnnotations(
  screenshotBuffer: Buffer,
  diagnostics: DiagnosticResult[],
  url: string,
  options?: Partial<AnnotationOptions>
): Promise<AnnotationResult> {
  const opts: AnnotationOptions = { ...DEFAULT_ANNOTATION_OPTIONS, ...options };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { annotations: [], rawAnalysis: 'Error: GEMINI_API_KEY not configured', problemCount: 0 };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = buildPrompt(url, diagnostics, opts);
  const realBuffer = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer);
  const base64Image = realBuffer.toString('base64');

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
    ]);

    const rawText = result.response.text();
    const parsed = parseJsonResponse(rawText);

    if (!parsed) {
      return { annotations: [], rawAnalysis: rawText, problemCount: 0 };
    }

    const annotations = validateAnnotations(parsed.annotations, opts);
    return { annotations, rawAnalysis: rawText, problemCount: annotations.length };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { annotations: [], rawAnalysis: `Error: ${message}`, problemCount: 0 };
  }
}
