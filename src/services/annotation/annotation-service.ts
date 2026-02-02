import { detectAnnotations } from './gemini-vision';
import { drawAnnotations } from './drawing';
import { compressImage, getImageInfo } from './compression';
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
    // Step 1 — Detect annotations (Gemini Vision)
    let annotations: AnnotationCoord[] = [];
    try {
      const result = await detectAnnotations(screenshotBuffer, diagnostics, url, options);
      annotations = result.annotations;
    } catch (error) {
      console.error('[AnnotationService] Gemini Vision failed, proceeding without annotations:', error);
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

    // Step 3 — Compress
    let finalBuffer = annotatedBuffer;
    try {
      finalBuffer = await compressImage(annotatedBuffer, 100);
    } catch (error) {
      console.error('[AnnotationService] Compression failed, using uncompressed image:', error);
      finalBuffer = annotatedBuffer;
    }

    // Step 4 — Generate filename and metadata
    const filename = `${companySlug}_homepage_scan_${formatDate(new Date())}.png`;
    const info = await getImageInfo(finalBuffer);

    return {
      buffer: finalBuffer,
      filename,
      sizeKB: info.sizeKB,
      format: info.format,
      annotationCount: annotations.length,
      width: info.width,
      height: info.height,
    };
  }
}
