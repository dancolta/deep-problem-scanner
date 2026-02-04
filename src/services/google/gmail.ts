import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { EmailDraft } from '../../shared/types';

export class GmailService {
  private gmail: gmail_v1.Gmail;
  private cachedSignature: string | null = null;

  constructor(private authClient: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
  }

  /**
   * Fetch the user's Gmail signature from their primary send-as address
   */
  async getSignature(): Promise<string> {
    if (this.cachedSignature !== null) {
      console.log('[GmailService] Using cached signature, length:', this.cachedSignature.length);
      return this.cachedSignature;
    }

    try {
      console.log('[GmailService] Fetching signature from Gmail API...');
      // Get the list of send-as addresses (includes signature)
      const response = await this.gmail.users.settings.sendAs.list({
        userId: 'me',
      });

      // Find the primary (default) send-as address
      const sendAsAddresses = response.data.sendAs || [];
      console.log('[GmailService] Found', sendAsAddresses.length, 'send-as addresses');
      const primary = sendAsAddresses.find(addr => addr.isDefault) || sendAsAddresses[0];

      if (primary?.signature) {
        this.cachedSignature = primary.signature;
        console.log('[GmailService] Fetched user signature, length:', primary.signature.length);
        return primary.signature;
      }

      console.log('[GmailService] No signature found in primary send-as address');
      this.cachedSignature = '';
      return '';
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string; status?: number };
      const errorCode = err.code || err.status;

      if (errorCode === 403) {
        console.error('[GmailService] Permission denied fetching signature. The gmail.settings.basic scope may be missing. User should re-authenticate to grant access.');
      } else if (errorCode === 401) {
        console.error('[GmailService] Authentication expired fetching signature. User should re-authenticate.');
      } else {
        console.error('[GmailService] Failed to fetch signature:', err.message);
      }

      // Graceful fallback - don't break draft creation
      this.cachedSignature = '';
      return '';
    }
  }

  async createDraft(draft: EmailDraft, emailBuffer?: Buffer): Promise<{ draftId: string; threadId: string }> {
    let imageBuffer: Buffer | null = emailBuffer ?? null;

    if (!imageBuffer && draft.screenshotDriveUrl) {
      imageBuffer = await this.fetchScreenshotFromDrive(draft.screenshotDriveUrl);
    }

    // Detect actual format from buffer
    const imageFormat = imageBuffer ? this.detectImageFormat(imageBuffer) : 'png';
    const mimeType = `image/${imageFormat}`;
    const filename = `screenshot.${imageFormat}`;

    // Fetch user's Gmail signature
    const signature = await this.getSignature();
    console.log('[GmailService] Signature for draft:', signature ? `${signature.length} chars` : 'empty');
    const signatureHtml = signature ? `<br><br><div class="gmail_signature">${signature}</div>` : '';

    // Build HTML body: replace [IMAGE] placeholder with inline image, wrap in HTML
    const bodyText = draft.body;
    const hasImagePlaceholder = bodyText.includes('[IMAGE]');

    // Split body on [IMAGE] to insert inline image at the right spot
    let htmlBody: string;
    if (hasImagePlaceholder && imageBuffer) {
      const parts = bodyText.split('[IMAGE]');
      const beforeImage = parts[0].trim().split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
      const afterImage = parts.slice(1).join('[IMAGE]').trim().split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
      htmlBody = `<html><body>${beforeImage}<br><p><img src="cid:screenshot" alt="Website Screenshot" style="max-width:100%; border-radius:8px; border:1px solid #e5e7eb;"></p><br>${afterImage}${signatureHtml}</body></html>`;
    } else if (hasImagePlaceholder && draft.screenshotDriveUrl) {
      const parts = bodyText.split('[IMAGE]');
      const beforeImage = parts[0].trim().split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
      const afterImage = parts.slice(1).join('[IMAGE]').trim().split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
      htmlBody = `<html><body>${beforeImage}<br><p><a href="${draft.screenshotDriveUrl}">View Screenshot</a></p><br>${afterImage}${signatureHtml}</body></html>`;
    } else {
      const paragraphs = bodyText.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
      if (imageBuffer) {
        htmlBody = `<html><body>${paragraphs}<br><p><img src="cid:screenshot" alt="Website Screenshot" style="max-width:100%;"></p>${signatureHtml}</body></html>`;
      } else if (draft.screenshotDriveUrl) {
        htmlBody = `<html><body>${paragraphs}<br><p><a href="${draft.screenshotDriveUrl}">View Screenshot</a></p>${signatureHtml}</body></html>`;
      } else {
        htmlBody = `<html><body>${paragraphs}${signatureHtml}</body></html>`;
      }
    }

    const raw = this.buildMimeMessage(
      draft.to,
      draft.subject,
      htmlBody,
      imageBuffer ?? undefined,
      imageBuffer ? filename : undefined,
      mimeType
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
    filename?: string,
    imageMimeType: string = 'image/png'
  ): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const mimeLines: string[] = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      `Subject: ${subject}`,
    ];

    if (imageBuffer && filename) {
      mimeLines.push(`Content-Type: multipart/related; boundary="${boundary}"`);
      mimeLines.push('');
      mimeLines.push(`--${boundary}`);
      mimeLines.push('Content-Type: text/html; charset="UTF-8"');
      mimeLines.push('Content-Transfer-Encoding: 7bit');
      mimeLines.push('');
      mimeLines.push(htmlBody);
      mimeLines.push('');
      mimeLines.push(`--${boundary}`);
      mimeLines.push(`Content-Type: ${imageMimeType}; name="${filename}"`);
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

  private detectImageFormat(buffer: Buffer): string {
    if (buffer.length >= 8) {
      // PNG: 89 50 4E 47
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'png';
      }
      // JPEG: FF D8 FF
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpeg';
      }
      // WebP: RIFF....WEBP
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'webp';
      }
    }
    return 'png';
  }

  private async fetchScreenshotFromDrive(driveUrl: string): Promise<Buffer | null> {
    // Try Google Drive API authenticated download first
    try {
      const fileIdMatch = driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        const fileId = fileIdMatch[1];
        const drive = google.drive({ version: 'v3', auth: this.authClient });
        const response = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        return Buffer.from(response.data as ArrayBuffer);
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn('[GmailService] Drive API download failed, trying public URL:', err.message);
    }

    // Fallback to public URL fetch
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
