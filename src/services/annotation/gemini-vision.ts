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

  return `You are a senior CRO (Conversion Rate Optimization) expert. Analyze this homepage screenshot from ${url}.

## DIAGNOSTIC DATA
${diagnosticLines}

## YOUR MISSION
Find 2-3 REAL conversion-killing issues on this page. Quality over quantity.

## STRICT RULES - READ CAREFULLY

### ONLY FLAG IF:
1. **Objectively measurable** - Not opinion, but clear UX/conversion problem
2. **Visible in screenshot** - You can point to the exact element
3. **Backed by data** - Use only the stats provided below
4. **Different locations** - Each issue must be in a DIFFERENT area of the page (spread out for clear annotations)

### NEVER FLAG:
- Stylistic preferences ("I'd make this blue")
- Minor improvements ("headline could be stronger")
- Things that exist but "could be better"
- Multiple issues in the same area

## ISSUE CATEGORIES

### 1. CTA PROBLEMS (section: "cta")
**Flag ONLY if:**
- Primary CTA button is MISSING from above the fold
- Button is ghost/outline AND same color as background (invisible)
- Button text is meaningless: "Submit", "Click", "Go"
**Selector:** "a[href*='start'], a[href*='demo'], a[href*='contact'], button.primary, .btn-primary, [class*='cta']"

### 2. TRUST SIGNALS (section: "trust")
**Flag ONLY if:**
- ZERO client logos anywhere visible
- ZERO testimonials, reviews, or social proof
- Trust elements use obvious stock photos
**Selector:** "[class*='logo'], [class*='client'], [class*='partner'], [class*='testimonial']"

### 3. VALUE PROPOSITION (section: "hero")
**Flag ONLY if:**
- Headline is generic fluff: "Welcome", "Solutions", "Services"
- No subheadline explaining what company does
- Visitor can't understand offering in 5 seconds
**Selector:** "h1, [class*='hero'] h1, section:first-of-type h1"

### 4. NAVIGATION (section: "navigation")
**Flag ONLY if:**
- More than 8 top-level menu items
- Contact or Pricing completely missing
**Selector:** "nav, header nav, [class*='nav']"

### 5. FORM FRICTION (section: "cta")
**Flag ONLY if:**
- Form has more than 4 fields visible
- Required fields not marked
- No privacy/trust message near form
**Selector:** "form, [class*='form']"

## CONVERSION STATS (use exactly as written)
- Ghost CTA: "30% fewer clicks than solid buttons"
- No trust signals: "42% conversion lift when logos added"
- No CTA above fold: "84% less engagement"
- Generic headline: "Up to 50% bounce rate increase"
- Too many nav items: "Up to 50% higher bounce rate"
- Form friction: "Each extra field reduces conversions 10%"

## OUTPUT FORMAT

Return ONLY valid JSON. Return 2-3 issues if found, fewer if page is good:

{
  "sections": [
    {
      "section": "hero" | "cta" | "trust" | "navigation",
      "sectionSelector": "<broad section selector>",
      "issue": {
        "label": "<5-8 word specific problem>",
        "conversionImpact": "<exact stat from above>",
        "severity": "critical" | "warning",
        "elementSelector": "<CSS selector for the SPECIFIC element>"
      }
    }
  ]
}

## GOOD vs BAD LABELS

✅ GOOD (specific, factual):
- "No CTA Button Above Fold"
- "Zero Client Logos Visible"
- "Ghost Button Blends Into Background"
- "Headline Says Nothing Specific"
- "9 Navigation Items Cause Confusion"

❌ BAD (vague, opinionated):
- "CTA Could Be Improved"
- "Add More Trust Elements"
- "Headline Needs Work"
- "Navigation Could Be Cleaner"

## FINAL CHECKLIST
Before returning, verify:
- [ ] Each issue is in a DIFFERENT screen area (for non-overlapping annotations)
- [ ] Each issue uses an EXACT stat from the list
- [ ] Each label is 5-8 words and specific
- [ ] No opinions, only measurable problems

If page is professionally designed with clear CTA, value prop, and trust signals - return 0-1 issues only.`;
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
