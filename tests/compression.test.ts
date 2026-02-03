import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compressImage, compressForEmail, getImageInfo } from '../src/services/annotation/compression';

// Helper: create a test PNG buffer of given dimensions
async function createTestImage(width: number, height: number, color = '#ff0000'): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe('compressImage', () => {
  it('returns a PNG buffer', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressImage(src);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('png');
  });

  it('defaults to 500KB target', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressImage(src);
    // A simple solid-color image will easily be under 500KB
    expect(result.length / 1024).toBeLessThanOrEqual(500);
  });

  it('does NOT produce a JPEG even when image is large', async () => {
    // Create a noisy image that's harder to compress
    const src = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const result = await compressImage(src, 500);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('png');
    // Should never fall back to JPEG
    expect(meta.format).not.toBe('jpeg');
  });

  it('respects custom maxSizeKB', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressImage(src, 50);
    expect(result.length / 1024).toBeLessThanOrEqual(55); // small tolerance
  });
});

describe('compressForEmail', () => {
  it('returns a PNG buffer', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressForEmail(src);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('png');
  });

  it('defaults to 300KB target and 1200px max width', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressForEmail(src);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(result.length / 1024).toBeLessThanOrEqual(300);
  });

  it('does not upscale smaller images', async () => {
    const src = await createTestImage(800, 500);
    const result = await compressForEmail(src, 300, 1200);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBeLessThanOrEqual(800);
  });

  it('respects custom maxWidth', async () => {
    const src = await createTestImage(1440, 900);
    const result = await compressForEmail(src, 300, 600);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBeLessThanOrEqual(600);
  });
});

describe('getImageInfo', () => {
  it('returns correct dimensions and format', async () => {
    const src = await createTestImage(800, 600);
    const info = await getImageInfo(src);
    expect(info.width).toBe(800);
    expect(info.height).toBe(600);
    expect(info.format).toBe('png');
    expect(info.sizeKB).toBeGreaterThan(0);
  });
});
