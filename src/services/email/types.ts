export interface PromptContext {
  companyName: string;
  contactName: string;
  websiteUrl: string;
  diagnosticsSummary: string;
  screenshotUrl: string;
  annotationLabels: string[];
  problemCount: number;
  worstProblem: string;
  loadTimeSeconds?: number; // Page load time for primary hook
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  wordCount: number;
  generatedAt: string;
  wasAIGenerated: boolean;
}

export interface EmailGenerationOptions {
  maxBodyWords: number;
  maxSubjectChars: number;
  tone: 'professional' | 'casual' | 'friendly';
  includeScreenshotMention: boolean;
}

export const DEFAULT_EMAIL_OPTIONS: EmailGenerationOptions = {
  maxBodyWords: 80,
  maxSubjectChars: 80,
  tone: 'professional',
  includeScreenshotMention: true,
};
