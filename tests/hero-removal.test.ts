import { EmailGenerator } from '../src/services/email/email-generator';

describe('removeHeroFromFirstParagraph', () => {
  // We need to test the private method, so we'll create a test harness
  // by extending the class or using any type cast

  const testRemoval = (input: string): string => {
    // Access private method via any cast for testing
    const generator = new EmailGenerator(process.env.GEMINI_API_KEY || 'test-key');
    return (generator as any).removeHeroFromFirstParagraph(input);
  };

  describe('should remove hero from intro paragraph', () => {
    test('removes "hero section" phrase', () => {
      const input = `Hi Sarah,

Your hero section has some conversion issues that could be impacting results.

Also, your hero section has some issues I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings?`;

      const result = testRemoval(input);

      // First paragraph (intro) should NOT contain "hero"
      const paragraphs = result.split(/\n\n+/);
      expect(paragraphs[1].toLowerCase()).not.toContain('hero');

      // Second paragraph (fixed) should STILL contain "hero"
      expect(paragraphs[2].toLowerCase()).toContain('hero');
    });

    test('removes "in your hero section"', () => {
      const input = `Hi John,

I spotted some conversion gaps in your hero section that are likely costing you leads.

Also, your hero section has some issues I've flagged below:
[IMAGE]`;

      const result = testRemoval(input);
      const paragraphs = result.split(/\n\n+/);
      expect(paragraphs[1].toLowerCase()).not.toContain('hero');
    });

    test('removes standalone "hero"', () => {
      const input = `Hi Mike,

Your hero lacks proper CTA placement and could be hurting conversions.

Also, your hero section has some issues I've flagged below:
[IMAGE]`;

      const result = testRemoval(input);
      const paragraphs = result.split(/\n\n+/);
      expect(paragraphs[1].toLowerCase()).not.toContain('hero');
    });

    test('handles multiple hero mentions in intro', () => {
      const input = `Hi Lisa,

Your hero section is slow and the hero image isn't optimized.

Also, your hero section has some issues I've flagged below:
[IMAGE]`;

      const result = testRemoval(input);
      const paragraphs = result.split(/\n\n+/);
      expect(paragraphs[1].toLowerCase()).not.toContain('hero');
    });

    test('preserves text when no hero in intro', () => {
      const input = `Hi Tom,

Your website scores 45/100 on performance, that's likely costing you conversions.

Also, your hero section has some issues I've flagged below:
[IMAGE]`;

      const result = testRemoval(input);
      expect(result).toBe(input);
    });

    test('handles single paragraph gracefully', () => {
      const input = `Hi Sarah, your hero section has issues.`;
      const result = testRemoval(input);
      expect(result).toBe(input); // Should return unchanged (not enough paragraphs)
    });

    test('cleans up artifacts after removal', () => {
      const input = `Hi Dan,

I found issues with your hero section, including slow load times.

Also, your hero section has some issues I've flagged below:`;

      const result = testRemoval(input);
      const paragraphs = result.split(/\n\n+/);

      // Should not have double commas or weird spacing
      expect(paragraphs[1]).not.toMatch(/\s*,\s*,\s*/);
      expect(paragraphs[1]).not.toMatch(/\s{2,}/);
    });
  });
});
