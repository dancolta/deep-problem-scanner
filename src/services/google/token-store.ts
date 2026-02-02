import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GoogleAuthTokens } from './types';

export class TokenStore {
  private baseDir: string;

  constructor() {
    this.baseDir = this.resolveStorageDir();
  }

  async saveTokens(tokens: GoogleAuthTokens): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });

    if (this.isElectronSafeStorageAvailable()) {
      const { safeStorage } = require('electron');
      const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
      await fs.writeFile(this.getFilePath(true), encrypted);
    } else {
      await fs.writeFile(
        this.getFilePath(false),
        JSON.stringify(tokens, null, 2),
        'utf-8'
      );
    }
  }

  async loadTokens(): Promise<GoogleAuthTokens | null> {
    // Try encrypted file first, then plain
    for (const encrypted of [true, false]) {
      const filePath = this.getFilePath(encrypted);
      try {
        const data = await fs.readFile(filePath);

        let jsonStr: string;
        if (encrypted && this.isElectronSafeStorageAvailable()) {
          const { safeStorage } = require('electron');
          jsonStr = safeStorage.decryptString(data);
        } else if (encrypted) {
          // Encrypted file exists but safeStorage not available - skip
          continue;
        } else {
          jsonStr = data.toString('utf-8');
        }

        const parsed = JSON.parse(jsonStr);
        if (this.isValidTokenShape(parsed)) {
          return parsed as GoogleAuthTokens;
        }

        console.warn('Token file has invalid shape, ignoring.');
        return null;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        console.error(`Failed to load tokens from ${filePath}:`, err);
        continue;
      }
    }

    return null;
  }

  async clearTokens(): Promise<void> {
    for (const encrypted of [true, false]) {
      const filePath = this.getFilePath(encrypted);
      try {
        await fs.unlink(filePath);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          // File doesn't exist, nothing to clear
          continue;
        }
        console.error(`Failed to delete token file ${filePath}:`, err);
      }
    }
  }

  private isElectronSafeStorageAvailable(): boolean {
    try {
      const { safeStorage } = require('electron');
      return safeStorage && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private resolveStorageDir(): string {
    try {
      const { app } = require('electron');
      if (app && typeof app.getPath === 'function') {
        return app.getPath('userData');
      }
    } catch {
      // Not in Electron context
    }
    return path.join(os.homedir(), '.deep-problem-scanner');
  }

  private getFilePath(encrypted: boolean): string {
    const filename = encrypted ? 'google-tokens.enc' : 'google-tokens.json';
    return path.join(this.baseDir, filename);
  }

  private isValidTokenShape(obj: unknown): boolean {
    if (typeof obj !== 'object' || obj === null) return false;
    const t = obj as Record<string, unknown>;
    return (
      typeof t.access_token === 'string' &&
      typeof t.expiry_date === 'number' &&
      typeof t.token_type === 'string' &&
      typeof t.scope === 'string'
    );
  }
}
