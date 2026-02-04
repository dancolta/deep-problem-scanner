export const IPC_CHANNELS = {
  // Scanning
  SCAN_START: 'scan:start',
  SCAN_PROGRESS: 'scan:progress',
  SCAN_COMPLETE: 'scan:complete',
  SCAN_CANCEL: 'scan:cancel',

  // CSV
  CSV_UPLOAD: 'csv:upload',
  CSV_VALIDATE: 'csv:validate',
  CSV_PARSE: 'csv:parse',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Google Auth
  GOOGLE_AUTH_START: 'google:auth:start',
  GOOGLE_AUTH_STATUS: 'google:auth:status',
  GOOGLE_AUTH_REVOKE: 'google:auth:revoke',

  // Google Sheets
  SHEETS_APPEND: 'sheets:append',
  SHEETS_READ: 'sheets:read',
  SHEETS_CHECK_DUPLICATES: 'sheets:check-duplicates',
  SHEETS_IMPORT_LEADS: 'sheets:import-leads',

  // Google Drive
  DRIVE_UPLOAD: 'drive:upload',

  // Gmail
  GMAIL_CREATE_DRAFT: 'gmail:create-draft',
  GMAIL_SEND: 'gmail:send',

  // Scheduler
  SCHEDULER_START: 'scheduler:start',
  SCHEDULER_STOP: 'scheduler:stop',
  SCHEDULER_STATUS: 'scheduler:status',
  SCHEDULER_PROGRESS: 'scheduler:progress',

  // Gemini
  GEMINI_TEST_KEY: 'gemini:test-key',

  // PageSpeed
  PAGESPEED_TEST_KEY: 'pagespeed:test-key',

  SHEETS_UPDATE_ROW: 'sheets:update-row',

  // Sheet test
  SHEETS_TEST: 'sheets:test',

  // App
  APP_READY: 'app:ready',
  APP_ERROR: 'app:error',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
