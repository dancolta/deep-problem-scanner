import { describe, it, expect } from 'vitest';
import type { AnnotatedImage } from '../src/services/annotation/types';

describe('AnnotatedImage type', () => {
  it('should include emailBuffer field', () => {
    const img: AnnotatedImage = {
      buffer: Buffer.from('main'),
      emailBuffer: Buffer.from('email'),
      filename: 'test.png',
      sizeKB: 100,
      format: 'png',
      annotationCount: 3,
      width: 1440,
      height: 900,
    };
    expect(img.emailBuffer).toBeDefined();
    expect(img.emailBuffer).toBeInstanceOf(Buffer);
    expect(img.emailBuffer.toString()).toBe('email');
  });
});
