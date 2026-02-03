import { describe, it, expect, vi } from 'vitest';

// We test the GmailService MIME building by constructing one with a mock OAuth client
// and inspecting the raw MIME output.

// Mock googleapis to avoid real API calls
vi.mock('googleapis', () => {
  const gmailMock = {
    users: {
      drafts: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'draft-123', message: { threadId: 'thread-456' } },
        }),
        send: vi.fn().mockResolvedValue({ data: { id: 'msg-789' } }),
        list: vi.fn().mockResolvedValue({ data: { drafts: [] } }),
      },
    },
  };
  return {
    google: {
      gmail: vi.fn(() => gmailMock),
      drive: vi.fn(() => ({
        files: { get: vi.fn() },
      })),
    },
  };
});

import { GmailService } from '../src/services/google/gmail';

function decodeMimeFromCall(createFn: any): string {
  const call = createFn.mock.calls[0][0];
  const raw = call.requestBody.message.raw;
  // Reverse base64url encoding
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

describe('GmailService MIME building', () => {
  it('uses multipart/related (not multipart/mixed) when image is present', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);

    await gmail.createDraft(
      {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello world',
        screenshotDriveUrl: '',
        leadData: {} as any,
        status: 'draft',
      },
      pngBuffer
    );

    const gmailApi = google.gmail() as any;
    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('multipart/related');
    expect(mime).not.toContain('multipart/mixed');
  });

  it('sets Content-Type to image/png for PNG buffers', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);

    await gmail.createDraft(
      {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello',
        screenshotDriveUrl: '',
        leadData: {} as any,
        status: 'draft',
      },
      pngBuffer
    );

    const gmailApi = google.gmail() as any;
    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('Content-Type: image/png');
  });

  it('sets Content-Type to image/jpeg for JPEG buffers', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);
    const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);

    // Reset mock
    const gmailApi = google.gmail() as any;
    gmailApi.users.drafts.create.mockClear();

    await gmail.createDraft(
      {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello',
        screenshotDriveUrl: '',
        leadData: {} as any,
        status: 'draft',
      },
      jpgBuffer
    );

    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('Content-Type: image/jpeg');
  });

  it('includes Content-ID for inline embedding', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);

    const gmailApi = google.gmail() as any;
    gmailApi.users.drafts.create.mockClear();

    await gmail.createDraft(
      {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello',
        screenshotDriveUrl: '',
        leadData: {} as any,
        status: 'draft',
      },
      pngBuffer
    );

    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('Content-ID: <screenshot>');
    expect(mime).toContain('cid:screenshot');
  });

  it('uses plain HTML when no image buffer or URL', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);

    const gmailApi = google.gmail() as any;
    gmailApi.users.drafts.create.mockClear();

    await gmail.createDraft({
      to: 'test@example.com',
      subject: 'Test',
      body: 'No image',
      screenshotDriveUrl: '',
      leadData: {} as any,
      status: 'draft',
    });

    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('Content-Type: text/html');
    expect(mime).not.toContain('multipart');
  });

  it('falls back to link when screenshotDriveUrl present but no buffer and fetch fails', async () => {
    const { google } = await import('googleapis');
    const gmail = new GmailService({} as any);

    const gmailApi = google.gmail() as any;
    gmailApi.users.drafts.create.mockClear();

    // Mock global fetch to fail
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    await gmail.createDraft({
      to: 'test@example.com',
      subject: 'Test',
      body: 'With link',
      screenshotDriveUrl: 'https://drive.google.com/uc?export=view&id=abc123',
      leadData: {} as any,
      status: 'draft',
    });

    globalThis.fetch = originalFetch;

    const mime = decodeMimeFromCall(gmailApi.users.drafts.create);
    expect(mime).toContain('View Screenshot');
    expect(mime).toContain('href=');
  });
});
