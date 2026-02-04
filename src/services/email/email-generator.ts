import { GoogleGenerativeAI } from '@google/generative-ai';
import { PromptContext, GeneratedEmail, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';
import { buildEmailPrompt, countWords, truncateToWordLimit, getTransitionSentence, BUZZWORD_BLACKLIST } from './prompt-template';

export class EmailGenerator {
  private genAI: GoogleGenerativeAI;
  private model;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is required');
    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  async generateEmail(
    context: PromptContext,
    options?: Partial<EmailGenerationOptions>,
    customTemplate?: string
  ): Promise<GeneratedEmail> {
    const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };
    const prompt = buildEmailPrompt(context, opts, customTemplate);

    // Attempt 1: Call Gemini
    let parsed = await this.callAndParse(prompt);

    // Attempt 2: Retry with stricter prompt if first attempt failed
    if (!parsed) {
      const stricterPrompt = prompt + '\n\nIMPORTANT: You MUST respond with ONLY valid JSON. No markdown, no code blocks, no explanation. Just the JSON object with "subject" and "body" keys.';
      parsed = await this.callAndParse(stricterPrompt);
    }

    // Attempt 3: Fallback template
    if (!parsed) {
      console.error('[EmailGenerator] AI generation failed, using fallback template');
      return this.generateFallback(context);
    }

    // Validate and enforce limits
    let subject = parsed.subject.trim();
    if (subject.length > opts.maxSubjectChars) {
      subject = subject.substring(0, opts.maxSubjectChars - 3) + '...';
    }

    let body = parsed.body.trim();

    // Replace [TRANSITION_SENTENCE] with the actual second paragraph
    // This is done AFTER AI generation to hide "hero" from the AI
    const transitionSentence = getTransitionSentence(context);
    body = body.replace(/\[TRANSITION_SENTENCE\]/g, transitionSentence);

    // Normalize spacing around [IMAGE]: no blank line before, one blank line after
    body = this.normalizeImageSpacing(body);

    // Apply buzzword blacklist to filter forbidden words/phrases
    body = this.applyBuzzwordBlacklist(body);

    const wordCount = countWords(body);
    if (wordCount > opts.maxBodyWords) {
      body = truncateToWordLimit(body, opts.maxBodyWords);
    }

    return {
      subject,
      body,
      wordCount: countWords(body),
      generatedAt: new Date().toISOString(),
      wasAIGenerated: true,
    };
  }

  private async callAndParse(prompt: string): Promise<{ subject: string; body: string } | null> {
    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text();

      // Try direct JSON parse
      try {
        const json = JSON.parse(text);
        if (json.subject && json.body) return json;
      } catch {
        // Not valid JSON, try extraction below
      }

      // Try extracting JSON from text (might be wrapped in markdown code block)
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const json = JSON.parse(jsonMatch[0]);
          if (json.subject && json.body) return json;
        } catch {
          // Extracted text was not valid JSON either
        }
      }

      console.error('[EmailGenerator] Failed to parse response:', text.substring(0, 200));
      return null;
    } catch (error) {
      console.error('[EmailGenerator] API call failed:', error);
      return null;
    }
  }

  /**
   * Apply buzzword blacklist to filter forbidden words/phrases from the email body.
   * Uses the centralized BUZZWORD_BLACKLIST for consistent filtering.
   */
  private applyBuzzwordBlacklist(body: string): string {
    let result = body;

    // Apply each blacklist pattern in order (more specific patterns first)
    for (const { pattern, replacement } of BUZZWORD_BLACKLIST) {
      result = result.replace(pattern, replacement);
    }

    // Clean up any artifacts from replacements
    result = result
      .replace(/\s{2,}/g, ' ')      // multiple spaces → single space
      .replace(/\s+\./g, '.')        // space before period
      .replace(/\s+,/g, ',')         // space before comma
      .replace(/,\s*,/g, ',')        // double commas
      .replace(/\.\s*\./g, '.');     // double periods

    return result;
  }

  /**
   * Normalize spacing around [IMAGE]:
   * - Single newline before [IMAGE] (no blank line)
   * - Double newline after [IMAGE] (one blank line)
   */
  private normalizeImageSpacing(body: string): string {
    // Replace any whitespace before [IMAGE] with single newline
    body = body.replace(/\n\s*\n\s*\[IMAGE\]/g, '\n[IMAGE]');
    // Replace any whitespace after [IMAGE] with double newline (one blank line)
    body = body.replace(/\[IMAGE\]\s*\n?/g, '[IMAGE]\n\n');
    // Clean up any triple+ newlines that might result
    body = body.replace(/\n{3,}/g, '\n\n');
    return body.trim();
  }

  private generateFallback(context: PromptContext): GeneratedEmail {
    const firstName = context.contactName.split(' ')[0];

    // Singular/plural for issues
    const issueCount = context.annotationLabels.length || context.problemCount || 1;
    const issueWord = issueCount === 1 ? 'issue' : 'issues';

    // Industry thresholds - only use metrics BELOW these values
    const thresholds: Record<string, number> = {
      'Performance Score': 50,
      'Accessibility Score': 70,
      'SEO Score': 80,
      'Best Practices Score': 70,
    };

    // Parse diagnostics to find poorest PageSpeed score that's BELOW threshold
    const pageSpeedMetrics = ['Performance Score', 'Accessibility Score', 'SEO Score', 'Best Practices Score'];
    let poorestPoorMetric: { name: string; score: number } | null = null;

    const diagParts = context.diagnosticsSummary.split(' | ');
    for (const part of diagParts) {
      const match = part.match(/^(.+?):\s*\w+\s*\((\d+)\/100\)/);
      if (match && pageSpeedMetrics.includes(match[1])) {
        const score = parseInt(match[2], 10);
        const threshold = thresholds[match[1]] || 70;
        // Only consider if BELOW threshold (genuinely poor)
        if (score < threshold) {
          if (!poorestPoorMetric || score < poorestPoorMetric.score) {
            poorestPoorMetric = { name: match[1], score };
          }
        }
      }
    }

    // Build intro based on genuinely poor metrics
    let introText: string;
    let subject: string;

    if (poorestPoorMetric) {
      const metricLabel = poorestPoorMetric.name.replace(' Score', '').toLowerCase();
      const impacts: Record<string, string> = {
        'Performance Score': "that's likely costing you conversions before visitors even see your offer",
        'Accessibility Score': "that's likely turning away visitors who can't easily use your site",
        'SEO Score': "that's likely hurting your visibility in search results",
        'Best Practices Score': "that could be affecting your site's security and user trust",
      };
      const impact = impacts[poorestPoorMetric.name] || "that could be affecting your conversions";
      introText = `Your website scores ${poorestPoorMetric.score}/100 on ${metricLabel}, ${impact}.`;
      subject = `${context.companyName}'s website ${metricLabel}`;
    } else {
      // All metrics are good - generic intro
      introText = `I ran a quick audit on your website and found some conversion opportunities.`;
      subject = `${context.companyName}'s website`;
    }

    const body = `Hi ${firstName},

${introText}

Also, your above-the-fold area has some ${issueWord} I've flagged below:
[IMAGE]

Want me to walk you through the rest of the findings? Takes 15 minutes.`;

    return {
      subject,
      body: truncateToWordLimit(body, DEFAULT_EMAIL_OPTIONS.maxBodyWords),
      wordCount: countWords(body),
      generatedAt: new Date().toISOString(),
      wasAIGenerated: false,
    };
  }

  async generateBatch(
    contexts: PromptContext[],
    options?: Partial<EmailGenerationOptions>,
    customTemplate?: string
  ): Promise<GeneratedEmail[]> {
    const results: GeneratedEmail[] = [];

    for (let i = 0; i < contexts.length; i++) {
      try {
        const email = await this.generateEmail(contexts[i], options, customTemplate);
        results.push(email);
        console.log(`[EmailGenerator] Generated ${i + 1}/${contexts.length}: ${email.subject}`);
      } catch (error) {
        console.error(`[EmailGenerator] Failed for ${contexts[i].companyName}:`, error);
        results.push(this.generateFallback(contexts[i]));
      }

      // Rate limit delay between calls (200ms)
      if (i < contexts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return results;
  }
}
