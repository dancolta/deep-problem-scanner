import { GoogleGenerativeAI } from '@google/generative-ai';
import { DiagnosticResult } from '../scanner/types';
import {
  AnnotationCoord,
  AnnotationOptions,
  AnnotationResult,
  AnnotationSeverity,
  DEFAULT_ANNOTATION_OPTIONS,
} from './types';

// Visual inventory of what Gemini actually sees
export interface VisualInventory {
  buttons: Array<{ exactText: string; style: string; colorScheme: string }>;
  headlines: { h1: string | null; subheadline: string | null };
  trustSignals: {
    companyLogos: string[];
    customerCount: string | null;
    hasTestimonials: boolean;
    badges: string[];
  };
  heroImage: {
    type: string;
    description: string;
    appearsGenericStock: boolean;
  } | null;
}

// Issue that must reference the inventory
export interface GroundedIssue {
  inventoryRef: string; // MUST quote from inventory
  section: string;
  label: string;
  description: string;
  severity: string;
  conversionImpact: string;
  elementSelector: string;
}

export interface SectionIssue {
  section: 'hero' | 'cta' | 'trust' | 'pricing' | 'testimonials' | 'footer' | 'navigation';
  sectionSelector: string;
  issue: {
    label: string;
    description: string;
    conversionImpact: string;
    severity: AnnotationSeverity;
    elementSelector: string;
    inventoryRef?: string;
  };
}

export interface AnalysisResult {
  sections: SectionIssue[];
  rawAnalysis: string;
  inventory?: VisualInventory;
}

function buildAnalysisPrompt(
  url: string,
  diagnostics: DiagnosticResult[]
): string {
  const diagnosticLines = diagnostics
    .map((d) => `- ${d.name}: ${d.status} (score: ${d.score}/100) - ${d.details}`)
    .join('\n');

  return `You are analyzing the HERO SECTION (above-the-fold) of ${url}.

This is a TWO-PHASE analysis. You MUST complete Phase 1 before Phase 2.

## DIAGNOSTIC DATA
${diagnosticLines}

---

## PHASE 1: VISUAL INVENTORY (Required First)

Before analyzing anything, you MUST inventory exactly what you see. Be precise and literal.

### 1A. BUTTONS
List every button/CTA visible in the hero section:
- Write the EXACT text on each button (copy it exactly)
- Describe the style (solid/outline/ghost)
- Describe the color scheme (e.g., "blue solid", "white outline on dark")

If no buttons are visible, write: "none visible"

### 1B. HEADLINES
- H1 (main headline): Copy the exact text, or "none visible"
- Subheadline: Copy the exact text, or "none visible"

### 1C. TRUST SIGNALS
Look carefully at the ENTIRE screenshot for ANY of these:
- Company/client logos (list company names you can identify)
- Customer count text (e.g., "Trusted by 10,000+ companies")
- Testimonial quotes or review stars
- Certification badges or awards

If you find ANY trust signal, list it. If none found, write: "none visible"

### 1D. HERO IMAGE
- What type of image is shown? (product screenshot, photo, illustration, none)
- Brief description of what it shows
- Does it appear to be generic stock photography? (yes/no)

---

## PHASE 2: GROUNDED ANALYSIS

Now analyze ONLY based on what you inventoried above. Every issue MUST reference your inventory.

### CTA ANALYSIS

**ONLY flag if ALL of these are true:**
1. Your inventory shows a button exists
2. The button text is EXACTLY one of: "Submit", "Click Here", "Go", "Continue", "Next", or "Learn More" (alone)

**DO NOT flag if button text includes specifics like:**
- "Get a Demo", "Start Free Trial", "Book a Call", "Get Started", "See Pricing", "Request Quote", "Shop Now", "Download Now", "Join Waitlist", "Try Free", "Sign Up Free"

**NEVER flag "missing CTA" if your inventory shows ANY button exists.**

### HEADLINE ANALYSIS

**ONLY flag if:**
Your inventory shows the H1 and subheadline do NOT answer: "What product/service does this company sell?"

Test: Can you complete "This company sells ___" after reading the headline + subheadline?
- YES = DO NOT flag
- NO = FLAG only if answer is truly unknowable

### TRUST SIGNALS ANALYSIS

**CRITICAL: Check your inventory from Phase 1C before flagging!**

**ONLY flag "Missing Trust Signals" if your inventory shows ALL of these are empty:**
- companyLogos: []
- customerCount: null
- hasTestimonials: false
- badges: []

**NEVER flag if your inventory shows ANY trust signal exists.**
- Even ONE company logo = DO NOT flag
- Even ONE "Trusted by X" text = DO NOT flag
- Even ONE testimonial visible = DO NOT flag

---

## OUTPUT RULES

1. **Zero issues is VALID** - Well-optimized pages may have no issues
2. **Maximum 3 issues** - Only flag clear violations
3. **Every issue MUST include inventoryRef** - Quote the specific inventory item

---

## OUTPUT FORMAT

Return ONLY valid JSON:

{
  "inventory": {
    "buttons": [
      { "exactText": "Get a Demo", "style": "solid", "colorScheme": "blue" }
    ],
    "headlines": {
      "h1": "AI-Powered Analytics for Modern Teams",
      "subheadline": "Track performance in real-time"
    },
    "trustSignals": {
      "companyLogos": ["Google", "Microsoft", "Stripe"],
      "customerCount": "Trusted by 5,000+ companies",
      "hasTestimonials": false,
      "badges": []
    },
    "heroImage": {
      "type": "product screenshot",
      "description": "Dashboard showing analytics charts",
      "appearsGenericStock": false
    }
  },
  "sections": [
    {
      "section": "cta",
      "sectionSelector": ".hero, section:first-of-type",
      "issue": {
        "inventoryRef": "Button text: 'Learn More'",
        "label": "Vague CTA - Learn More Doesn't Convert",
        "description": "Button says 'Learn More' which doesn't tell visitors what happens next",
        "conversionImpact": "84% less engagement without clear CTA",
        "severity": "critical",
        "elementSelector": ".hero button, .hero a.btn"
      }
    }
  ]
}

### SEVERITY MAPPING:
- "critical" = HIGH priority (missing/vague CTA, unclear value prop)
- "warning" = MEDIUM priority (missing trust, generic image)

### CONVERSION IMPACT STATS (use exactly):
- CTA issues: "84% less engagement without clear CTA"
- Headline issues: "Up to 50% bounce rate increase"
- Trust issues: "42% conversion lift when trust added"

---

## SELF-CHECK BEFORE RETURNING

For each issue, verify:
1. Does inventoryRef quote something from my Phase 1 inventory?
2. Would the issue be rejected if inventory shows the element exists?
3. Am I CERTAIN this meets the exact flagging criteria?

If any answer is NO, remove that issue.

**Remember: It's better to return 0 issues than to hallucinate issues that don't exist.**`;
}

