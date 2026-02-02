import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { EmailDraft } from '../../shared/types';

export class GmailService {
  private gmail: gmail_v1.Gmail;

  constructor(private authClient: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
  }

  async createDraft(draft: EmailDraft): Promise<{ draftId: string; threadId: string }> {
    let imageBuffer: Buffer | null = null;

    if (draft.screenshotDriveUrl) {
      imageBuffer = await this.fetchScreenshot(draft.screenshotDriveUrl);
    }

    // Build HTML body: wrap plain text in HTML with <p> tags
    const paragraphs = draft.body
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n');

    let htmlBody: string;
    if (imageBuffer) {
      htmlBody = `<html><body>${paragraphs}<br><p><img src="cid:screenshot" alt="Website Screenshot" style="max-width:100%;"></p></body></html>`;
    } else if (draft.screenshotDriveUrl) {
      // Fetch failed — include as a link instead
      htmlBody = `<html><body>${paragraphs}<br><p><a href="${draft.screenshotDriveUrl}">View Screenshot</a></p></body></html>`;
    } else {
      htmlBody = `<html><body>${paragraphs}</body></html>`;
    }

    const raw = this.buildMimeMessage(
      draft.to,
      draft.subject,
      htmlBody,
      imageBuffer ?? undefined,
      imageBuffer ? 'screenshot.png' : undefined
    );

    try {
      const response = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: { raw },
        },
      });

      return {
        draftId: response.data.id!,
        threadId: response.data.message?.threadId || '',
      };
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[GmailService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[GmailService] Quota exceeded or insufficient permissions');
      } else {
        console.error('[GmailService] Failed to create draft:', gaxiosError.message);
      }
      throw error;
    }
  }

  async sendDraft(draftId: string): Promise<{ messageId: string }> {
    try {
      const response = await this.gmail.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: draftId,
        },
      });

      return {
        messageId: response.data.id!,
      };
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[GmailService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[GmailService] Quota exceeded or insufficient permissions');
      } else {
        console.error('[GmailService] Failed to send draft:', gaxiosError.message);
      }
      throw error;
    }
  }

  async listDrafts(): Promise<{ id: string; subject: string }[]> {
    try {
      const response = await this.gmail.users.drafts.list({
        userId: 'me',
        maxResults: 50,
      });

      if (!response.data.drafts) {
        return [];
      }

      const results: { id: string; subject: string }[] = [];

      for (const draft of response.data.drafts) {
        if (!draft.id) continue;

        try {
          const detail = await this.gmail.users.drafts.get({
            userId: 'me',
            id: draft.id,
            format: 'metadata',
          });

          const headers = (detail as any).data?.message?.payload?.headers || [];
          const subjectHeader = headers.find(
            (h: { name?: string; value?: string }) => h.name?.toLowerCase() === 'subject'
          );

          results.push({
            id: draft.id,
            subject: subjectHeader?.value || '(no subject)',
          });
        } catch {
          results.push({
            id: draft.id,
            subject: '(no subject)',
          });
        }
      }

      return results;
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[GmailService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[GmailService] Quota exceeded or insufficient permissions');
      } else {
        console.error('[GmailService] Failed to list drafts:', gaxiosError.message);
      }
      throw error;
    }
  }

  private buildMimeMessage(
    to: string,
    subject: string,
    htmlBody: string,
    imageBuffer?: Buffer,
    filename?: string
  ): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const mimeLines: string[] = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      `Subject: ${subject}`,
    ];

    if (imageBuffer && filename) {
      mimeLines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      mimeLines.push('');
      mimeLines.push(`--${boundary}`);
      mimeLines.push('Content-Type: text/html; charset="UTF-8"');
      mimeLines.push('Content-Transfer-Encoding: 7bit');
      mimeLines.push('');
      mimeLines.push(htmlBody);
      mimeLines.push('');
      mimeLines.push(`--${boundary}`);
      mimeLines.push(`Content-Type: image/png; name="${filename}"`);
      mimeLines.push('Content-Transfer-Encoding: base64');
      mimeLines.push(`Content-Disposition: inline; filename="${filename}"`);
      mimeLines.push('Content-ID: <screenshot>');
      mimeLines.push('');
      mimeLines.push(imageBuffer.toString('base64'));
      mimeLines.push('');
      mimeLines.push(`--${boundary}--`);
    } else {
      mimeLines.push('Content-Type: text/html; charset="UTF-8"');
      mimeLines.push('');
      mimeLines.push(htmlBody);
    }

    const mimeMessage = mimeLines.join('\r\n');

    // Base64url encode
    return Buffer.from(mimeMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private async fetchScreenshot(driveUrl: string): Promise<Buffer | null> {
    try {
      const response = await fetch(driveUrl);
      if (!response.ok) {
        console.warn('[GmailService] Failed to fetch screenshot:', response.status);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn('[GmailService] Failed to fetch screenshot:', err.message);
      return null;
    }
  }
}
