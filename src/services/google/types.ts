export interface GoogleAuthTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

export type AuthStatus = 'authenticated' | 'expired' | 'not_authenticated' | 'revoked';

export interface GoogleServiceConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.modify',  // Includes compose + label management
  'https://www.googleapis.com/auth/gmail.settings.basic',
];
