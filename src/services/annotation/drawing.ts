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

  // ========== POSITION CARD (enforce arrow length 50-150px, prefer 80-120px) ==========
  const edgeMargin = 25;

  // Try multiple positions and distances, pick best arrow length
  type CandidatePosition = {
    x: number;
    y: number;
    arrowLength: number;
    arrowStartX: number;
    arrowStartY: number;
    name: string;
  };

  const candidates: CandidatePosition[] = [];

  // Try gaps from small to large to find optimal arrow length
  const gapsToTry = [30, 50, 70, 90, 110, 130];

  // Helper to check if candidate overlaps any placed card
  const overlapsPlacedCards = (cardRect: { x: number; y: number; w: number; h: number }): boolean => {
    for (const placed of placedCards) {
      if (rectsOverlap(cardRect, placed, 20)) { // 20px padding between cards
        return true;
      }
    }
    return false;
  };

  for (const gap of gapsToTry) {
    // Right of target
    const rightX = targetRect.x + targetRect.w + gap;
    const rightY = Math.max(edgeMargin, targetCenterY - boxHeight / 2);
    const rightClampedX = Math.max(edgeMargin, Math.min(rightX, imgWidth - boxWidth - edgeMargin));
    const rightClampedY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(rightY, imgHeight - boxHeight - edgeMargin));
    const rightArrowStartX = rightClampedX;
    const rightArrowStartY = Math.max(rightClampedY + 15, Math.min(targetCenterY, rightClampedY + boxHeight - 15));
    const rightArrowLen = distance(rightArrowStartX, rightArrowStartY, targetCenterX, targetCenterY);
    const rightCardRect = { x: rightClampedX, y: rightClampedY, w: boxWidth, h: boxHeight };
    if (!rectsOverlap(rightCardRect, targetRect, 10) && !overlapsPlacedCards(rightCardRect) && rightArrowLen >= ARROW_MIN_LENGTH && rightArrowLen <= ARROW_MAX_LENGTH) {
      candidates.push({ x: rightClampedX, y: rightClampedY, arrowLength: rightArrowLen, arrowStartX: rightArrowStartX, arrowStartY: rightArrowStartY, name: 'right' });
    }

    // Left of target
    const leftX = targetRect.x - boxWidth - gap;
    const leftY = Math.max(edgeMargin, targetCenterY - boxHeight / 2);
    const leftClampedX = Math.max(edgeMargin, Math.min(leftX, imgWidth - boxWidth - edgeMargin));
    const leftClampedY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(leftY, imgHeight - boxHeight - edgeMargin));
    const leftArrowStartX = leftClampedX + boxWidth;
    const leftArrowStartY = Math.max(leftClampedY + 15, Math.min(targetCenterY, leftClampedY + boxHeight - 15));
    const leftArrowLen = distance(leftArrowStartX, leftArrowStartY, targetCenterX, targetCenterY);
    const leftCardRect = { x: leftClampedX, y: leftClampedY, w: boxWidth, h: boxHeight };
    if (!rectsOverlap(leftCardRect, targetRect, 10) && !overlapsPlacedCards(leftCardRect) && leftArrowLen >= ARROW_MIN_LENGTH && leftArrowLen <= ARROW_MAX_LENGTH) {
      candidates.push({ x: leftClampedX, y: leftClampedY, arrowLength: leftArrowLen, arrowStartX: leftArrowStartX, arrowStartY: leftArrowStartY, name: 'left' });
    }

    // Above target
    const aboveX = Math.max(edgeMargin, targetCenterX - boxWidth / 2);
    const aboveY = targetRect.y - boxHeight - gap;
    const aboveClampedX = Math.max(edgeMargin, Math.min(aboveX, imgWidth - boxWidth - edgeMargin));
    const aboveClampedY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(aboveY, imgHeight - boxHeight - edgeMargin));
    const aboveArrowStartX = Math.max(aboveClampedX + 15, Math.min(targetCenterX, aboveClampedX + boxWidth - 15));
    const aboveArrowStartY = aboveClampedY + boxHeight;
    const aboveArrowLen = distance(aboveArrowStartX, aboveArrowStartY, targetCenterX, targetCenterY);
    const aboveCardRect = { x: aboveClampedX, y: aboveClampedY, w: boxWidth, h: boxHeight };
    if (!rectsOverlap(aboveCardRect, targetRect, 10) && !overlapsPlacedCards(aboveCardRect) && aboveArrowLen >= ARROW_MIN_LENGTH && aboveArrowLen <= ARROW_MAX_LENGTH) {
      candidates.push({ x: aboveClampedX, y: aboveClampedY, arrowLength: aboveArrowLen, arrowStartX: aboveArrowStartX, arrowStartY: aboveArrowStartY, name: 'above' });
    }

    // Below target
    const belowX = Math.max(edgeMargin, targetCenterX - boxWidth / 2);
    const belowY = targetRect.y + targetRect.h + gap;
    const belowClampedX = Math.max(edgeMargin, Math.min(belowX, imgWidth - boxWidth - edgeMargin));
    const belowClampedY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(belowY, imgHeight - boxHeight - edgeMargin));
    const belowArrowStartX = Math.max(belowClampedX + 15, Math.min(targetCenterX, belowClampedX + boxWidth - 15));
    const belowArrowStartY = belowClampedY;
    const belowArrowLen = distance(belowArrowStartX, belowArrowStartY, targetCenterX, targetCenterY);
    const belowCardRect = { x: belowClampedX, y: belowClampedY, w: boxWidth, h: boxHeight };
    if (!rectsOverlap(belowCardRect, targetRect, 10) && !overlapsPlacedCards(belowCardRect) && belowArrowLen >= ARROW_MIN_LENGTH && belowArrowLen <= ARROW_MAX_LENGTH) {
      candidates.push({ x: belowClampedX, y: belowClampedY, arrowLength: belowArrowLen, arrowStartX: belowArrowStartX, arrowStartY: belowArrowStartY, name: 'below' });
    }
  }

  // Sort candidates by distance from ideal arrow length (prefer 80-120px)
  candidates.sort((a, b) => {
    const aDistFromIdeal = Math.abs(a.arrowLength - ARROW_IDEAL_LENGTH);
    const bDistFromIdeal = Math.abs(b.arrowLength - ARROW_IDEAL_LENGTH);
    return aDistFromIdeal - bDistFromIdeal;
  });

  // Use best candidate, or fallback to a close position
  let boxX: number;
  let boxY: number;

  if (candidates.length > 0) {
    const best = candidates[0];
    boxX = best.x;
    boxY = best.y;
    console.log(`[drawing] Best position: ${best.name}, arrow length: ${Math.round(best.arrowLength)}px`);
  } else {
    // Fallback: position close to target (right side preferred)
    boxX = Math.min(targetRect.x + targetRect.w + 40, imgWidth - boxWidth - edgeMargin);
    boxY = Math.max(edgeMargin + BADGE_RADIUS + 10, targetCenterY - boxHeight / 2);
    boxX = Math.max(edgeMargin, boxX);
    boxY = Math.min(boxY, imgHeight - boxHeight - edgeMargin);
    console.log(`[drawing] Using fallback position (no valid candidates found)`);
  }

  // Final clamp to ensure within bounds
  boxX = Math.max(edgeMargin, Math.min(boxX, imgWidth - boxWidth - edgeMargin));
  boxY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(boxY, imgHeight - boxHeight - edgeMargin));

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

  // ========== 4. DRAW STRAIGHT ARROW - STRICT RULE: NEVER THROUGH CARD ==========
  // Arrow MUST exit from the correct card edge facing the target
  // Arrow MUST NOT pass through the card body

  const ARROW_MARGIN = 8; // Safety margin from element edge

  let arrowStartX: number;
  let arrowStartY: number;
  let arrowEndX: number;
  let arrowEndY: number;

  // Calculate card center
  const cardCenterX = boxX + boxWidth / 2;
  const cardCenterY = boxY + boxHeight / 2;

  // Calculate angle from card center to target center
  const angleToTarget = Math.atan2(targetCenterY - cardCenterY, targetCenterX - cardCenterX);
  const angleDeg = angleToTarget * 180 / Math.PI;

  // Determine which edge to exit from based on angle
  // -45 to 45 = RIGHT edge
  // 45 to 135 = BOTTOM edge
  // 135 to 180 or -180 to -135 = LEFT edge
  // -135 to -45 = TOP edge

  if (angleDeg >= -45 && angleDeg < 45) {
    // Target is to the RIGHT - exit from right edge
    arrowStartX = boxX + boxWidth;
    arrowStartY = cardCenterY + Math.tan(angleToTarget) * (boxWidth / 2);
    // Clamp Y to card bounds
    arrowStartY = Math.max(boxY + 10, Math.min(arrowStartY, boxY + boxHeight - 10));
    // Arrow ends at left edge of target
    arrowEndX = targetRect.x - ARROW_MARGIN;
    arrowEndY = targetCenterY;
  } else if (angleDeg >= 45 && angleDeg < 135) {
    // Target is BELOW - exit from bottom edge
    arrowStartY = boxY + boxHeight;
    arrowStartX = cardCenterX + (boxHeight / 2) / Math.tan(angleToTarget);
    // Clamp X to card bounds
    arrowStartX = Math.max(boxX + 10, Math.min(arrowStartX, boxX + boxWidth - 10));
    // Arrow ends at top edge of target
    arrowEndX = targetCenterX;
    arrowEndY = targetRect.y - ARROW_MARGIN;
  } else if (angleDeg >= 135 || angleDeg < -135) {
    // Target is to the LEFT - exit from left edge
    arrowStartX = boxX;
    arrowStartY = cardCenterY - Math.tan(angleToTarget) * (boxWidth / 2);
    // Clamp Y to card bounds
    arrowStartY = Math.max(boxY + 10, Math.min(arrowStartY, boxY + boxHeight - 10));
    // Arrow ends at right edge of target
    arrowEndX = targetRect.x + targetRect.w + ARROW_MARGIN;
    arrowEndY = targetCenterY;
  } else {
    // Target is ABOVE (-135 to -45) - exit from top edge
    arrowStartY = boxY;
    arrowStartX = cardCenterX - (boxHeight / 2) / Math.tan(angleToTarget);
    // Clamp X to card bounds
    arrowStartX = Math.max(boxX + 10, Math.min(arrowStartX, boxX + boxWidth - 10));
    // Arrow ends at bottom edge of target
    arrowEndX = targetCenterX;
    arrowEndY = targetRect.y + targetRect.h + ARROW_MARGIN;
  }

  // SAFETY CHECK: Verify arrow doesn't pass through card
  // If start point is somehow inside card, force it to nearest edge
  if (arrowStartX > boxX && arrowStartX < boxX + boxWidth &&
      arrowStartY > boxY && arrowStartY < boxY + boxHeight) {
    console.log(`[drawing] WARNING: Arrow start inside card, correcting...`);
    // Find closest edge
    const distToLeft = arrowStartX - boxX;
    const distToRight = boxX + boxWidth - arrowStartX;
    const distToTop = arrowStartY - boxY;
    const distToBottom = boxY + boxHeight - arrowStartY;
    const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

    if (minDist === distToLeft) arrowStartX = boxX;
    else if (minDist === distToRight) arrowStartX = boxX + boxWidth;
    else if (minDist === distToTop) arrowStartY = boxY;
    else arrowStartY = boxY + boxHeight;
  }

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
