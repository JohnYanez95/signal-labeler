/**
 * Custom hook for managing runs data and labeling state.
 * Implements RAM preload for instant navigation between runs.
 */

import { useState, useCallback, useRef } from 'react';
import { api } from '../services/api';
import type { RunMetadata, Run, LabelType } from '../types';

export function useRunsData() {
  const [runs, setRuns] = useState<RunMetadata[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global Y max from backend (calculated across all sampled runs)
  const [globalYMax, setGlobalYMax] = useState<number | null>(null);

  // RAM cache for all runs with timeseries (preloaded on session start)
  const runsCache = useRef<Map<string, Run>>(new Map());

  const loadRuns = async (
    deviceId: string,
    startTs: number,
    endTs: number,
    modelType: string,
    sampleSize: number,
    labeler?: string
  ) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.sampleRuns({
        device_id: deviceId,
        start_ts: startTs,
        end_ts: endTs,
        model_type: modelType,
        sample_size: sampleSize,
        labeler,  // Pass labeler to only exclude runs labeled by this user
        unlabeled_only: true,
      });
      setRuns(response.runs);
      setCurrentIndex(0);
      // Use global_y_max from backend
      setGlobalYMax(response.global_y_max);

      // Load first run if available
      if (response.runs.length > 0) {
        await loadCurrentRun(response.runs[0].run_id, modelType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  };

  // Load runs by their IDs (for restoring cached sessions)
  const loadRunsByIds = async (runIds: string[], startIndex: number, modelType: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getRunsByIds(runIds);
      setRuns(response.runs);
      setCurrentIndex(startIndex);
      setGlobalYMax(response.global_y_max);

      // Load the run at the start index
      if (response.runs.length > 0 && startIndex < response.runs.length) {
        await loadCurrentRun(response.runs[startIndex].run_id, modelType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  };

  // Load a single run (checks cache first)
  const loadCurrentRun = async (runId: string, modelType: string, sessionId?: string) => {
    // Check RAM cache first
    const cached = runsCache.current.get(runId);
    if (cached) {
      setCurrentRun(cached);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Use session cache endpoint if sessionId provided, otherwise use main endpoint
      const run = sessionId
        ? await api.getSessionRunDetail(sessionId, runId, modelType)
        : await api.getRun(runId, modelType);
      setCurrentRun(run);
      // Add to cache
      runsCache.current.set(runId, run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run details');
    } finally {
      setLoading(false);
    }
  };

  // Preload all runs into RAM cache (called after session restore)
  const preloadAllRuns = useCallback(async (
    runIds: string[],
    modelType: string,
    sessionId: string,
    onProgress?: (loaded: number, total: number) => void
  ) => {
    const total = runIds.length;
    let loaded = 0;

    // Fetch all runs in parallel batches (limit concurrency to avoid overwhelming server)
    const BATCH_SIZE = 10;
    for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
      const batch = runIds.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (runId) => {
        // Skip if already in cache
        if (runsCache.current.has(runId)) {
          loaded++;
          return;
        }
        try {
          const run = await api.getSessionRunDetail(sessionId, runId, modelType);
          runsCache.current.set(runId, run);
          loaded++;
          onProgress?.(loaded, total);
        } catch (err) {
          console.error(`Failed to preload run ${runId}:`, err);
        }
      });
      await Promise.all(promises);
    }
  }, []);

  const goToNext = useCallback(async (modelType: string, sessionId?: string) => {
    if (currentIndex < runs.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      await loadCurrentRun(runs[nextIndex].run_id, modelType, sessionId);
    }
  }, [currentIndex, runs]);

  const goToPrevious = useCallback(async (modelType: string, sessionId?: string) => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      await loadCurrentRun(runs[prevIndex].run_id, modelType, sessionId);
    }
  }, [currentIndex, runs]);

  const goToIndex = useCallback(async (index: number, modelType: string, sessionId?: string, runId?: string) => {
    if (index >= 0 && index < runs.length) {
      setCurrentIndex(index);
      // Use provided runId if available (avoids stale closure issues), otherwise lookup from runs
      const targetRunId = runId || runs[index].run_id;
      await loadCurrentRun(targetRunId, modelType, sessionId);
    }
  }, [runs]);

  const submitLabel = async (
    runId: string,
    modelType: string,
    labeler: string,
    label: LabelType,
    previousLabel?: LabelType | null  // Pass previous label if re-voting
  ) => {
    try {
      await api.submitLabel({
        run_id: runId,
        model_type: modelType,
        labeler,
        label,
      });
      // Update cache with new label status (including vote count and label breakdown)
      const cached = runsCache.current.get(runId);
      if (cached) {
        const currentCounts = cached.label_status.counts || {};
        const newCounts = { ...currentCounts };

        // Check if this is a re-vote (user changing their label)
        const isRevote = previousLabel !== undefined && previousLabel !== null;

        if (isRevote) {
          // User is changing their vote - decrement old, increment new
          if (previousLabel !== label) {
            newCounts[previousLabel] = Math.max(0, (newCounts[previousLabel] || 0) - 1);
            newCounts[label] = (newCounts[label] || 0) + 1;
          }
          // If same label, no change needed (backend handles idempotency)
        } else {
          // First vote - increment count and total
          newCounts[label] = (newCounts[label] || 0) + 1;
        }

        const newLabelStatus = {
          is_labeled: true,
          // Only increment n_votes for first-time votes
          n_votes: isRevote
            ? (cached.label_status.n_votes || 1)  // Keep same count for re-votes
            : (cached.label_status.n_votes || 0) + 1,
          counts: newCounts,
        };
        cached.label_status = newLabelStatus;
        runsCache.current.set(runId, cached);

        // Also update currentRun state if this is the current run
        setCurrentRun(prev => {
          if (prev && prev.run_id === runId) {
            return { ...prev, label_status: newLabelStatus };
          }
          return prev;
        });
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit label');
      return false;
    }
  };

  // Restore session from saved state with RAM preload
  const restoreSession = async (
    savedRuns: RunMetadata[],
    savedIndex: number,
    savedGlobalYMax: number | null,
    modelType: string,
    sessionId?: string  // Optional session ID to load from session cache
  ) => {
    setRuns(savedRuns);
    setCurrentIndex(savedIndex);
    setGlobalYMax(savedGlobalYMax);

    // Load the current run data (from session cache if sessionId provided)
    if (savedRuns.length > 0 && savedIndex < savedRuns.length) {
      await loadCurrentRun(savedRuns[savedIndex].run_id, modelType, sessionId);

      // Preload all other runs in background for instant navigation
      if (sessionId && savedRuns.length > 1) {
        const runIds = savedRuns.map(r => r.run_id);
        // Don't await - let it load in background
        preloadAllRuns(runIds, modelType, sessionId);
      }
    }
  };

  // Clear session state
  const clearSession = () => {
    setRuns([]);
    setCurrentIndex(0);
    setCurrentRun(null);
    setGlobalYMax(null);
    setError(null);
    // Clear RAM cache
    runsCache.current.clear();
  };

  return {
    runs,
    currentIndex,
    currentRun,
    loading,
    error,
    loadRuns,
    loadRunsByIds,
    goToNext,
    goToPrevious,
    goToIndex,
    submitLabel,
    restoreSession,
    clearSession,
    hasNext: currentIndex < runs.length - 1,
    hasPrevious: currentIndex > 0,
    globalYMax,  // Max Y value across all cached runs
    preloadAllRuns,  // Expose for manual preload if needed
  };
}
