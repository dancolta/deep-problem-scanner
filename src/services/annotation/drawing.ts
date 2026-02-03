import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

// ============================================================================
// ANNOTATION RULES (v5) - RIGHT-SIDE STACKED CARDS
// ============================================================================
// WHAT WE DRAW:
// 1. Callout card (white bg, gray border, red left accent)
// 2. Numbered badge above card
//
// WHAT WE DO NOT DRAW:
// - NO arrows
// - NO rectangles around target elements
// - NO dashed boxes
//
// SCREENSHOT PROCESSING:
// - Darken screenshot by 35% so white cards pop
// - Enhanced shadow on cards for visibility
//
// CARD RULES:
// - FIXED MAX WIDTH (437px)
// - ALL cards on RIGHT SIDE of screenshot
// - Cards stacked vertically, centered in the middle of the screen
// - Badge positioned ABOVE card
// ============================================================================

const ANNOTATION_COLOR = '#dc2626'; // Red for all annotations

// Card positioning constraints (no arrows, but still need distance logic)
const ARROW_MIN_LENGTH = 50;  // Minimum distance from target
const ARROW_MAX_LENGTH = 150; // Maximum distance from target
const ARROW_IDEAL_LENGTH = 100; // Ideal distance

// Card sizes
const CARD_MAX_WIDTH = 437;
const CARD_PADDING = 22;
const LABEL_FONT_SIZE = 22;
const IMPACT_FONT_SIZE = 17;
const LINE_HEIGHT = 29;
const CHAR_WIDTH = 12;
const BADGE_RADIUS = 17;
const BADGE_FONT_SIZE = 18;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap text to fit within maxWidth, returning array of lines
 */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      // If single word is too long, truncate it
      currentLine = word.length > maxCharsPerLine
        ? word.substring(0, maxCharsPerLine - 3) + '...'
        : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function clampAnnotation(
  ann: AnnotationCoord,
  imgWidth: number,
  imgHeight: number
): AnnotationCoord {
  const x = Math.max(0, Math.min(ann.x, imgWidth - 50));
  const y = Math.max(0, Math.min(ann.y, imgHeight - 50));
  const width = Math.max(100, Math.min(ann.width, imgWidth - x));
  const height = Math.max(50, Math.min(ann.height, imgHeight - y));
  return { ...ann, x, y, width, height };
}

/**
 * Check if two rectangles overlap
 */
function rectsOverlap(
  r1: { x: number; y: number; w: number; h: number },
  r2: { x: number; y: number; w: number; h: number },
  padding: number = 10
): boolean {
  return !(
    r1.x + r1.w + padding < r2.x ||
    r2.x + r2.w + padding < r1.x ||
    r1.y + r1.h + padding < r2.y ||
    r2.y + r2.h + padding < r1.y
  );
}

