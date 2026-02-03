import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

describe('IPC channels', () => {
  it('includes SHEETS_UPDATE_ROW channel', () => {
    expect(IPC_CHANNELS.SHEETS_UPDATE_ROW).toBe('sheets:update-row');
  });

  it('still includes all original channels', () => {
    expect(IPC_CHANNELS.SCAN_START).toBeDefined();
    expect(IPC_CHANNELS.SCAN_PROGRESS).toBeDefined();
    expect(IPC_CHANNELS.SCAN_COMPLETE).toBeDefined();
    expect(IPC_CHANNELS.SHEETS_READ).toBeDefined();
    expect(IPC_CHANNELS.GMAIL_CREATE_DRAFT).toBeDefined();
    expect(IPC_CHANNELS.GMAIL_SEND).toBeDefined();
    expect(IPC_CHANNELS.SCHEDULER_START).toBeDefined();
  });

  it('has unique values for all channels', () => {
    const values = Object.values(IPC_CHANNELS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});
