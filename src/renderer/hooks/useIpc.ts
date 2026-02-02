import { useState, useCallback } from 'react';

export function useIpcInvoke<TResult = unknown, TArgs extends unknown[] = unknown[]>(
  channel: string
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (...args: TArgs): Promise<TResult | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.invoke(channel, ...args);
      return result as TResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [channel]);

  return { invoke, loading, error };
}

export function useIpcListener(
  channel: string,
  callback: (...args: unknown[]) => void
) {
  const setup = useCallback(() => {
    return window.electronAPI.on(channel, callback);
  }, [channel, callback]);

  return setup;
}
