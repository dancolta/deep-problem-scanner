import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ScanProgress } from '../../shared/types';

interface ScanState {
  progress: ScanProgress;
  isScanning: boolean;
  elapsedTime: number;
  scanStartedAt: number | null;
}

interface ScanContextValue extends ScanState {
  startScan: (leads: unknown[], spreadsheetId: string) => void;
  cancelScan: () => void;
  resetScan: () => void;
}

const EMPTY_PROGRESS: ScanProgress = {
  total: 0,
  completed: 0,
  failed: 0,
  currentUrl: '',
  results: [],
};

const ScanContext = createContext<ScanContextValue>({
  progress: EMPTY_PROGRESS,
  isScanning: false,
  elapsedTime: 0,
  scanStartedAt: null,
  startScan: () => {},
  cancelScan: () => {},
  resetScan: () => {},
});

export function useScan() {
  return useContext(ScanContext);
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const [isScanning, setIsScanning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time counter
  useEffect(() => {
    if (isScanning && scanStartedAt) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - scanStartedAt) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isScanning, scanStartedAt]);

  // Global IPC listeners — always active regardless of page
  useEffect(() => {
    const unsubProgress = window.electronAPI.on(IPC_CHANNELS.SCAN_PROGRESS, (data: unknown) => {
      const p = data as ScanProgress;
      if (p && p.results) {
        setProgress(p);
      }
    });
    const unsubComplete = window.electronAPI.on(IPC_CHANNELS.SCAN_COMPLETE, () => {
      setIsScanning(false);
    });
    return () => {
      unsubProgress();
      unsubComplete();
    };
  }, []);

  const startScan = useCallback((leads: unknown[], spreadsheetId: string) => {
    setProgress({ ...EMPTY_PROGRESS, total: leads.length });
    setIsScanning(true);
    setElapsedTime(0);
    setScanStartedAt(Date.now());

    // Fire-and-forget — don't await
    window.electronAPI.invoke(IPC_CHANNELS.SCAN_START, { leads, spreadsheetId }).catch((err: unknown) => {
      console.error('[ScanContext] Scan failed:', err);
      setIsScanning(false);
    });
  }, []);

  const cancelScan = useCallback(async () => {
    await window.electronAPI.invoke(IPC_CHANNELS.SCAN_CANCEL);
    setIsScanning(false);
  }, []);

  const resetScan = useCallback(() => {
    setProgress(EMPTY_PROGRESS);
    setIsScanning(false);
    setElapsedTime(0);
    setScanStartedAt(null);
  }, []);

  return (
    <ScanContext.Provider
      value={{ progress, isScanning, elapsedTime, scanStartedAt, startScan, cancelScan, resetScan }}
    >
      {children}
    </ScanContext.Provider>
  );
}
