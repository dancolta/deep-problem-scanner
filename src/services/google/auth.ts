import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import { exec } from 'child_process';
import { TokenStore } from './token-store';
import { GoogleAuthTokens, AuthStatus, GOOGLE_SCOPES } from './types';

const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const PORT_RANGE_START = 39500;
const PORT_ATTEMPTS = 10;

export class GoogleAuthService {
  private oauth2Client: OAuth2Client;
  private tokenStore: TokenStore;
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    // redirectUri set dynamically during OAuth flow
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    this.tokenStore = new TokenStore();
  }

  async authenticate(): Promise<GoogleAuthTokens> {
    // 1. Try loading existing tokens
    const existing = await this.tokenStore.loadTokens();

    if (existing) {
      // 2. If still valid, reuse
      if (existing.expiry_date > Date.now()) {
        this.oauth2Client.setCredentials(existing);
        return existing;
      }

      // 3. If expired but has refresh_token, try refresh
      if (existing.refresh_token) {
        try {
          const refreshed = await this.refreshTokens(existing.refresh_token);
          return refreshed;
        } catch (err) {
          console.warn('Token refresh failed, starting new OAuth flow:', err);
        }
      }
    }

    // 4. Start new OAuth flow
    return this.startOAuthFlow();
  }

  async getAuthenticatedClient(): Promise<OAuth2Client> {
    await this.authenticate();
    return this.oauth2Client;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    const tokens = await this.tokenStore.loadTokens();

    if (!tokens) {
      return 'not_authenticated';
    }

    if (tokens.expiry_date > Date.now()) {
      return 'authenticated';
    }

    if (tokens.refresh_token) {
      return 'authenticated'; // Can be refreshed
    }

    return 'expired';
  }

  async revoke(): Promise<void> {
    const tokens = await this.tokenStore.loadTokens();

    if (tokens?.access_token) {
      try {
        await this.oauth2Client.revokeToken(tokens.access_token);
      } catch (err) {
        console.warn('Failed to revoke token with Google (may already be invalid):', err);
      }
    }

    await this.tokenStore.clearTokens();
    this.oauth2Client.setCredentials({});
  }

  private async refreshTokens(refreshToken: string): Promise<GoogleAuthTokens> {
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.oauth2Client.refreshAccessToken();

    const tokens: GoogleAuthTokens = {
      access_token: credentials.access_token!,
      refresh_token: credentials.refresh_token || refreshToken,
      expiry_date: credentials.expiry_date!,
      token_type: credentials.token_type || 'Bearer',
      scope: credentials.scope || GOOGLE_SCOPES.join(' '),
    };

    await this.tokenStore.saveTokens(tokens);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  private async startOAuthFlow(): Promise<GoogleAuthTokens> {
    const port = await this.findAvailablePort();
    const redirectUri = `http://localhost:${port}/oauth/callback`;

    // Recreate client with correct redirect URI
    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      redirectUri
    );

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent',
    });

    const code = await this.listenForCallback(port, authUrl);

    const { tokens: googleTokens } = await this.oauth2Client.getToken(code);

    const tokens: GoogleAuthTokens = {
      access_token: googleTokens.access_token!,
      refresh_token: googleTokens.refresh_token || undefined,
      expiry_date: googleTokens.expiry_date!,
      token_type: googleTokens.token_type || 'Bearer',
      scope: googleTokens.scope || GOOGLE_SCOPES.join(' '),
    };

    await this.tokenStore.saveTokens(tokens);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  private listenForCallback(port: number, authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error('OAuth authentication timed out after 2 minutes.'));
        }
      }, OAUTH_TIMEOUT_MS);

      const server = http.createServer((req, res) => {
        if (!req.url?.startsWith('/oauth/callback')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const parsed = new url.URL(req.url, `http://localhost:${port}`);
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(this.buildHtmlResponse(false, `Authentication failed: ${error}`));
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
          }
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(this.buildHtmlResponse(false, 'No authorization code received.'));
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            server.close();
            reject(new Error('No authorization code in callback.'));
          }
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.buildHtmlResponse(true, 'Authentication successful! You can close this window.'));

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.close();
          resolve(code);
        }
      });

      server.listen(port, () => {
        this.openBrowser(authUrl).catch((err) => {
          console.error('Failed to open browser:', err);
          console.log('Please open this URL manually:', authUrl);
        });
      });

      server.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`OAuth callback server error: ${err.message}`));
        }
      });
    });
  }

  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < PORT_ATTEMPTS; i++) {
      const port = PORT_RANGE_START + i;
      const available = await this.isPortAvailable(port);
      if (available) return port;
    }

    // Fallback: let OS pick a port
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => reject(new Error('Could not determine available port.')));
        }
      });
      srv.on('error', reject);
    });
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, () => {
        srv.close(() => resolve(true));
      });
    });
  }

  private async openBrowser(url: string): Promise<void> {
    // Try Electron shell first
    try {
      const { shell } = require('electron');
      if (shell && typeof shell.openExternal === 'function') {
        await shell.openExternal(url);
        return;
      }
    } catch {
      // Not in Electron context
    }

    // Fallback: platform-specific command
    const command = this.getOpenCommand(url);
    return new Promise((resolve, reject) => {
      exec(command, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private getOpenCommand(targetUrl: string): string {
    const escaped = targetUrl.replace(/"/g, '\\"');
    switch (process.platform) {
      case 'darwin':
        return `open "${escaped}"`;
      case 'linux':
        return `xdg-open "${escaped}"`;
      case 'win32':
        return `start "" "${escaped}"`;
      default:
        return `open "${escaped}"`;
    }
  }

  private buildHtmlResponse(success: boolean, message: string): string {
    const color = success ? '#4CAF50' : '#f44336';
    return `<!DOCTYPE html>
<html>
<head><title>Deep Problem Scanner - OAuth</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:system-ui,sans-serif;background:#1a1a2e;color:#fff;">
  <div style="text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="font-size:3rem;margin-bottom:1rem;">${success ? '&#10003;' : '&#10007;'}</div>
    <h2 style="color:${color};margin:0 0 0.5rem;">${message}</h2>
  </div>
</body>
</html>`;
  }
}
