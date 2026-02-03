import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

// ============================================================================
// STRICT ANNOTATION RULES (v2)
// ============================================================================
// 1. Card has FIXED MAX WIDTH - text MUST wrap within this
// 2. Text ALWAYS stays inside the card - never overflow
// 3. Long text wraps to multiple lines, card height adjusts
// 4. Arrow is ALWAYS a straight line (never curved)
// 5. Arrow points EXACTLY to target element CENTER
// 6. Arrow starts from card EDGE (not inside card)
// 7. Badge is ABOVE card, never overlapping
// 8. **NEW** Card NEVER overlaps with target element - strict check
// 9. **NEW** Sizes increased by 20% for better visibility
// ============================================================================

const ANNOTATION_COLOR = '#dc2626'; // Red for all annotations

// Sizes increased by 20%
const CARD_MAX_WIDTH = 336; // Was 280, now 336 (+20%)
const CARD_PADDING = 17; // Was 14, now ~17 (+20%)
const LABEL_FONT_SIZE = 17; // Was 14, now ~17 (+20%)
const IMPACT_FONT_SIZE = 13; // Was 11, now ~13 (+20%)
const LINE_HEIGHT = 22; // Was 18, now ~22 (+20%)
const CHAR_WIDTH = 9; // Was 7.5, now 9 (+20%)
const BADGE_RADIUS = 13; // Was 11, now ~13 (+20%)
const ARROW_WIDTH = 2.5; // Was 2, now 2.5 (+25%)
const ARROW_HEAD_SIZE = 12; // Was 10, now 12 (+20%)

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

function buildAnnotationSvg(
  ann: AnnotationCoord,
  index: number,
  imgWidth: number,
  imgHeight: number
): string {
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

  if (label.length === 0) return '';

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

  // ========== POSITION CARD (NEVER overlap target) ==========
  const edgeMargin = 25;
  const minGap = 20; // Minimum gap between card and target

  // Try 4 positions in order of preference, pick first that doesn't overlap
  const positions: Array<{ x: number; y: number; name: string }> = [];

  // Position 1: Right of target
  positions.push({
    x: targetRect.x + targetRect.w + minGap,
    y: Math.max(edgeMargin, targetCenterY - boxHeight / 2),
    name: 'right',
  });

  // Position 2: Left of target
  positions.push({
    x: targetRect.x - boxWidth - minGap,
    y: Math.max(edgeMargin, targetCenterY - boxHeight / 2),
    name: 'left',
  });

  // Position 3: Above target
  positions.push({
    x: Math.max(edgeMargin, targetCenterX - boxWidth / 2),
    y: targetRect.y - boxHeight - minGap,
    name: 'above',
  });

  // Position 4: Below target
  positions.push({
    x: Math.max(edgeMargin, targetCenterX - boxWidth / 2),
    y: targetRect.y + targetRect.h + minGap,
    name: 'below',
  });

  let boxX = positions[0].x;
  let boxY = positions[0].y;

  // Find first position that doesn't overlap with target
  for (const pos of positions) {
    // Clamp to image bounds first
    const clampedX = Math.max(edgeMargin, Math.min(pos.x, imgWidth - boxWidth - edgeMargin));
    const clampedY = Math.max(edgeMargin + BADGE_RADIUS + 10, Math.min(pos.y, imgHeight - boxHeight - edgeMargin));

    const cardRect = { x: clampedX, y: clampedY, w: boxWidth, h: boxHeight };

    if (!rectsOverlap(cardRect, targetRect, minGap)) {
      boxX = clampedX;
      boxY = clampedY;
      break;
    }
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
    `<text x="${badgeX}" y="${badgeY + 5}" text-anchor="middle" ` +
      `font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="white">${index + 1}</text>`
  );

  // ========== 4. DRAW STRAIGHT ARROW TO EXACT TARGET CENTER ==========
  // Arrow starts from card edge closest to target CENTER
  // Arrow ends EXACTLY at target element center

  let arrowStartX: number;
  let arrowStartY: number;

  // Determine which edge of card to start from based on target center position
  if (targetCenterX < boxX) {
    // Target center is to the left of card - start from left edge
    arrowStartX = boxX;
    arrowStartY = Math.max(boxY + 15, Math.min(targetCenterY, boxY + boxHeight - 15));
  } else if (targetCenterX > boxX + boxWidth) {
    // Target center is to the right of card - start from right edge
    arrowStartX = boxX + boxWidth;
    arrowStartY = Math.max(boxY + 15, Math.min(targetCenterY, boxY + boxHeight - 15));
  } else if (targetCenterY < boxY) {
    // Target center is above card - start from top edge
    arrowStartX = Math.max(boxX + 15, Math.min(targetCenterX, boxX + boxWidth - 15));
    arrowStartY = boxY;
  } else {
    // Target center is below card - start from bottom edge
    arrowStartX = Math.max(boxX + 15, Math.min(targetCenterX, boxX + boxWidth - 15));
    arrowStartY = boxY + boxHeight;
  }

  // STRAIGHT LINE from card edge to EXACT target center
  parts.push(
    `<line x1="${arrowStartX}" y1="${arrowStartY}" x2="${targetCenterX}" y2="${targetCenterY}" ` +
      `stroke="${ANNOTATION_COLOR}" stroke-width="${ARROW_WIDTH}" />`
  );

  // ARROWHEAD pointing EXACTLY at target center
  const angle = Math.atan2(targetCenterY - arrowStartY, targetCenterX - arrowStartX);
  const arrowAngle = Math.PI / 6; // 30 degrees

  const ax1 = targetCenterX - ARROW_HEAD_SIZE * Math.cos(angle - arrowAngle);
  const ay1 = targetCenterY - ARROW_HEAD_SIZE * Math.sin(angle - arrowAngle);
  const ax2 = targetCenterX - ARROW_HEAD_SIZE * Math.cos(angle + arrowAngle);
  const ay2 = targetCenterY - ARROW_HEAD_SIZE * Math.sin(angle + arrowAngle);

  parts.push(
    `<polygon points="${targetCenterX},${targetCenterY} ${ax1},${ay1} ${ax2},${ay2}" fill="${ANNOTATION_COLOR}" />`
  );

  return parts.join('\n  ');
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

  const svgElements = annotations
    .slice(0, 4) // Max 4 annotations
    .map((ann, i) => {
      console.log(`[drawing] Annotation ${i+1}: "${ann.label}" at (${ann.x}, ${ann.y}) ${ann.width}x${ann.height}`);
      return buildAnnotationSvg(ann, i, imgWidth, imgHeight);
    })
    .join('\n  ');

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
