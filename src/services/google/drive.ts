import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

export class DriveService {
  private drive: drive_v3.Drive;
  private appFolderId: string | null = null;
  private static readonly APP_FOLDER_NAME = 'Deep Problem Scanner';

  constructor(private authClient: OAuth2Client) {
    this.drive = google.drive({ version: 'v3', auth: authClient });
  }

  async ensureAppFolder(): Promise<string> {
    if (this.appFolderId) {
      return this.appFolderId;
    }

    try {
      const response = await this.drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${DriveService.APP_FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (response.data.files && response.data.files.length > 0) {
        this.appFolderId = response.data.files[0].id!;
        return this.appFolderId;
      }

      const folder = await this.drive.files.create({
        requestBody: {
          name: DriveService.APP_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });

      this.appFolderId = folder.data.id!;
      return this.appFolderId;
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[DriveService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[DriveService] Quota exceeded or insufficient permissions');
      } else {
        console.error('[DriveService] Failed to ensure app folder:', gaxiosError.message);
      }
      throw error;
    }
  }

  async uploadScreenshot(
    buffer: Buffer,
    filename: string
  ): Promise<{ fileId: string; webViewLink: string; directLink: string }> {
    try {
      const folderId = await this.ensureAppFolder();

      const file = await this.drive.files.create({
        requestBody: {
          name: filename,
          mimeType: 'image/png',
          parents: [folderId],
        },
        media: {
          mimeType: 'image/png',
          body: Readable.from(buffer),
        },
        fields: 'id, webViewLink',
      });

      await this.drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      return {
        fileId: file.data.id!,
        webViewLink: file.data.webViewLink || '',
        directLink: `https://drive.google.com/uc?export=view&id=${file.data.id}`,
      };
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[DriveService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[DriveService] Quota exceeded or insufficient permissions');
      } else if (gaxiosError.code === 404) {
        console.error('[DriveService] Folder not found, clearing cache and retrying');
        this.appFolderId = null;
        return this.uploadScreenshot(buffer, filename);
      } else {
        console.error('[DriveService] Failed to upload screenshot:', gaxiosError.message);
      }
      throw error;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId });
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 404) {
        console.warn('[DriveService] File already deleted or not found:', fileId);
        return;
      }
      if (gaxiosError.code === 401) {
        console.error('[DriveService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[DriveService] Quota exceeded or insufficient permissions');
      } else {
        console.error('[DriveService] Failed to delete file:', gaxiosError.message);
      }
      throw error;
    }
  }

  getFileLink(fileId: string): string {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  async listScreenshots(): Promise<{ id: string; name: string; createdTime: string }[]> {
    try {
      const folderId = await this.ensureAppFolder();

      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: 100,
      });

      if (!response.data.files) {
        return [];
      }

      return response.data.files.map((file) => ({
        id: file.id!,
        name: file.name!,
        createdTime: file.createdTime!,
      }));
    } catch (error: unknown) {
      const gaxiosError = error as { code?: number; message?: string };
      if (gaxiosError.code === 401) {
        console.error('[DriveService] Authentication error - re-authentication may be needed');
      } else if (gaxiosError.code === 403) {
        console.error('[DriveService] Quota exceeded or insufficient permissions');
      } else if (gaxiosError.code === 404) {
        console.error('[DriveService] Folder not found, clearing cache and retrying');
        this.appFolderId = null;
        return this.listScreenshots();
      } else {
        console.error('[DriveService] Failed to list screenshots:', gaxiosError.message);
      }
      throw error;
    }
  }
}
