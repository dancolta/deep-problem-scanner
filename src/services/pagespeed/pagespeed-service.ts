import { createLogger } from '../../utils/logger';

const log = createLogger('PageSpeedService');

export interface PageSpeedScores {
  performance: number;      // 0-100
  accessibility: number;    // 0-100
  seo: number;              // 0-100
  bestPractices: number;    // 0-100
  fetchedAt: string;
}

export interface PageSpeedResult {
  success: boolean;
  scores?: PageSpeedScores;
  error?: string;
}

/**
 * PageSpeed Insights API Service
 * Fetches Lighthouse scores from Google's PageSpeed Insights API
 *
 * Web app compatible: Uses only HTTP calls, no local Chrome required
 */
export class PageSpeedService {
  private apiKey?: string;
  private baseUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.PAGESPEED_API_KEY;
  }

  /**
   * Fetch PageSpeed scores for a URL
   * @param url - The URL to analyze
   * @param strategy - 'desktop' or 'mobile' (default: desktop)
   */
  async getScores(url: string, strategy: 'desktop' | 'mobile' = 'desktop'): Promise<PageSpeedResult> {
    try {
      // Build API URL
      const params = new URLSearchParams({
        url: url,
        strategy: strategy,
        category: 'performance',
      });

      // Add multiple categories
      params.append('category', 'accessibility');
      params.append('category', 'seo');
      params.append('category', 'best-practices');

      // Add API key if available (higher rate limits)
      if (this.apiKey) {
        params.append('key', this.apiKey);
      }

      const apiUrl = `${this.baseUrl}?${params.toString()}`;
      log.info(`Fetching PageSpeed scores for ${url} (${strategy})`);

      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`PageSpeed API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `API returned ${response.status}: ${errorText.substring(0, 200)}`,
        };
      }

      const data = await response.json();

      // Extract scores from Lighthouse result
      const categories = data.lighthouseResult?.categories;
      if (!categories) {
        log.error('No categories in PageSpeed response');
        return {
          success: false,
          error: 'Invalid API response: no categories found',
        };
      }

      const scores: PageSpeedScores = {
        performance: Math.round((categories.performance?.score || 0) * 100),
        accessibility: Math.round((categories.accessibility?.score || 0) * 100),
        seo: Math.round((categories.seo?.score || 0) * 100),
        bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
        fetchedAt: new Date().toISOString(),
      };

      log.info(`PageSpeed scores for ${url}: Performance=${scores.performance}, Accessibility=${scores.accessibility}, SEO=${scores.seo}, Best Practices=${scores.bestPractices}`);

      return {
        success: true,
        scores,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`PageSpeed fetch failed: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Convert PageSpeed scores to diagnostic results format
   */
  scoresToDiagnostics(scores: PageSpeedScores): Array<{
    name: string;
    status: 'pass' | 'warning' | 'fail';
    details: string;
    score: number;
  }> {
    const toStatus = (score: number): 'pass' | 'warning' | 'fail' => {
      if (score >= 90) return 'pass';
      if (score >= 50) return 'warning';
      return 'fail';
    };

    return [
      {
        name: 'Performance Score',
        status: toStatus(scores.performance),
        details: `Google Lighthouse performance score: ${scores.performance}/100`,
        score: scores.performance,
      },
      {
        name: 'Accessibility Score',
        status: toStatus(scores.accessibility),
        details: `Google Lighthouse accessibility score: ${scores.accessibility}/100`,
        score: scores.accessibility,
      },
      {
        name: 'SEO Score',
        status: toStatus(scores.seo),
        details: `Google Lighthouse SEO score: ${scores.seo}/100`,
        score: scores.seo,
      },
      {
        name: 'Best Practices Score',
        status: toStatus(scores.bestPractices),
        details: `Google Lighthouse best practices score: ${scores.bestPractices}/100`,
        score: scores.bestPractices,
      },
    ];
  }
}
