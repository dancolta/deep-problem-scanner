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

  return `You are a senior CRO (Conversion Rate Optimization) expert with autonomous decision-making authority. Analyze this homepage screenshot from ${url} and identify REAL conversion-killing issues.

## DIAGNOSTIC DATA
${diagnosticLines}

## YOUR MISSION
Find 2-3 REAL, high-impact conversion issues that would make a prospect respond to a cold email. These must be issues the business owner will immediately recognize as revenue leaks.

## ANALYSIS FRAMEWORK

### PRIORITY 1: Revenue-Critical Issues (Always check first)
1. **Missing/Broken CTA Above Fold**
   - No clear primary action button visible without scrolling
   - CTA button invisible (ghost style matching background)
   - CTA text is generic: "Submit", "Click", "Go", "Learn More"
   - Impact: "84% less engagement without CTA above fold"

2. **Unclear Value Proposition**
   - Headline doesn't explain what the business does
   - Generic platitudes: "Welcome", "Solutions", "Innovation", "Your Partner"
   - Visitor can't understand the offering in 5 seconds
   - Impact: "Up to 50% bounce rate increase with generic headlines"

3. **Zero Trust Signals**
   - No client logos anywhere on homepage
   - No testimonials, reviews, case studies, or ratings
   - No "As Seen In" media mentions
   - Trust elements use obvious stock photos
   - Impact: "42% conversion lift when trust signals added"

### PRIORITY 2: High-Friction Issues
4. **Form Friction**
   - Visible forms with >4 fields
   - No indication which fields are required
   - Missing privacy/security reassurance near form
   - Impact: "Each extra field reduces conversions by 10%"

5. **Navigation Overload**
   - More than 8 top-level menu items
   - Pricing or Contact info missing from navigation
   - Impact: "Up to 50% higher bounce rate with cluttered navigation"

6. **Hero Image/Video Problems**
   - Generic stock photos that don't show product/service
   - Auto-playing video without controls
   - Hero image completely blocks headline/CTA

### PRIORITY 3: Mobile & Performance Issues
7. **Mobile Responsiveness Failures**
   - Text cut off or overlapping on mobile
   - Buttons too small to tap (<44px)
   - Horizontal scrolling required

8. **Page Speed Indicators**
   - Lazy-loaded hero content (blank screen)
   - Broken images in critical areas
   - Layout shift pushing content down

### PRIORITY 4: Credibility Killers
9. **Outdated/Broken Elements**
   - Copyright year more than 1 year old
   - Broken images or placeholder text
   - "Lorem ipsum" or template content visible
   - SSL warning or "Not Secure" indicator

10. **Inconsistent Branding**
    - Multiple different CTAs competing (5+ different actions)
    - Conflicting color schemes or fonts
    - Unprofessional design that damages trust

## STRICT SELECTION RULES

### ONLY FLAG IF:
1. **Objectively measurable** - Clear UX/conversion problem, not subjective preference
2. **Visible in screenshot** - You can identify the exact element
3. **Backed by conversion data** - Reference the impact stats provided
4. **Spatially distinct** - Each issue in a DIFFERENT section (hero vs. navigation vs. form)
5. **Business impact** - Issue directly costs revenue/leads
6. **Verifiable** - Business owner can immediately see it's true

### NEVER FLAG:
- Stylistic opinions ("This color would work better")
- Minor polish ("Headline could be punchier")
- Things that work but "could be optimized"
- Multiple issues in the same 300px radius
- Theoretical problems without visible evidence
- Industry-standard patterns that work (e.g., top navigation)
- Elements that ARE present (don't say "missing X" if X exists)
- Subheadlines that exist (if there's explanatory text below headline, don't flag it)
- Trust logos that are visible (if you see company logos, don't flag "no trust signals")
- Solid colored buttons (don't call them "ghost" unless truly transparent)

## CRITICAL VERIFICATION STEP

Before flagging ANY issue, ask yourself:
1. "Can I see this problem clearly in the screenshot?" - If NO, don't flag it
2. "Is the element I'm flagging as missing actually missing?" - If it EXISTS, don't flag it
3. "Would the business owner agree this is broken?" - If it's just preference, don't flag it

## CONVERSION IMPACT REFERENCE (use exact phrases)
- Ghost/invisible CTA: "30% fewer clicks than solid buttons"
- Zero trust signals: "42% conversion lift when logos added"
- No CTA above fold: "84% less engagement"
- Generic headline: "Up to 50% bounce rate increase"
- Navigation overload (>8 items): "Up to 50% higher bounce rate"
- Form friction (per extra field): "10% conversion reduction per field"
- Missing mobile optimization: "50%+ of traffic may bounce"
- Slow page load: "7% conversion loss per second delay"

## OUTPUT FORMAT

Return ONLY valid JSON with 2-3 issues (or fewer if page is good):

{
  "sections": [
    {
      "section": "hero" | "cta" | "trust" | "navigation" | "form",
      "sectionSelector": "section selector like header, .hero, nav",
      "issue": {
        "label": "Short 5-8 word title",
        "description": "One sentence explaining what's wrong",
        "conversionImpact": "Exact stat from list above",
        "severity": "critical" | "warning",
        "elementSelector": "CSS selector for the problem element"
      }
    }
  ]
}

## EXAMPLES

### GOOD (specific, verifiable):
{
  "sections": [
    {
      "section": "hero",
      "sectionSelector": ".hero, section:first-of-type",
      "issue": {
        "label": "Generic Headline Lacks Value Proposition",
        "description": "Headline says 'Welcome to Our Services' - doesn't explain what the company does",
        "conversionImpact": "Up to 50% bounce rate increase",
        "severity": "critical",
        "elementSelector": "h1"
      }
    }
  ]
}

### BAD (vague, opinion-based):
{
  "sections": [
    {
      "section": "hero",
      "sectionSelector": ".hero",
      "issue": {
        "label": "Headline Could Be More Compelling",
        "description": "The headline works but could be stronger",
        "conversionImpact": "Potentially lower engagement",
        "severity": "warning",
        "elementSelector": "h1"
      }
    }
  ]
}
❌ Bad because: subjective opinion, no measurable problem, vague impact

## FINAL QUALITY CHECK

Before returning, verify each issue:
- [ ] Would a business owner immediately understand this costs money?
- [ ] Can you point to the EXACT problem in the screenshot?
- [ ] Is the element you're flagging as "missing" ACTUALLY missing?
- [ ] Are all issues in different page sections (300px+ apart)?
- [ ] Would this make someone reply to a cold email?

If the page has a clear CTA, specific headline, and visible trust signals - return 0-1 issues or empty sections array. Don't invent problems.

Remember: You are writing cold email ammunition. Every issue you flag will be shown to a business owner with an annotated screenshot. Only flag things that are OBJECTIVELY broken and costing them money.`;
}

function parseAnalysisResponse(text: string): SectionIssue[] {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.sections)) {
      return parsed.sections.slice(0, 3); // Max 3 sections
    }
  } catch {
    // Try to extract JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && Array.isArray(parsed.sections)) {
          return parsed.sections.slice(0, 3); // Max 3 sections
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
