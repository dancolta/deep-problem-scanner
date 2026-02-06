import { EmailDraft } from '../../shared/types';
import {
  ScheduledEmail,
  SchedulerConfig,
  SchedulerEvent,
  SchedulerStatus,
} from './types';

export class EmailScheduler {
  private queue: ScheduledEmail[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private config: SchedulerConfig;
  private sendFn: ((draft: EmailDraft) => Promise<{ draftId: string; messageId: string }>) | null = null;
  public onEvent?: (event: SchedulerEvent) => void;

  constructor(
    config: SchedulerConfig,
    onEvent?: (event: SchedulerEvent) => void,
  ) {
    this.config = config;
    this.onEvent = onEvent;
  }

  start(sendFn: (draft: EmailDraft) => Promise<{ draftId: string; messageId: string }>): void {
    this.running = true;
    this.sendFn = sendFn;

    // Schedule the next email with precise timing
    this.scheduleNextEmail();

    this.emit({
      type: 'started',
      timestamp: new Date().toISOString(),
      detail: `Scheduler started with precise timing (${this.queue.filter(e => e.status === 'pending').length} emails pending)`,
    });
  }

  /**
   * Schedule the next pending email to be sent at its exact scheduled time.
   * Uses setTimeout with calculated delay for precise timing instead of polling.
   */
  private scheduleNextEmail(): void {
    if (!this.running || !this.sendFn) return;

    // Clear any existing timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Find the next pending email (queue is sorted by scheduledTime)
    const pending = this.queue.filter(e => e.status === 'pending');
    if (pending.length === 0) {
      console.log('[Scheduler] No more pending emails in queue');
      return;
    }

    const nextEmail = pending[0];
    const scheduledTimeMs = new Date(nextEmail.scheduledTime).getTime();
    const now = Date.now();
    const delay = Math.max(0, scheduledTimeMs - now);

    console.log(`[Scheduler] Next email to ${nextEmail.draft.to} scheduled for ${nextEmail.scheduledTime}`);
    console.log(`[Scheduler] Current time: ${new Date().toISOString()}, delay: ${Math.round(delay / 1000)}s (${Math.round(delay / 60000)}m)`);

    // If the email is due now or overdue, send immediately
    // Otherwise, set a precise timeout
    this.timer = setTimeout(async () => {
      if (!this.running || !this.sendFn) return;

      console.log(`[Scheduler] Timer fired for ${nextEmail.draft.to} at ${new Date().toISOString()}`);
      await this.processNext(this.sendFn);

      // Schedule the next email after this one completes
      this.scheduleNextEmail();
    }, delay);
  }

  stop(): void {
    this.running = false;
    this.sendFn = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.emit({
      type: 'stopped',
      timestamp: new Date().toISOString(),
      detail: 'Scheduler stopped',
    });
  }

  addToQueue(drafts: EmailDraft[], startTime?: number): void {
    const now = startTime ?? Date.now();
    const intervalMs = this.config.intervalMinutes * 60_000;
    const existingPendingCount = this.queue.filter(
      (e) => e.status === 'pending',
    ).length;

    drafts.forEach((draft, i) => {
      // Use pre-computed scheduledAt if available (random interval), otherwise fall back to fixed interval
      const scheduledTime = (draft as any).scheduledAt
        ? new Date((draft as any).scheduledAt).toISOString()
        : new Date(now + (existingPendingCount + i) * intervalMs).toISOString();

      const scheduled: ScheduledEmail = {
        id: `email-${Date.now()}-${i}`,
        draft,
        scheduledTime,
        status: 'pending',
        attempts: 0,
      };
      this.queue.push(scheduled);
    });

    this.queue.sort(
      (a, b) =>
        new Date(a.scheduledTime).getTime() -
        new Date(b.scheduledTime).getTime(),
    );

    this.emit({
      type: 'queue_updated',
      timestamp: new Date().toISOString(),
      detail: `Added ${drafts.length} email(s) to queue. Total pending: ${this.queue.filter((e) => e.status === 'pending').length}`,
    });

    // If scheduler is running, re-schedule to pick up the potentially earlier email
    if (this.running && this.sendFn) {
      this.scheduleNextEmail();
    }
  }

  getStatus(): SchedulerStatus {
    const pending = this.queue.filter((e) => e.status === 'pending');
    const sent = this.queue.filter((e) => e.status === 'sent').length;
    const failed = this.queue.filter((e) => e.status === 'failed').length;

    return {
      running: this.running,
      queueSize: pending.length,
      nextSendTime: pending.length > 0 ? pending[0].scheduledTime : null,
      sent,
      failed,
    };
  }

  getQueue(): ScheduledEmail[] {
    return [...this.queue];
  }

  async processNext(
    sendFn: (draft: EmailDraft) => Promise<{ draftId: string; messageId: string }>,
  ): Promise<void> {
    const now = Date.now();

    // Find the first pending email (queue is sorted by scheduledTime)
    const email = this.queue.find((e) => e.status === 'pending');

    if (!email) {
      console.log('[Scheduler] processNext: No pending emails found');
      return;
    }

    // Check if it's time to send (with 5-second tolerance for timing precision)
    const scheduledTimeMs = new Date(email.scheduledTime).getTime();
    const timeDiff = scheduledTimeMs - now;

    if (timeDiff > 5000) {
      // Email is not due yet (more than 5 seconds in the future)
      console.log(`[Scheduler] processNext: Email to ${email.draft.to} not due yet (${Math.round(timeDiff / 1000)}s remaining)`);
      return;
    }

    console.log(`[Scheduler] processNext: Sending email to ${email.draft.to} (scheduled: ${email.scheduledTime}, now: ${new Date().toISOString()})`);
    email.status = 'sending';

    try {
      const result = await sendFn(email.draft);
      email.draftId = result.draftId;
      email.messageId = result.messageId;
      email.status = 'sent';

      console.log(`[Scheduler] Email sent successfully to ${email.draft.to}`);
      this.emit({
        type: 'send_success',
        timestamp: new Date().toISOString(),
        detail: `Email sent to ${email.draft.to}`,
        emailId: email.id,
      });
    } catch (err) {
      email.attempts += 1;
      const message = err instanceof Error ? err.message : String(err);

      if (email.attempts < this.config.maxRetries) {
        email.status = 'pending';
        // Retry after the configured interval
        email.scheduledTime = new Date(
          Date.now() + this.config.intervalMinutes * 60_000,
        ).toISOString();
        email.error = message;
        console.log(`[Scheduler] Send failed, will retry in ${this.config.intervalMinutes} minutes: ${message}`);
      } else {
        email.status = 'failed';
        email.error = message;
        console.log(`[Scheduler] Send failed permanently after ${email.attempts} attempts: ${message}`);
      }

      this.emit({
        type: 'send_failed',
        timestamp: new Date().toISOString(),
        detail: `Failed to send to ${email.draft.to}: ${message} (attempt ${email.attempts}/${this.config.maxRetries})`,
        emailId: email.id,
      });
    }
  }

  private emit(event: SchedulerEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
