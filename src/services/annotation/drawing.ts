import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

// ============================================================================
// STRICT ANNOTATION RULES
// ============================================================================
// 1. Card has FIXED MAX WIDTH (280px) - text MUST wrap within this
// 2. Text ALWAYS stays inside the card - never overflow
// 3. Long text wraps to multiple lines, card height adjusts
// 4. Arrow is ALWAYS a straight line (never curved)
// 5. Arrow points EXACTLY to target element center
// 6. Arrow starts from card EDGE (not inside card)
// 7. Badge is ABOVE card, never overlapping
// ============================================================================

const ANNOTATION_COLOR = '#dc2626'; // Red for all annotations
const CARD_MAX_WIDTH = 280; // Fixed max width
const CARD_PADDING = 14;
const LABEL_FONT_SIZE = 14;
const IMPACT_FONT_SIZE = 11;
const LINE_HEIGHT = 18;
const CHAR_WIDTH = 7.5; // Approximate pixels per character at 14px font

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

function buildAnnotationSvg(
  ann: AnnotationCoord,
  index: number,
  imgWidth: number,
  imgHeight: number
): string {
  const clamped = clampAnnotation(ann, imgWidth, imgHeight);
  const parts: string[] = [];

  // TARGET POINT - exact center of the element with issue
  const targetX = clamped.x + clamped.width / 2;
  const targetY = clamped.y + clamped.height / 2;

  const label = clamped.label || '';
  const rawImpact = clamped.conversionImpact || '';

  if (label.length === 0) return '';

  // ========== TEXT WRAPPING ==========
  // Calculate max characters per line based on fixed width
  const textAreaWidth = CARD_MAX_WIDTH - CARD_PADDING * 2 - 10; // Account for left accent
  const maxCharsPerLine = Math.floor(textAreaWidth / CHAR_WIDTH);

  // Wrap label text
  const labelLines = wrapText(label, maxCharsPerLine);

  // Wrap impact text (slightly smaller font)
  const impactLines = rawImpact
    ? wrapText(rawImpact, Math.floor(textAreaWidth / (CHAR_WIDTH * 0.85)))
    : [];

  // ========== CALCULATE CARD DIMENSIONS ==========
  const boxWidth = CARD_MAX_WIDTH;
  let boxHeight = CARD_PADDING * 2; // Top and bottom padding
  boxHeight += labelLines.length * LINE_HEIGHT; // Label lines
  if (impactLines.length > 0) {
    boxHeight += 8; // Gap between label and impact
    boxHeight += impactLines.length * (LINE_HEIGHT - 4); // Impact lines (smaller)
  }

  // ========== POSITION CARD ==========
  // Try positions in order: top-right, top-left, bottom-right, bottom-left
  let boxX: number;
  let boxY: number;

  const margin = 60; // Distance from target
  const edgeMargin = 20; // Distance from image edge

  // Determine best position based on target location
  const targetInLeftHalf = targetX < imgWidth / 2;
  const targetInTopHalf = targetY < imgHeight / 2;

  if (targetInLeftHalf) {
    // Target is on left, place card on right
    boxX = targetX + margin;
  } else {
    // Target is on right, place card on left
    boxX = targetX - boxWidth - margin;
  }

  if (targetInTopHalf) {
    // Target is in top, place card below or at same level
    boxY = targetY + margin / 2;
  } else {
    // Target is in bottom, place card above
    boxY = targetY - boxHeight - margin;
  }

  // Clamp to image bounds
  boxX = Math.max(edgeMargin, Math.min(boxX, imgWidth - boxWidth - edgeMargin));
  boxY = Math.max(edgeMargin + 20, Math.min(boxY, imgHeight - boxHeight - edgeMargin));

  // ========== 1. DRAW CARD ==========
  parts.push(
    `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" ` +
      `fill="white" stroke="#e5e7eb" stroke-width="1" rx="8" ry="8" filter="url(#shadow)" />`
  );
  // Red left accent
  parts.push(
    `<rect x="${boxX}" y="${boxY + 4}" width="4" height="${boxHeight - 8}" ` +
      `fill="${ANNOTATION_COLOR}" rx="2" ry="2" />`
  );

  // ========== 2. DRAW TEXT (always inside card) ==========
  let textY = boxY + CARD_PADDING + LABEL_FONT_SIZE - 2;
  const textX = boxX + 14;

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
    textY += 4; // Gap
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
  const badgeRadius = 11;
  const badgeX = boxX + boxWidth - badgeRadius - 6;
  const badgeY = boxY - badgeRadius - 6;

  parts.push(
    `<circle cx="${badgeX}" cy="${badgeY}" r="${badgeRadius}" fill="${ANNOTATION_COLOR}" />`,
    `<text x="${badgeX}" y="${badgeY + 4}" text-anchor="middle" ` +
      `font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="bold" fill="white">${index + 1}</text>`
  );

  // ========== 4. DRAW STRAIGHT ARROW ==========
  // Arrow starts from card edge closest to target
  // Arrow ends at target center

  // Determine which edge of card to start from
  const cardCenterX = boxX + boxWidth / 2;
  const cardCenterY = boxY + boxHeight / 2;

  let arrowStartX: number;
  let arrowStartY: number;

  // Find the card edge point closest to target
  if (targetX < boxX) {
    // Target is to the left of card
    arrowStartX = boxX;
    arrowStartY = Math.max(boxY + 10, Math.min(targetY, boxY + boxHeight - 10));
  } else if (targetX > boxX + boxWidth) {
    // Target is to the right of card
    arrowStartX = boxX + boxWidth;
    arrowStartY = Math.max(boxY + 10, Math.min(targetY, boxY + boxHeight - 10));
  } else if (targetY < boxY) {
    // Target is above card
    arrowStartX = Math.max(boxX + 10, Math.min(targetX, boxX + boxWidth - 10));
    arrowStartY = boxY;
  } else {
    // Target is below card
    arrowStartX = Math.max(boxX + 10, Math.min(targetX, boxX + boxWidth - 10));
    arrowStartY = boxY + boxHeight;
  }

  // STRAIGHT LINE from card edge to target
  parts.push(
    `<line x1="${arrowStartX}" y1="${arrowStartY}" x2="${targetX}" y2="${targetY}" ` +
      `stroke="${ANNOTATION_COLOR}" stroke-width="2" />`
  );

  // ARROWHEAD pointing at target
  const angle = Math.atan2(targetY - arrowStartY, targetX - arrowStartX);
  const arrowSize = 10;
  const arrowAngle = Math.PI / 6; // 30 degrees

  const ax1 = targetX - arrowSize * Math.cos(angle - arrowAngle);
  const ay1 = targetY - arrowSize * Math.sin(angle - arrowAngle);
  const ax2 = targetX - arrowSize * Math.cos(angle + arrowAngle);
  const ay2 = targetY - arrowSize * Math.sin(angle + arrowAngle);

  parts.push(
    `<polygon points="${targetX},${targetY} ${ax1},${ay1} ${ax2},${ay2}" fill="${ANNOTATION_COLOR}" />`
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
