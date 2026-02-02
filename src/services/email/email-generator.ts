import { GoogleGenerativeAI } from '@google/generative-ai';
import { PromptContext, GeneratedEmail, EmailGenerationOptions, DEFAULT_EMAIL_OPTIONS } from './types';
import { buildEmailPrompt, countWords, truncateToWordLimit } from './prompt-template';

export class EmailGenerator {
  private genAI: GoogleGenerativeAI;
  private model;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is required');
    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async generateEmail(
    context: PromptContext,
    options?: Partial<EmailGenerationOptions>
  ): Promise<GeneratedEmail> {
    const opts = { ...DEFAULT_EMAIL_OPTIONS, ...options };
    const prompt = buildEmailPrompt(context, opts);

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

  private generateFallback(context: PromptContext): GeneratedEmail {
    const subject = `Quick question about ${context.companyName}'s website`;
    const body = `Hi ${context.contactName},\n\nI ran a quick scan of ${context.websiteUrl} and found ${context.problemCount} area${context.problemCount !== 1 ? 's' : ''} that could be improved — the most notable being ${context.worstProblem.toLowerCase()}. I've attached an annotated screenshot highlighting the specifics.\n\nWould you be open to a brief chat about addressing these?`;

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
    options?: Partial<EmailGenerationOptions>
  ): Promise<GeneratedEmail[]> {
    const results: GeneratedEmail[] = [];

    for (let i = 0; i < contexts.length; i++) {
      try {
        const email = await this.generateEmail(contexts[i], options);
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
