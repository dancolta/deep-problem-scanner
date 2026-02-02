import { GoogleGenerativeAI } from '@google/generative-ai';
import { DiagnosticResult } from '../scanner/types';
import {
  AnnotationCoord,
  AnnotationOptions,
  AnnotationResult,
  AnnotationSeverity,
  DEFAULT_ANNOTATION_OPTIONS,
} from './types';

function buildPrompt(
  url: string,
  diagnostics: DiagnosticResult[],
  opts: AnnotationOptions
): string {
  const diagnosticLines = diagnostics
    .map((d) => `- ${d.name}: ${d.status} (score: ${d.score}/100) - ${d.details}`)
    .join('\n');

  return `You are a website UX/design analyst. Analyze this homepage screenshot from ${url}.

The following diagnostic checks have already been run:
${diagnosticLines}

Based on the screenshot AND the diagnostic results, identify the TOP ${opts.maxAnnotations} most impactful visual problems on this homepage.

For each problem, provide PRECISE pixel coordinates (x, y, width, height) for where the problem is visible on the ${opts.screenshotWidth}x${opts.screenshotHeight} screenshot.

Rules:
- Coordinates must be within bounds: x: 0-${opts.screenshotWidth}, y: 0-${opts.screenshotHeight}
- width and height must be at least 50px
- Labels must be SHORT (2-4 words): e.g., "No CTA Button", "Slow Load", "Missing H1", "No Mobile Meta", "Broken Link", "Poor Contrast", "No Alt Text"
- severity: "critical" for major issues, "warning" for moderate, "info" for minor
- Focus on problems VISIBLE in the screenshot
- If a diagnostic failed but the issue isn't visually identifiable, place the annotation at the most relevant page area

Respond ONLY with valid JSON in this exact format:
{
  "annotations": [
    {
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 150,
      "label": "No CTA Button",
      "severity": "critical",
      "description": "The hero section lacks a clear call-to-action button"
    }
  ]
}`;
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

    let x = typeof a.x === 'number' ? a.x : 0;
    let y = typeof a.y === 'number' ? a.y : 0;
    let width = typeof a.width === 'number' ? a.width : 100;
    let height = typeof a.height === 'number' ? a.height : 100;
    const label = typeof a.label === 'string' ? a.label : 'Issue';
    const severity: AnnotationSeverity = VALID_SEVERITIES.includes(a.severity as AnnotationSeverity)
      ? (a.severity as AnnotationSeverity)
      : 'warning';
    const description = typeof a.description === 'string' ? a.description : '';

    // Ensure minimum dimensions
    width = Math.max(50, Math.min(width, opts.screenshotWidth));
    height = Math.max(50, Math.min(height, opts.screenshotHeight));

    // Clamp position so annotation stays within bounds
    x = Math.max(0, Math.min(x, opts.screenshotWidth - width));
    y = Math.max(0, Math.min(y, opts.screenshotHeight - height));

    validated.push({ x, y, width, height, label, severity, description });
  }

  return validated;
}

function parseJsonResponse(text: string): { annotations: unknown[] } | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.annotations)) {
      return parsed;
    }
  } catch {
    // Fall through to regex extraction
  }

  // Extract JSON from surrounding text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && Array.isArray(parsed.annotations)) {
        return parsed;
      }
    } catch {
      // Could not parse extracted JSON
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
    console.error('[gemini-vision] GEMINI_API_KEY is not set');
    return { annotations: [], rawAnalysis: 'Error: GEMINI_API_KEY not configured', problemCount: 0 };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  const prompt = buildPrompt(url, diagnostics, opts);
  const base64Image = screenshotBuffer.toString('base64');

  let rawText: string;

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

    rawText = result.response.text();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[gemini-vision] API call failed:', message);
    return {
      annotations: [],
      rawAnalysis: `Error: Gemini API call failed - ${message}`,
      problemCount: 0,
    };
  }

  const parsed = parseJsonResponse(rawText);

  if (!parsed) {
    console.error('[gemini-vision] Failed to parse JSON from response');
    return { annotations: [], rawAnalysis: rawText, problemCount: 0 };
  }

  const annotations = validateAnnotations(parsed.annotations, opts);

  return {
    annotations,
    rawAnalysis: rawText,
    problemCount: annotations.length,
  };
}
