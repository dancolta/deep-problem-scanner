import sharp from 'sharp';
import { detectAnnotations } from './gemini-vision';
import { drawAnnotations } from './drawing';
import { compressImage, compressForEmail, getImageInfo } from './compression';
import { AnnotatedImage, AnnotationCoord, AnnotationOptions } from './types';
import { DiagnosticResult } from '../scanner/types';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateCompanySlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export class AnnotationService {
  async annotateScreenshot(
    screenshotBuffer: Buffer,
    diagnostics: DiagnosticResult[],
    url: string,
    companySlug: string,
    options?: Partial<AnnotationOptions>
  ): Promise<AnnotatedImage> {
    // Step 0 — Get actual image dimensions for accurate Gemini coordinates
    const realBuf = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer);
    const meta = await sharp(realBuf).metadata();
    const actualWidth = meta.width ?? 1920;
    const actualHeight = meta.height ?? 1080;
    const mergedOptions: Partial<AnnotationOptions> = {
      ...options,
      screenshotWidth: actualWidth,
      screenshotHeight: actualHeight,
    };

    // Step 1 — Detect annotations (Gemini Vision)
    let annotations: AnnotationCoord[] = [];
    try {
      const result = await detectAnnotations(screenshotBuffer, diagnostics, url, mergedOptions);
      annotations = result.annotations;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      console.error('[AnnotationService] Gemini Vision failed, proceeding without annotations:', msg);
      console.error('[AnnotationService] Stack:', stack);
    }

    // Step 2 — Draw annotations (Sharp)
    let annotatedBuffer = screenshotBuffer;
    if (annotations.length > 0) {
      try {
        annotatedBuffer = await drawAnnotations(screenshotBuffer, annotations);
      } catch (error) {
        console.error('[AnnotationService] Drawing failed, using original screenshot:', error);
        annotatedBuffer = screenshotBuffer;
      }
    }

    // Step 3 — Compress for Drive (500KB target)
    let finalBuffer = annotatedBuffer;
    try {
      finalBuffer = await compressImage(annotatedBuffer, 500);
    } catch (error) {
      console.error('[AnnotationService] Compression failed, using uncompressed image:', error);
      finalBuffer = annotatedBuffer;
    }

    // Step 4 — Compress for email embedding (300KB target, 1200px width)
    let emailBuffer = annotatedBuffer;
    try {
      emailBuffer = await compressForEmail(annotatedBuffer, 300, 1200);
    } catch (error) {
      console.error('[AnnotationService] Email compression failed, using Drive buffer:', error);
      emailBuffer = finalBuffer;
    }

    // Step 5 — Generate filename and metadata
    const filename = `${companySlug}_homepage_scan_${formatDate(new Date())}.png`;
    const info = await getImageInfo(finalBuffer);

    return {
      buffer: finalBuffer,
      emailBuffer,
      filename,
      sizeKB: info.sizeKB,
      format: info.format,
      annotationCount: annotations.length,
      annotationLabels: annotations.map(a => a.label),
      width: info.width,
      height: info.height,
    };
  }
}