function validateIssueAgainstInventory(
  issue: GroundedIssue,
  inventory: VisualInventory
): { valid: boolean; reason?: string } {
  const labelLower = issue.label.toLowerCase();

  // Reject CTA issues if a valid CTA exists in inventory
  if (labelLower.includes('cta') || labelLower.includes('button')) {
    const hasValidCTA = inventory.buttons.some(btn => {
      const text = btn.exactText.toLowerCase();
      // These are GOOD CTAs - should not be flagged
      const goodCTAs = ['demo', 'trial', 'start', 'get', 'book', 'pricing', 'quote', 'shop', 'download', 'join', 'sign up', 'try'];
      return goodCTAs.some(good => text.includes(good));
    });

    if (hasValidCTA && labelLower.includes('missing')) {
      return { valid: false, reason: 'Inventory shows valid CTA button exists' };
    }

    // Check if flagging a "vague" CTA that isn't actually vague
    if (labelLower.includes('vague') || labelLower.includes('unclear')) {
      const vagueTexts = ['submit', 'click here', 'go', 'continue', 'next', 'learn more'];
      const hasVagueCTA = inventory.buttons.some(btn =>
        vagueTexts.includes(btn.exactText.toLowerCase().trim())
      );
      if (!hasVagueCTA) {
        return { valid: false, reason: `Inventory shows specific CTA text, not vague: ${inventory.buttons.map(b => b.exactText).join(', ')}` };
      }
    }
  }

  // Reject trust issues if trust signals exist in inventory
  if (labelLower.includes('trust')) {
    const hasTrustSignals =
      inventory.trustSignals.companyLogos.length > 0 ||
      inventory.trustSignals.customerCount !== null ||
      inventory.trustSignals.hasTestimonials ||
      inventory.trustSignals.badges.length > 0;

    if (hasTrustSignals) {
      return {
        valid: false,
        reason: `Inventory shows trust signals exist: logos=[${inventory.trustSignals.companyLogos.join(', ')}], customerCount=${inventory.trustSignals.customerCount}, testimonials=${inventory.trustSignals.hasTestimonials}`
      };
    }
  }

  return { valid: true };
}

function parseAnalysisResponse(text: string): { sections: SectionIssue[]; inventory?: VisualInventory } {
  try {
    const parsed = JSON.parse(text);
    if (parsed) {
      const inventory = parsed.inventory as VisualInventory | undefined;
      let sections = parsed.sections as SectionIssue[] | undefined;

      if (inventory) {
        console.log('[gemini-vision] Inventory:', JSON.stringify(inventory, null, 2));
      }

      if (Array.isArray(sections)) {
        // Validate each issue against inventory
        if (inventory) {
          const validatedSections: SectionIssue[] = [];
          for (const section of sections) {
            if (!section.issue) continue;

            const groundedIssue: GroundedIssue = {
              inventoryRef: section.issue.inventoryRef || '',
              section: section.section,
              label: section.issue.label,
              description: section.issue.description,
              severity: section.issue.severity,
              conversionImpact: section.issue.conversionImpact,
              elementSelector: section.issue.elementSelector,
            };

            const validation = validateIssueAgainstInventory(groundedIssue, inventory);
            if (validation.valid) {
              validatedSections.push(section);
            } else {
              console.log(`[gemini-vision] Rejected hallucinated issue: "${section.issue.label}" - ${validation.reason}`);
            }
          }
          sections = validatedSections;
        }

        return { sections: sections.slice(0, 3), inventory };
      }
    }
  } catch {
    // Try to extract JSON from the response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && Array.isArray(parsed.sections)) {
          return { sections: parsed.sections.slice(0, 3), inventory: parsed.inventory };
        }
      } catch {
        // Could not parse
      }
    }
  }
  return { sections: [] };
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

  console.log('[gemini-vision] Analyzing page sections with grounded prompt...');

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

    const { sections, inventory } = parseAnalysisResponse(rawText);
    console.log('[gemini-vision] Validated issues:', sections.length, sections.map(s => s.issue?.label));

    return { sections, rawAnalysis: rawText, inventory };
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
