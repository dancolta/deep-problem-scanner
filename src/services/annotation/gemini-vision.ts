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

  return `You are analyzing the HERO SECTION (above-the-fold) of ${url}.

Find 1-3 issues that hurt conversions. Be practical - most websites have at least one issue worth fixing.

## DIAGNOSTIC DATA
${diagnosticLines}

## WHAT TO SCAN FOR

### Category 1: CTA Problems (Check First)

**Missing/Weak Primary CTA**
- ✅ FLAG if:
  - No button at all in hero
  - Button text is vague: "Learn More", "Click Here", "Submit", "Get Started" (without context)
  - Multiple buttons competing (3+ CTAs with equal visual weight)
  - CTA is ghost/outline style that blends into background
- Impact: "84% less engagement without clear CTA"

**Example Good Flag**:
- Button says "Learn More" → Too generic, doesn't tell visitor what happens next
- No button visible → Visitor doesn't know what action to take

### Category 2: Unclear Value Proposition

**Generic or Confusing Headline**
- ✅ FLAG if:
  - Headline is pure fluff: "Welcome", "Your Partner in Success", "Solutions That Work"
  - After reading headline + subheadline, you STILL don't know what they sell/do
  - Headline is cutoff or hidden by overlay
- Impact: "Up to 50% bounce rate increase"

**Example Good Flag**:
- "Innovation Made Simple" → Visitor has no clue what product/service this is
- "Welcome to TechCorp" → Tells you the company name but not what they do

### Category 3: Missing Trust Signals

**Zero Social Proof in Hero**
- ✅ FLAG if:
  - No client logos visible
  - No testimonials, reviews, or ratings shown
  - No trust badges ("As Seen In", certifications, awards)
  - Large empty space where logos could/should be
- Impact: "42% conversion lift when trust added"

**Example Good Flag**:
- Hero has headline, CTA, image... but zero indication anyone uses this product
- Blank space under hero where "Trusted by X companies" should be

### Category 4: Form Friction (If form is visible)

**Intimidating Form**
- ✅ FLAG if:
  - Form shows 5+ fields at once
  - Asks for phone number + company + role + budget without explanation
  - No privacy message or security indicators
- Impact: "10% drop per extra field"

### Category 5: Poor Visual Hierarchy

**Confusing Layout**
- ✅ FLAG if:
  - Can't tell what to look at first (everything same size/weight)
  - Headline is smaller than body text
  - CTA button is tiny and easy to miss
  - Important text is cut off or overlapping
- Impact: "35% better engagement with clear hierarchy"

### Category 6: Generic Stock Imagery

**Meaningless Hero Image**
- ✅ FLAG if:
  - Obvious stock photo (handshake, laptop, diverse meeting)
  - Image could work for literally any business
  - No product screenshot, demo, or service visualization
- Impact: "27% higher engagement with relevant visuals"

---

## HOW TO EVALUATE

### Ask yourself:
1. **Is this actually a problem?** (Yes = visitor confusion/friction, No = preference)
2. **Would fixing this likely improve results?** (Yes = clearer action/value, No = minor polish)
3. **Can I explain it in one sentence?** (Yes = clear issue, No = too vague)

### Flag it if 2/3 are "Yes"

---

## WHAT NOT TO FLAG

❌ **Stylistic preferences**:
- "Blue would work better than green"
- "This font isn't my favorite"
- "Image could be higher resolution"

❌ **Minor optimization ideas**:
- "Headline could be stronger" (if it's already clear what they do)
- "CTA could be bigger" (if it's already visible)
- "Could add one more logo" (if they already have some)

❌ **Things that work fine**:
- Standard top navigation (even if it has 6-7 items)
- Common patterns (logo top-left, nav top-right)
- Professional but simple design

---

## DECISION FLOWCHART

Look at hero section - what stands out as broken or missing?

**Check CTA:**
- Is there a button? → NO = FLAG IT
- Is button text generic/vague? → YES = FLAG IT
- Are 3+ buttons competing? → YES = FLAG IT

**Check Headline:**
- Can you tell what they sell in 5 seconds? → NO = FLAG IT
- Is it pure fluff with no substance? → YES = FLAG IT

**Check Trust:**
- Any logos/testimonials visible? → NO = FLAG IT
- Large empty space where proof should be? → YES = FLAG IT

**Check Form (if visible):**
- 5+ fields showing? → YES = FLAG IT

**Check Visuals:**
- Generic stock photo that could be on any site? → YES = FLAG IT
- Layout confusing or text overlapping? → YES = FLAG IT

**Result:**
- Found 1-3 issues? → RETURN THEM
- Found 0 issues? → Return the LEAST optimized element with mild phrasing
- Found 4+ issues? → Return the TOP 3 most impactful

---

## EXAMPLES - Real Scenarios

### Example 1: SaaS Homepage
**Hero has**: Logo, "Transform Your Workflow" headline, paragraph of text, "Learn More" button

**FLAG**:
1. Generic headline - doesn't say it's project management software (critical)
2. Vague CTA - "Learn More" doesn't tell what happens next (warning)
3. No client logos visible (warning)

### Example 2: E-commerce Homepage
**Hero has**: Product photo, "Shop Now" button, "Premium Quality Products" headline, client testimonial

**FLAG**:
1. Generic headline could be more specific about what products (warning)

### Example 3: Consulting Site
**Hero has**: Stock photo of business meeting, "Your Success Partner" headline, large contact form with 8 fields

**FLAG**:
1. Meaningless headline - "Your Success Partner" says nothing (critical)
2. Form friction - 8 fields is intimidating (critical)
3. Generic stock imagery - business meeting photo (warning)

---

## CALIBRATION GUIDE

**If you're finding 0 issues on most sites** → You're being too strict
- Loosen up: "Learn More" IS a weak CTA even if button exists
- Generic headlines DO hurt even if technically readable

**If you're flagging 4+ issues per site** → You're being too picky
- Tighten up: Return only the TOP 3 most impactful issues

**Sweet spot**: 1-3 issues that the business owner will immediately recognize as worth fixing

---

## OUTPUT FORMAT

Return ONLY valid JSON with 1-3 issues:

{
  "sections": [
    {
      "section": "cta",
      "sectionSelector": ".hero, section:first-of-type",
      "issue": {
        "label": "Vague CTA - Learn More Doesn't Convert",
        "description": "Button says 'Learn More' which doesn't tell visitors what happens when they click - request demo? see pricing? read blog?",
        "conversionImpact": "84% less engagement without clear CTA",
        "severity": "critical",
        "elementSelector": "a.cta, button.primary, .hero a, .hero button"
      }
    },
    {
      "section": "hero",
      "sectionSelector": "h1",
      "issue": {
        "label": "Generic Headline Lacks Value Proposition",
        "description": "Headline says 'Transform Your Workflow' but doesn't explain what the product actually does",
        "conversionImpact": "Up to 50% bounce rate increase",
        "severity": "critical",
        "elementSelector": "h1"
      }
    }
  ]
}

### Field Mapping:
- **section**: "cta" | "hero" | "trust" | "form" | "visual"
- **label**: Short 5-8 word title (what's wrong)
- **description**: One sentence explaining the problem clearly
- **conversionImpact**: Exact stat from above
- **severity**: "critical" or "warning"
- **elementSelector**: CSS selector for the problem element

---

## REMEMBER

You're finding real problems that:
1. A business owner will recognize immediately
2. Are costing them conversions right now
3. Can be shown clearly in an annotated screenshot
4. Are worth discussing in a sales conversation

**Most websites have at least one issue.** Don't be so strict that you return nothing. Quality matters, but 1-3 real issues is the goal.`;
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
