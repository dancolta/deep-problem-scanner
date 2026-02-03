import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

// ============================================================================
// ANNOTATION RULES (v4) - CARDS ONLY, NO ARROWS
// ============================================================================
// WHAT WE DRAW:
// 1. Callout card (white bg, gray border, red left accent)
// 2. Numbered badge above card
//
// WHAT WE DO NOT DRAW:
// - NO arrows (removed for cleaner look)
// - NO rectangles around target elements
// - NO dashed boxes
//
// SCREENSHOT PROCESSING:
// - Darken screenshot by 20% so white cards pop
// - Enhanced shadow on cards for visibility
//
// CARD RULES:
// - FIXED MAX WIDTH (437px)
// - Card NEVER overlaps target element (25px minimum gap)
// - Badge positioned ABOVE card
// - Cards positioned NEAR target element
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

  // TARGET ELEMENT bounds (the element with the issue)
  const targetRect = {
    x: clamped.x,
    y: clamped.y,
    w: clamped.width,
    h: clamped.height,
  };

  // TARGET POINT - exact center of the element with issue
  const targetCenterX = clamped.x + clamped.width / 2;
  const targetCenterY = clamped.y + clamped.height / 2;

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

  // ========== POSITION CARD - STRICT RULES ==========
  // RULE 1: Card must NEVER overlap the target element (minimum 25px gap)
  // RULE 2: Card must not overlap other placed cards (20px gap)
  // RULE 3: Arrow length should be 50-150px (ideal 80-120px)

  const edgeMargin = 25;
  const TARGET_GAP = 25; // Minimum gap between card and target element

  // Helper to check if candidate overlaps any placed card
  const overlapsPlacedCards = (cardRect: { x: number; y: number; w: number; h: number }): boolean => {
    for (const placed of placedCards) {
      if (rectsOverlap(cardRect, placed, 20)) {
        return true;
      }
    }
    return false;
  };

  // Helper to check if card overlaps target (STRICT - must not touch)
  const overlapsTarget = (cardRect: { x: number; y: number; w: number; h: number }): boolean => {
    return rectsOverlap(cardRect, targetRect, TARGET_GAP);
  };

  type CandidatePosition = {
    x: number;
    y: number;
    arrowLength: number;
    direction: 'right' | 'left' | 'above' | 'below';
  };

  const candidates: CandidatePosition[] = [];
  const gapsToTry = [40, 60, 80, 100, 120];

  for (const gap of gapsToTry) {
    // RIGHT of target
    const rightX = targetRect.x + targetRect.w + gap;
    const rightY = Math.max(edgeMargin + BADGE_RADIUS + 15, Math.min(targetCenterY - boxHeight / 2, imgHeight - boxHeight - edgeMargin));
    const rightCardRect = { x: rightX, y: rightY, w: boxWidth, h: boxHeight };
    if (rightX + boxWidth < imgWidth - edgeMargin && !overlapsTarget(rightCardRect) && !overlapsPlacedCards(rightCardRect)) {
      const arrowLen = distance(rightX, rightY + boxHeight / 2, targetCenterX, targetCenterY);
      if (arrowLen >= ARROW_MIN_LENGTH && arrowLen <= ARROW_MAX_LENGTH) {
        candidates.push({ x: rightX, y: rightY, arrowLength: arrowLen, direction: 'right' });
      }
    }

    // LEFT of target
    const leftX = targetRect.x - boxWidth - gap;
    const leftY = Math.max(edgeMargin + BADGE_RADIUS + 15, Math.min(targetCenterY - boxHeight / 2, imgHeight - boxHeight - edgeMargin));
    const leftCardRect = { x: leftX, y: leftY, w: boxWidth, h: boxHeight };
    if (leftX > edgeMargin && !overlapsTarget(leftCardRect) && !overlapsPlacedCards(leftCardRect)) {
      const arrowLen = distance(leftX + boxWidth, leftY + boxHeight / 2, targetCenterX, targetCenterY);
      if (arrowLen >= ARROW_MIN_LENGTH && arrowLen <= ARROW_MAX_LENGTH) {
        candidates.push({ x: leftX, y: leftY, arrowLength: arrowLen, direction: 'left' });
      }
    }

    // BELOW target
    const belowX = Math.max(edgeMargin, Math.min(targetCenterX - boxWidth / 2, imgWidth - boxWidth - edgeMargin));
    const belowY = targetRect.y + targetRect.h + gap;
    const belowCardRect = { x: belowX, y: belowY, w: boxWidth, h: boxHeight };
    if (belowY + boxHeight < imgHeight - edgeMargin && !overlapsTarget(belowCardRect) && !overlapsPlacedCards(belowCardRect)) {
      const arrowLen = distance(belowX + boxWidth / 2, belowY, targetCenterX, targetCenterY);
      if (arrowLen >= ARROW_MIN_LENGTH && arrowLen <= ARROW_MAX_LENGTH) {
        candidates.push({ x: belowX, y: belowY, arrowLength: arrowLen, direction: 'below' });
      }
    }

    // ABOVE target (need space for badge)
    const aboveX = Math.max(edgeMargin, Math.min(targetCenterX - boxWidth / 2, imgWidth - boxWidth - edgeMargin));
    const aboveY = targetRect.y - boxHeight - gap - BADGE_RADIUS - 10;
    const aboveCardRect = { x: aboveX, y: aboveY, w: boxWidth, h: boxHeight };
    if (aboveY > edgeMargin + BADGE_RADIUS + 10 && !overlapsTarget(aboveCardRect) && !overlapsPlacedCards(aboveCardRect)) {
      const arrowLen = distance(aboveX + boxWidth / 2, aboveY + boxHeight, targetCenterX, targetCenterY);
      if (arrowLen >= ARROW_MIN_LENGTH && arrowLen <= ARROW_MAX_LENGTH) {
        candidates.push({ x: aboveX, y: aboveY, arrowLength: arrowLen, direction: 'above' });
      }
    }
  }

  // Sort by arrow length closest to ideal
  candidates.sort((a, b) => {
    const aDistFromIdeal = Math.abs(a.arrowLength - ARROW_IDEAL_LENGTH);
    const bDistFromIdeal = Math.abs(b.arrowLength - ARROW_IDEAL_LENGTH);
    return aDistFromIdeal - bDistFromIdeal;
  });

  let boxX: number;
  let boxY: number;
  let chosenDirection: 'right' | 'left' | 'above' | 'below' = 'right';

  if (candidates.length > 0) {
    const best = candidates[0];
    boxX = best.x;
    boxY = best.y;
    chosenDirection = best.direction;
    console.log(`[drawing] Best position: ${best.direction}, arrow: ${Math.round(best.arrowLength)}px`);
  } else {
    // STRICT FALLBACK: Find ANY position that doesn't overlap target
    console.log(`[drawing] No ideal position, finding safe fallback...`);

    // Try right side with larger gap
    boxX = targetRect.x + targetRect.w + 50;
    boxY = Math.max(edgeMargin + BADGE_RADIUS + 15, targetCenterY - boxHeight / 2);
    chosenDirection = 'right';

    // If right side would go off screen, try left
    if (boxX + boxWidth > imgWidth - edgeMargin) {
      boxX = targetRect.x - boxWidth - 50;
      chosenDirection = 'left';
    }

    // If left would go off screen, try below
    if (boxX < edgeMargin) {
      boxX = Math.max(edgeMargin, targetCenterX - boxWidth / 2);
      boxY = targetRect.y + targetRect.h + 50;
      chosenDirection = 'below';
    }

    // Clamp to screen bounds
    boxX = Math.max(edgeMargin, Math.min(boxX, imgWidth - boxWidth - edgeMargin));
    boxY = Math.max(edgeMargin + BADGE_RADIUS + 15, Math.min(boxY, imgHeight - boxHeight - edgeMargin));

    // FINAL CHECK: If still overlapping target, push away
    const finalCardRect = { x: boxX, y: boxY, w: boxWidth, h: boxHeight };
    if (overlapsTarget(finalCardRect)) {
      console.log(`[drawing] Fallback still overlaps, pushing away from target...`);
      // Push card away from target based on direction
      if (chosenDirection === 'right') {
        boxX = targetRect.x + targetRect.w + TARGET_GAP + 10;
      } else if (chosenDirection === 'left') {
        boxX = targetRect.x - boxWidth - TARGET_GAP - 10;
      } else if (chosenDirection === 'below') {
        boxY = targetRect.y + targetRect.h + TARGET_GAP + 10;
      } else {
        boxY = targetRect.y - boxHeight - TARGET_GAP - BADGE_RADIUS - 10;
      }
      // Final clamp
      boxX = Math.max(edgeMargin, Math.min(boxX, imgWidth - boxWidth - edgeMargin));
      boxY = Math.max(edgeMargin + BADGE_RADIUS + 15, Math.min(boxY, imgHeight - boxHeight - edgeMargin));
    }
  }

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

  // ========== STEP 1: DARKEN THE SCREENSHOT BY 20% ==========
  // This makes the white cards pop more visibly
  const darkenedBuffer = await sharp(realBuf)
    .modulate({
      brightness: 0.8, // 80% brightness = 20% darker
    })
    .toBuffer();

  console.log(`[drawing] Screenshot darkened by 20%`);

  // ========== STEP 2: BUILD ANNOTATION CARDS ==========
  // Track placed cards to avoid overlaps
  const placedCards: PlacedCard[] = [];
  const svgParts: string[] = [];

  // Process annotations sequentially to track placements
  const toProcess = annotations.slice(0, 3); // Max 3 annotations
  for (let i = 0; i < toProcess.length; i++) {
    const ann = toProcess[i];
    console.log(`[drawing] Annotation ${i+1}: "${ann.label}" at (${ann.x}, ${ann.y}) ${ann.width}x${ann.height}`);

    const result = buildAnnotationSvg(ann, i, imgWidth, imgHeight, placedCards);

    if (result.svg && result.placement) {
      svgParts.push(result.svg);
      placedCards.push(result.placement);
      console.log(`[drawing] Placed card ${i+1} at (${result.placement.x}, ${result.placement.y})`);
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
