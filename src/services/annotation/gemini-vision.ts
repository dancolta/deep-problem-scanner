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

  return `You are analyzing the HERO SECTION ONLY (above-the-fold, no scrolling) of ${url}.

Your job: Find 1-2 obvious conversion killers that make the business owner say "damn, you're right."

## DIAGNOSTIC DATA
${diagnosticLines}

## WHAT TO SCAN FOR (Priority Order)

### TIER 1: Instant Revenue Killers (Check These First)

**1. Missing or Invisible Primary CTA**
- Look for: Main action button in hero area
- RED FLAGS:
  - No button visible at all above fold
  - Button is ghost/outline style in same color as background (literally invisible)
  - Button says generic garbage: "Submit", "Click Here", "Learn More", "Get Started"
- WHY IT MATTERS: "84% less engagement without visible CTA"

**2. WTF-Inducing Headline**
- Look for: Main H1 headline in hero
- RED FLAGS:
  - Generic corporate word salad: "Welcome", "Your Trusted Partner", "Solutions That Work", "Innovation Leader"
  - Doesn't answer: "What does this company actually DO?"
  - You can't figure out their business in 3 seconds
- WHY IT MATTERS: "Up to 50% bounce rate increase"

**3. Zero Trust Signals in Hero**
- Look for: Client logos, testimonials, trust badges, ratings, "As Seen In" in visible area
- RED FLAGS:
  - Completely empty - no social proof anywhere visible
  - Only a random stock photo of smiling people
  - Generic "trusted by businesses" claim with no logos
- ⚠️ CRITICAL: Scan the ENTIRE screenshot first. If you see ANY logos (GitLab, Google, Stripe, company names, etc.), DO NOT flag this.
- WHY IT MATTERS: "42% conversion lift when trust signals added"

### TIER 2: High-Friction Killers (Only if Tier 1 is clean)

**4. Form That Screams "I'll Waste Your Time"**
- Look for: Any form/signup visible in hero
- RED FLAGS:
  - More than 3 fields showing (Name, Email, Phone, Company, Message = TOO MUCH)
  - No asterisks or "required" labels
  - No "We respect your privacy" or security message
- WHY IT MATTERS: "Each extra field = 10% conversion drop"

**5. CTA Button Identity Crisis**
- Look for: Multiple competing CTAs in hero
- RED FLAGS:
  - 3+ different buttons all fighting for attention
  - Visitor has choice paralysis
- WHY IT MATTERS: "35% fewer conversions with multiple CTAs"

**6. Hero Image That Adds Zero Value**
- Look for: Main hero image/visual
- RED FLAGS:
  - Generic stock photo (handshake, laptop on desk, diverse office meeting)
  - Image tells you NOTHING about what product/service actually is
- WHY IT MATTERS: "27% higher engagement with product-specific visuals"

---

## STRICT SELECTION RULES

### STOP AND THINK:
1. **Would the business owner immediately recognize this as a problem?**
   - ✅ "Oh shit, we don't have a CTA button"
   - ❌ "Well, our headline could technically be better"

2. **Is this costing them money RIGHT NOW?**
   - ✅ Invisible CTA = visitors leave confused
   - ❌ "Blue would convert better than green" = speculation

3. **Can you point to it exactly in the screenshot?**
   - ✅ "This button right here says 'Submit'"
   - ❌ "The overall vibe is off"

### NEVER FLAG:
- "This could be improved" (only flag broken/missing)
- Color/font preferences
- Things that work but aren't "optimal"
- Anything you need to scroll to see
- Industry jargon issues (unless literally incomprehensible)
- Trust signals if ANY logos are visible (scan carefully!)
- Headlines that explain what the company does (even if not "perfect")

---

## DECISION TREE (Follow This Order)

1. Is there a clear CTA button above fold?
   NO → FLAG IT → Continue to find one more
   YES → Continue

2. Does the headline explain what they do?
   NO → FLAG IT → Stop if you have 2 issues
   YES → Continue

3. Are there ANY trust signals (logos/testimonials) visible?
   NO → FLAG IT → Stop
   YES → Continue

4. Is there a form with 4+ fields?
   YES → FLAG IT
   NO → Continue

5. Are there 3+ competing CTAs?
   YES → FLAG IT
   NO → Continue

6. Is the hero image generic stock photo?
   YES → FLAG IT
   NO → NO ISSUES FOUND (don't force it)

---

## OUTPUT FORMAT

Return ONLY valid JSON with 1-2 issues max (or empty if page is good):

{
  "sections": [
    {
      "section": "cta",
      "sectionSelector": ".hero, section:first-of-type",
      "issue": {
        "label": "No CTA Button Visible Above Fold",
        "description": "Visitors see your hero section but have no clear next step - no 'Book Demo' or primary action button visible",
        "conversionImpact": "84% less engagement",
        "severity": "critical",
        "elementSelector": ".hero, section:first-of-type"
      }
    }
  ]
}

### Field Mapping:
- **section**: "cta" | "hero" | "trust" | "form"
- **label**: Short 5-8 word title (what's wrong)
- **description**: One sentence explaining the problem
- **conversionImpact**: Exact stat from above (e.g., "84% less engagement")
- **severity**: "critical" for Tier 1, "warning" for Tier 2

---

## QUALITY CONTROL

Before returning, ask yourself:

1. **The "Grateful" Test**: Would they thank you for pointing this out?
2. **The "Screenshot" Test**: Can you show them exactly what's wrong?
3. **The "Money" Test**: Is this costing them actual conversions?
4. **The "Obvious" Test**: Will they say "yep, that's broken" not "hmm, maybe"?

If you can't answer YES to all 4 → Don't flag it.

---

## EXAMPLES

### ✅ GOOD (Flag This)
{
  "sections": [
    {
      "section": "hero",
      "sectionSelector": "h1",
      "issue": {
        "label": "Generic Headline Doesn't Explain Business",
        "description": "Headline says 'Welcome to TechCorp Solutions' - visitor can't tell if you're selling software, consulting, or hardware",
        "conversionImpact": "Up to 50% bounce rate increase",
        "severity": "critical",
        "elementSelector": "h1"
      }
    }
  ]
}

### ✅ GOOD (Flag This)
{
  "sections": [
    {
      "section": "cta",
      "sectionSelector": ".hero",
      "issue": {
        "label": "No CTA Button Visible in Hero",
        "description": "Large hero image and headline but no button anywhere - visitors see your pitch but have no way to take action",
        "conversionImpact": "84% less engagement",
        "severity": "critical",
        "elementSelector": ".hero"
      }
    }
  ]
}

### ❌ BAD (Don't Flag)
- "Headline could be more benefit-focused" → The headline WORKS, "could be better" ≠ broken
- "Orange buttons convert better" → Color preference = speculation
- "Missing trust signals" when logos ARE visible → Scan the screenshot first!

---

## REMEMBER

You're creating cold email ammunition. Every issue you flag will be:
1. Shown to a business owner in an annotated screenshot
2. Used as the reason they should reply to your email

**Quality > Quantity. 1 perfect issue > 3 mediocre ones.**

Only flag things that are OBVIOUSLY broken and costing them money. If the page has a clear CTA, specific headline, and visible trust signals - return empty sections array. Don't invent problems.`;
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
