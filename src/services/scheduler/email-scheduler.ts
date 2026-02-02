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
  public onEvent?: (event: SchedulerEvent) => void;

  constructor(
    config: SchedulerConfig,
    onEvent?: (event: SchedulerEvent) => void,
  ) {
    this.config = config;
    this.onEvent = onEvent;
  }

  start(): void {
    this.running = true;
    this.timer = setInterval(() => {
      // Tick — external code should call processNext with a sendFn
    }, this.config.intervalMinutes * 60_000);

    this.emit({
      type: 'started',
      timestamp: new Date().toISOString(),
      detail: `Scheduler started with ${this.config.intervalMinutes}min interval`,
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.emit({
      type: 'stopped',
      timestamp: new Date().toISOString(),
      detail: 'Scheduler stopped',
    });
  }

  addToQueue(drafts: EmailDraft[]): void {
    const now = Date.now();
    const intervalMs = this.config.intervalMinutes * 60_000;
    const existingPendingCount = this.queue.filter(
      (e) => e.status === 'pending',
    ).length;

    drafts.forEach((draft, i) => {
      const offset = (existingPendingCount + i) * intervalMs;
      const scheduled: ScheduledEmail = {
        id: `email-${Date.now()}-${i}`,
        draft,
        scheduledTime: new Date(now + offset).toISOString(),
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
    const now = new Date();
    const email = this.queue.find(
      (e) => e.status === 'pending' && new Date(e.scheduledTime) <= now,
    );

    if (!email) return;

    email.status = 'sending';

    try {
      const result = await sendFn(email.draft);
      email.draftId = result.draftId;
      email.messageId = result.messageId;
      email.status = 'sent';

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
        email.scheduledTime = new Date(
          Date.now() + this.config.intervalMinutes * 60_000,
        ).toISOString();
        email.error = message;
      } else {
        email.status = 'failed';
        email.error = message;
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
