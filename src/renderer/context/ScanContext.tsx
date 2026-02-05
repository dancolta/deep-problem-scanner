import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ScanProgress, ScanPhase, ScanCompletionSummary, ScanSource } from '../../shared/types';

interface ScanState {
  progress: ScanProgress;
  isScanning: boolean;
  elapsedTime: number;
  scanStartedAt: number | null;
  isComplete: boolean;
  finalElapsedTime: number | null;
  completionSummary: ScanCompletionSummary | null;
  currentPhase: ScanPhase | null;
  phaseDescription: string | null;
}

interface ScanContextValue extends ScanState {
  startScan: (leads: unknown[], spreadsheetId: string, scanSource?: ScanSource) => void;
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
  isComplete: false,
  finalElapsedTime: null,
  completionSummary: null,
  currentPhase: null,
  phaseDescription: null,
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
  const [isComplete, setIsComplete] = useState(false);
  const [finalElapsedTime, setFinalElapsedTime] = useState<number | null>(null);
  const [completionSummary, setCompletionSummary] = useState<ScanCompletionSummary | null>(null);
  const [currentPhase, setCurrentPhase] = useState<ScanPhase | null>(null);
  const [phaseDescription, setPhaseDescription] = useState<string | null>(null);
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
      if (p) {
        if (p.results) {
          setProgress(p);
        }
        // Extract and store phase info
        if (p.currentPhase) {
          setCurrentPhase(p.currentPhase);
        }
        if (p.phaseDescription) {
          setPhaseDescription(p.phaseDescription);
        }
      }
    });
    const unsubComplete = window.electronAPI.on(IPC_CHANNELS.SCAN_COMPLETE, (data: unknown) => {
      const completeData = data as { results?: unknown[]; completionSummary?: ScanCompletionSummary };
      setIsScanning(false);
      setIsComplete(true);
      setCurrentPhase('completed');
      setPhaseDescription('Scan complete');

      // Preserve the final elapsed time
      if (scanStartedAt) {
        setFinalElapsedTime(Math.floor((Date.now() - scanStartedAt) / 1000));
      }

      // Store completion summary if provided
      if (completeData?.completionSummary) {
        setCompletionSummary(completeData.completionSummary);
      }
    });
    return () => {
      unsubProgress();
      unsubComplete();
    };
  }, [scanStartedAt]);

  const startScan = useCallback((leads: unknown[], spreadsheetId: string, scanSource: ScanSource = 'list') => {
    setProgress({ ...EMPTY_PROGRESS, total: leads.length });
    setIsScanning(true);
    setIsComplete(false);
    setElapsedTime(0);
    setFinalElapsedTime(null);
    setCompletionSummary(null);
    setCurrentPhase('initializing');
    setPhaseDescription('Initializing scan...');
    setScanStartedAt(Date.now());

    // Fire-and-forget — don't await
    window.electronAPI.invoke(IPC_CHANNELS.SCAN_START, { leads, spreadsheetId, scanSource }).catch((err: unknown) => {
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
    setIsComplete(false);
    setElapsedTime(0);
    setFinalElapsedTime(null);
    setCompletionSummary(null);
    setCurrentPhase(null);
    setPhaseDescription(null);
    setScanStartedAt(null);
  }, []);

  return (
    <ScanContext.Provider
      value={{
        progress,
        isScanning,
        elapsedTime,
        scanStartedAt,
        isComplete,
        finalElapsedTime,
        completionSummary,
        currentPhase,
        phaseDescription,
        startScan,
        cancelScan,
        resetScan,
      }}
    >
      {children}
    </ScanContext.Provider>
  );
}
