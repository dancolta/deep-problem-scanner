import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

// Mock gemini-vision to return predictable annotations
vi.mock('../src/services/annotation/gemini-vision', () => ({
  detectAnnotations: vi.fn().mockResolvedValue({
    annotations: [
      { x: 100, y: 100, width: 200, height: 100, label: 'Test Issue', severity: 'warning', description: 'desc' },
    ],
    rawAnalysis: '{}',
    problemCount: 1,
  }),
}));

// Mock drawing to return the same buffer (pass-through)
vi.mock('../src/services/annotation/drawing', () => ({
  drawAnnotations: vi.fn().mockImplementation((buf: Buffer) => Promise.resolve(buf)),
}));

import { AnnotationService } from '../src/services/annotation/annotation-service';

async function createTestImage(): Promise<Buffer> {
  return sharp({
    create: { width: 1440, height: 900, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

describe('AnnotationService', () => {
  it('returns both buffer and emailBuffer', async () => {
    const service = new AnnotationService();
    const src = await createTestImage();
    const result = await service.annotateScreenshot(src, [], 'https://example.com', 'test-co');

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.emailBuffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.emailBuffer.length).toBeGreaterThan(0);
  });

  it('emailBuffer is smaller or equal to main buffer', async () => {
    const service = new AnnotationService();
    const src = await createTestImage();
    const result = await service.annotateScreenshot(src, [], 'https://example.com', 'test-co');

    // emailBuffer targets 300KB/1200px vs main buffer at 500KB/full width
    expect(result.emailBuffer.length).toBeLessThanOrEqual(result.buffer.length + 1024);
  });

  it('generates correct filename with slug and date', async () => {
    const service = new AnnotationService();
    const src = await createTestImage();
    const result = await service.annotateScreenshot(src, [], 'https://example.com', 'acme-corp');

    expect(result.filename).toMatch(/^acme-corp_homepage_scan_\d{4}-\d{2}-\d{2}\.png$/);
  });

  it('reports annotation count from gemini', async () => {
    const service = new AnnotationService();
    const src = await createTestImage();
    const result = await service.annotateScreenshot(src, [], 'https://example.com', 'test');

    expect(result.annotationCount).toBe(1);
  });

  it('format is always png', async () => {
    const service = new AnnotationService();
    const src = await createTestImage();
    const result = await service.annotateScreenshot(src, [], 'https://example.com', 'test');

    expect(result.format).toBe('png');
  });
});
