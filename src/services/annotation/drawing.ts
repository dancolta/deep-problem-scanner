import sharp from 'sharp';
import { AnnotationCoord, AnnotationSeverity } from './types';

const SEVERITY_COLORS: Record<AnnotationSeverity, string> = {
  critical: '#e94560',
  warning: '#f59e0b',
  info: '#3b82f6',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getSeverityColor(severity: AnnotationSeverity): string {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
}

function calculateLabelPosition(
  ann: AnnotationCoord,
  imgWidth: number,
  imgHeight: number
): { x: number; y: number } {
  const textWidth = Math.max(ann.label.length * 8 + 16, 32);
  const labelAboveY = ann.y - 28;
  const labelBelowY = ann.y + ann.height + 4;

  const y = labelAboveY >= 0 ? labelAboveY : labelBelowY;
  let x = ann.x;

  if (x + textWidth > imgWidth) {
    x = Math.max(0, imgWidth - textWidth);
  }

  return { x, y };
}

function clampAnnotation(
  ann: AnnotationCoord,
  imgWidth: number,
  imgHeight: number
): AnnotationCoord {
  const x = Math.max(0, Math.min(ann.x, imgWidth - 1));
  const y = Math.max(0, Math.min(ann.y, imgHeight - 1));
  const width = Math.min(ann.width, imgWidth - x);
  const height = Math.min(ann.height, imgHeight - y);
  return { ...ann, x, y, width, height };
}

function buildAnnotationSvg(
  ann: AnnotationCoord,
  index: number,
  imgWidth: number,
  imgHeight: number
): string {
  const clamped = clampAnnotation(ann, imgWidth, imgHeight);
  const color = getSeverityColor(clamped.severity);
  const parts: string[] = [];

  // Rectangle border
  parts.push(
    `<rect x="${clamped.x}" y="${clamped.y}" width="${clamped.width}" height="${clamped.height}" ` +
      `fill="none" stroke="${color}" stroke-width="3" rx="4" ry="4" />`
  );

  // Label badge
  const label = clamped.label || '';
  if (label.length > 0) {
    const textWidth = Math.max(label.length * 8 + 16, 32);
    const labelPos = calculateLabelPosition(clamped, imgWidth, imgHeight);

    parts.push(
      `<rect x="${labelPos.x}" y="${labelPos.y}" width="${textWidth}" height="24" ` +
        `fill="${color}" rx="12" ry="12" />`
    );
    parts.push(
      `<text x="${labelPos.x + 8}" y="${labelPos.y + 16}" ` +
        `font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" ` +
        `fill="white">${escapeXml(label)}</text>`
    );
  }

  // Number badge
  const cx = clamped.x + clamped.width - 12;
  const cy = clamped.y - 12;
  const badgeCx = Math.max(12, Math.min(cx, imgWidth - 12));
  const badgeCy = Math.max(12, cy);

  parts.push(
    `<circle cx="${badgeCx}" cy="${badgeCy}" r="12" fill="${color}" />`
  );
  parts.push(
    `<text x="${badgeCx}" y="${badgeCy + 4}" text-anchor="middle" ` +
      `font-family="Arial" font-size="12" font-weight="bold" fill="white">${index + 1}</text>`
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

  const metadata = await sharp(screenshotBuffer).metadata();
  const imgWidth = metadata.width ?? 1920;
  const imgHeight = metadata.height ?? 1080;

  const svgElements = annotations
    .map((ann, i) => buildAnnotationSvg(ann, i, imgWidth, imgHeight))
    .join('\n  ');

  const svgString =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">\n` +
    `  ${svgElements}\n` +
    `</svg>`;

  const annotatedBuffer = await sharp(screenshotBuffer)
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