/**
 * Calculate distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Track placed cards for collision avoidance
type PlacedCard = {
  x: number;
  y: number;
  w: number;
  h: number;
  arrowStartX: number;
  arrowStartY: number;
  arrowEndX: number;
  arrowEndY: number;
};

function buildAnnotationSvg(
  ann: AnnotationCoord,
  index: number,
  imgWidth: number,
  imgHeight: number,
  placedCards: PlacedCard[] = []
): { svg: string; placement: PlacedCard | null } {
  const clamped = clampAnnotation(ann, imgWidth, imgHeight);
  const parts: string[] = [];

  const label = clamped.label || '';
  const rawImpact = clamped.conversionImpact || '';

  if (label.length === 0) return { svg: '', placement: null };

  // ========== TEXT WRAPPING ==========
  const textAreaWidth = CARD_MAX_WIDTH - CARD_PADDING * 2 - 12; // Account for left accent
  const maxCharsPerLine = Math.floor(textAreaWidth / CHAR_WIDTH);

  const labelLines = wrapText(label, maxCharsPerLine);
  const impactLines = rawImpact
    ? wrapText(rawImpact, Math.floor(textAreaWidth / (CHAR_WIDTH * 0.85)))
    : [];

  // ========== CALCULATE CARD DIMENSIONS ==========
  const boxWidth = CARD_MAX_WIDTH;
  let boxHeight = CARD_PADDING * 2;
  boxHeight += labelLines.length * LINE_HEIGHT;
  if (impactLines.length > 0) {
    boxHeight += 10; // Gap
    boxHeight += impactLines.length * (LINE_HEIGHT - 4);
  }

  // ========== POSITION CARD - RIGHT SIDE, VERTICALLY STACKED ==========
  const edgeMargin = 25;
  const cardGap = 20; // Gap between stacked cards
  const badgeSpace = BADGE_RADIUS + 10; // Space for badge above first card

  // X position: right side of screen
  const boxX = imgWidth - boxWidth - edgeMargin;

  // Y position: calculate based on previously placed cards
  let boxY: number;

  if (placedCards.length === 0) {
    // First card: calculate to vertically center all cards
    // Estimate total height of all cards (assume max 3 cards, similar heights)
    const estimatedTotalHeight = boxHeight * 3 + cardGap * 2 + badgeSpace;
    const startY = Math.max(
      edgeMargin + badgeSpace,
      (imgHeight - estimatedTotalHeight) / 2 + badgeSpace
    );
    boxY = startY;
  } else {
    // Stack below the last placed card
    const lastCard = placedCards[placedCards.length - 1];
    boxY = lastCard.y + lastCard.h + cardGap + badgeSpace;

    // If we'd go off screen, reset to top
    if (boxY + boxHeight > imgHeight - edgeMargin) {
      boxY = edgeMargin + badgeSpace;
    }
  }

  console.log(`[drawing] Card ${index + 1} positioned at right side: (${boxX}, ${boxY})`);

  // ========== 1. DRAW CARD ==========
  parts.push(
    `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" ` +
      `fill="white" stroke="#e5e7eb" stroke-width="1" rx="10" ry="10" filter="url(#shadow)" />`
  );
  // Red left accent (slightly thicker)
  parts.push(
    `<rect x="${boxX}" y="${boxY + 5}" width="5" height="${boxHeight - 10}" ` +
      `fill="${ANNOTATION_COLOR}" rx="2" ry="2" />`
  );

  // ========== 2. DRAW TEXT (always inside card) ==========
  let textY = boxY + CARD_PADDING + LABEL_FONT_SIZE - 2;
  const textX = boxX + 16;

  // Label lines (bold)
  for (const line of labelLines) {
    const escapedLine = escapeXml(line);
    parts.push(
      `<text x="${textX}" y="${textY}" font-family="Arial, Helvetica, sans-serif" ` +
        `font-size="${LABEL_FONT_SIZE}" font-weight="bold" fill="#1f2937">${escapedLine}</text>`
    );
    textY += LINE_HEIGHT;
  }

  // Impact lines (red, smaller)
  if (impactLines.length > 0) {
    textY += 6; // Gap
    for (const line of impactLines) {
      const escapedLine = escapeXml(line);
      parts.push(
        `<text x="${textX}" y="${textY}" font-family="Arial, Helvetica, sans-serif" ` +
          `font-size="${IMPACT_FONT_SIZE}" font-weight="600" fill="${ANNOTATION_COLOR}">${escapedLine}</text>`
      );
      textY += LINE_HEIGHT - 4;
    }
  }

  // ========== 3. DRAW BADGE (above card, never overlapping) ==========
  const badgeX = boxX + boxWidth - BADGE_RADIUS - 8;
  const badgeY = boxY - BADGE_RADIUS - 8;

  parts.push(
    `<circle cx="${badgeX}" cy="${badgeY}" r="${BADGE_RADIUS}" fill="${ANNOTATION_COLOR}" />`,
    `<text x="${badgeX}" y="${badgeY + 6}" text-anchor="middle" ` +
      `font-family="Arial, Helvetica, sans-serif" font-size="${BADGE_FONT_SIZE}" font-weight="bold" fill="white">${index + 1}</text>`
  );

  // ========== NO ARROWS - CARDS ONLY ==========
  // Arrows removed for cleaner look. Cards are positioned near their target elements.

  // Return SVG and placement info for collision tracking
  const placement: PlacedCard = {
    x: boxX,
    y: boxY,
    w: boxWidth,
    h: boxHeight,
    arrowStartX: boxX,
    arrowStartY: boxY,
    arrowEndX: boxX,
    arrowEndY: boxY,
  };

  return { svg: parts.join('\n  '), placement };
}

export async function drawAnnotations(
  screenshotBuffer: Buffer,
  annotations: AnnotationCoord[]
): Promise<Buffer> {
  if (!annotations || annotations.length === 0) {
    return screenshotBuffer;
  }

  // Ensure real Buffer
  const realBuf = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer);
  const rawMeta = await sharp(realBuf).metadata();
  const imgWidth = rawMeta.width ?? 1920;
  const imgHeight = rawMeta.height ?? 1080;

  console.log(`[drawing] Image dimensions: ${imgWidth}x${imgHeight}, annotations: ${annotations.length}`);

  // ========== STEP 1: DARKEN THE SCREENSHOT BY 35% ==========
  // This makes the white cards pop more visibly
  const darkenedBuffer = await sharp(realBuf)
    .modulate({
      brightness: 0.65, // 65% brightness = 35% darker
    })
    .toBuffer();

  console.log(`[drawing] Screenshot darkened by 35%`);

  // ========== STEP 2: BUILD ANNOTATION CARDS ==========
  // Track placed cards to avoid overlaps
  const placedCards: PlacedCard[] = [];
  const svgParts: string[] = [];

  // Process annotations sequentially to track placements
  const toProcess = annotations.slice(0, 3); // Max 3 annotations
  let badgeNumber = 0; // Track actual badge number (only increment on success)

  for (let i = 0; i < toProcess.length; i++) {
    const ann = toProcess[i];

    // Skip if no label
    if (!ann.label || ann.label.length === 0) {
      console.log(`[drawing] Skipping annotation ${i} - no label`);
      continue;
    }

    console.log(`[drawing] Annotation ${badgeNumber+1}: "${ann.label}" at (${ann.x}, ${ann.y}) ${ann.width}x${ann.height}`);

    const result = buildAnnotationSvg(ann, badgeNumber, imgWidth, imgHeight, placedCards);

    if (result.svg && result.placement) {
      svgParts.push(result.svg);
      placedCards.push(result.placement);
      console.log(`[drawing] Placed card ${badgeNumber+1} at (${result.placement.x}, ${result.placement.y})`);
      badgeNumber++; // Only increment when card is successfully placed
    }
  }

  const svgElements = svgParts.join('\n  ');

  // Cards with enhanced shadow for better visibility on darkened background
  const svgString =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">\n` +
    `  <defs>\n` +
    `    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">\n` +
    `      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.4" />\n` +
    `    </filter>\n` +
    `  </defs>\n` +
    `  ${svgElements}\n` +
    `</svg>`;

  // ========== STEP 3: COMPOSITE CARDS ON DARKENED SCREENSHOT ==========
  const annotatedBuffer = await sharp(darkenedBuffer)
    .composite([
      {
        input: Buffer.from(svgString),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return annotatedBuffer;
}
