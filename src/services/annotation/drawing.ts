import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

// ============================================================================
// STRICT ANNOTATION RULES (v3)
// ============================================================================
// WHAT WE DRAW:
// 1. Callout card (white bg, gray border, red left accent)
// 2. Straight arrow from card edge to target center
// 3. Numbered badge above card
//
// WHAT WE DO NOT DRAW:
// - NO rectangles around target elements
// - NO dashed boxes
// - NO highlighting boxes
//
// ARROW RULES:
// - Length: 50-150px MAXIMUM (ideal: 80-120px)
// - Style: ALWAYS straight line (never curved)
// - Points EXACTLY to target element center
// - Starts from card EDGE (not inside card)
//
// CARD RULES:
// - FIXED MAX WIDTH (336px) - text wraps within
// - Card NEVER overlaps target element
// - Badge positioned ABOVE card
// - Sizes increased by 20% for visibility
// ============================================================================

const ANNOTATION_COLOR = '#dc2626'; // Red for all annotations

// Arrow length constraints - STRICT enforcement
const ARROW_MIN_LENGTH = 50;
const ARROW_MAX_LENGTH = 150;
const ARROW_IDEAL_LENGTH = 100; // Target 80-120px

// Sizes increased by 50% total (20% + 30%)
const CARD_MAX_WIDTH = 437; // 336 * 1.3
const CARD_PADDING = 22; // 17 * 1.3
const LABEL_FONT_SIZE = 22; // 17 * 1.3
const IMPACT_FONT_SIZE = 17; // 13 * 1.3
const LINE_HEIGHT = 29; // 22 * 1.3
const CHAR_WIDTH = 12; // 9 * 1.3
const BADGE_RADIUS = 17; // 13 * 1.3
const BADGE_FONT_SIZE = 18; // 14 * 1.3
const ARROW_WIDTH = 3; // Slightly thicker for larger card
const ARROW_HEAD_SIZE = 14; // 12 * 1.15

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

  // ========== 4. DRAW STRAIGHT ARROW - STRICT RULES ==========
  // RULE: Arrow exits from the edge facing the target (based on chosenDirection)
  // RULE: Arrow NEVER passes through the card body
  // RULE: Arrow points to target center (or edge if closer)

  const ARROW_MARGIN = 8;

  let arrowStartX: number;
  let arrowStartY: number;
  let arrowEndX: number;
  let arrowEndY: number;

  // Use chosenDirection to determine arrow exit point
  // This ensures arrow exits from the correct edge based on card placement
  switch (chosenDirection) {
    case 'right':
      // Card is to the RIGHT of target, arrow exits from LEFT edge of card
      arrowStartX = boxX;
      arrowStartY = boxY + boxHeight / 2;
      // Arrow points to right edge of target
      arrowEndX = targetRect.x + targetRect.w + ARROW_MARGIN;
      arrowEndY = Math.max(targetRect.y + 10, Math.min(arrowStartY, targetRect.y + targetRect.h - 10));
      break;

    case 'left':
      // Card is to the LEFT of target, arrow exits from RIGHT edge of card
      arrowStartX = boxX + boxWidth;
      arrowStartY = boxY + boxHeight / 2;
      // Arrow points to left edge of target
      arrowEndX = targetRect.x - ARROW_MARGIN;
      arrowEndY = Math.max(targetRect.y + 10, Math.min(arrowStartY, targetRect.y + targetRect.h - 10));
      break;

    case 'below':
      // Card is BELOW target, arrow exits from TOP edge of card
      arrowStartX = boxX + boxWidth / 2;
      arrowStartY = boxY;
      // Arrow points to bottom edge of target
      arrowEndX = Math.max(targetRect.x + 10, Math.min(arrowStartX, targetRect.x + targetRect.w - 10));
      arrowEndY = targetRect.y + targetRect.h + ARROW_MARGIN;
      break;

    case 'above':
      // Card is ABOVE target, arrow exits from BOTTOM edge of card
      arrowStartX = boxX + boxWidth / 2;
      arrowStartY = boxY + boxHeight;
      // Arrow points to top edge of target
      arrowEndX = Math.max(targetRect.x + 10, Math.min(arrowStartX, targetRect.x + targetRect.w - 10));
      arrowEndY = targetRect.y - ARROW_MARGIN;
      break;
  }

  // SAFETY: Ensure arrow start is exactly on card edge (not inside)
  arrowStartX = Math.max(boxX, Math.min(arrowStartX, boxX + boxWidth));
  arrowStartY = Math.max(boxY, Math.min(arrowStartY, boxY + boxHeight));

  console.log(`[drawing] Arrow: (${Math.round(arrowStartX)},${Math.round(arrowStartY)}) → (${Math.round(arrowEndX)},${Math.round(arrowEndY)}) [${chosenDirection}]`);

  // STRAIGHT LINE from card edge to target edge (with margin)
  parts.push(
    `<line x1="${arrowStartX}" y1="${arrowStartY}" x2="${arrowEndX}" y2="${arrowEndY}" ` +
      `stroke="${ANNOTATION_COLOR}" stroke-width="${ARROW_WIDTH}" />`
  );

  // ARROWHEAD pointing at target edge
  const angle = Math.atan2(arrowEndY - arrowStartY, arrowEndX - arrowStartX);
  const arrowAngle = Math.PI / 6; // 30 degrees

  const ax1 = arrowEndX - ARROW_HEAD_SIZE * Math.cos(angle - arrowAngle);
  const ay1 = arrowEndY - ARROW_HEAD_SIZE * Math.sin(angle - arrowAngle);
  const ax2 = arrowEndX - ARROW_HEAD_SIZE * Math.cos(angle + arrowAngle);
  const ay2 = arrowEndY - ARROW_HEAD_SIZE * Math.sin(angle + arrowAngle);

  parts.push(
    `<polygon points="${arrowEndX},${arrowEndY} ${ax1},${ay1} ${ax2},${ay2}" fill="${ANNOTATION_COLOR}" />`
  );

  // Return SVG and placement info for collision tracking
  const placement: PlacedCard = {
    x: boxX,
    y: boxY,
    w: boxWidth,
    h: boxHeight,
    arrowStartX,
    arrowStartY,
    arrowEndX,
    arrowEndY,
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

  const svgString =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">\n` +
    `  <defs>\n` +
    `    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">\n` +
    `      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.2" />\n` +
    `    </filter>\n` +
    `  </defs>\n` +
    `  ${svgElements}\n` +
    `</svg>`;

  const annotatedBuffer = await sharp(realBuf)
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
