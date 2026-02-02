import { EmailDraft } from '../../shared/types';

export interface ScheduledEmail {
  id: string;
  draft: EmailDraft;
  scheduledTime: string; // ISO
  status: 'pending' | 'sending' | 'sent' | 'failed';
  draftId?: string; // Gmail draft ID
  messageId?: string; // Gmail message ID after send
  error?: string;
  attempts: number;
}

export interface SchedulerConfig {
  intervalMinutes: number; // default 15
  timezone: string;
  maxRetries: number; // default 3
}

export interface SchedulerStatus {
  running: boolean;
  queueSize: number;
  nextSendTime: string | null;
  sent: number;
  failed: number;
}

export type SchedulerEvent = {
  type: 'send_success' | 'send_failed' | 'started' | 'stopped' | 'queue_updated';
  timestamp: string;
  detail: string;
  emailId?: string;
};
