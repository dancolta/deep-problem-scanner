import { describe, it, expect } from 'vitest';

// We can't import buildPrompt directly (not exported), so we test via the module's behavior.
// Instead, test the prompt structure by reading the source and checking key content.
import { readFileSync } from 'fs';
import { join } from 'path';

const sourceCode = readFileSync(
  join(__dirname, '../src/services/annotation/gemini-vision.ts'),
  'utf-8'
);

describe('gemini-vision homepage prompt', () => {
  it('contains hero section category', () => {
    expect(sourceCode).toContain('HERO SECTION');
    expect(sourceCode).toContain('call-to-action');
    expect(sourceCode).toContain('above the fold');
  });

  it('contains trust signals category', () => {
    expect(sourceCode).toContain('TRUST SIGNALS');
    expect(sourceCode).toContain('testimonials');
    expect(sourceCode).toContain('client logos');
  });

  it('contains load performance category', () => {
    expect(sourceCode).toContain('LOAD PERFORMANCE');
    expect(sourceCode).toContain('layout shift');
  });

  it('contains mobile readiness category', () => {
    expect(sourceCode).toContain('MOBILE READINESS');
    expect(sourceCode).toContain('responsive viewport');
  });

  it('contains navigation category', () => {
    expect(sourceCode).toContain('NAVIGATION');
    expect(sourceCode).toContain('menu hierarchy');
  });

  it('contains visual design category', () => {
    expect(sourceCode).toContain('VISUAL DESIGN');
    expect(sourceCode).toContain('contrast');
    expect(sourceCode).toContain('typography');
  });

  it('contains conversion elements category', () => {
    expect(sourceCode).toContain('CONVERSION ELEMENTS');
    expect(sourceCode).toContain('contact form');
    expect(sourceCode).toContain('phone number');
  });

  it('contains SEO signals category', () => {
    expect(sourceCode).toContain('SEO SIGNALS');
    expect(sourceCode).toContain('H1 tag');
    expect(sourceCode).toContain('page title');
  });

  it('uses persuasive business-owner tone', () => {
    expect(sourceCode).toContain('costs them customers');
    expect(sourceCode).toContain('business owner');
  });

  it('no longer contains the old generic prompt', () => {
    expect(sourceCode).not.toContain('You are a website UX/design analyst');
  });
});
