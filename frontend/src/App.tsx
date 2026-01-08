/**
 * Main application component.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DeviceSelector } from './components/DeviceSelector';
import { DeviceNavigator } from './components/DeviceNavigator';
import { RunNavigator } from './components/RunNavigator';
import { TimeSeriesChart } from './components/TimeSeriesChart';
import { LabelButtons } from './components/LabelButtons';
import { StatusIndicator } from './components/StatusIndicator';
import { SessionLaunchPage } from './components/SessionLaunchPage';
import { SessionBanner } from './components/SessionBanner';
import { ClusterIndicator } from './components/ClusterIndicator';
import { useRunsData } from './hooks/useRunsData';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { api } from './services/api';
import type { LabelType } from './types';

// Helper to serialize/deserialize Map for localStorage
const mapToArray = (map: Map<string, LabelType>): [string, LabelType][] => Array.from(map.entries());
const arrayToMap = (arr: [string, LabelType][]): Map<string, LabelType> => new Map(arr);

function App() {
  const [modelType, setModelType] = useState('classification_v1');
  const [labelerName, setLabelerName] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  // New session management state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionLauncher, setShowSessionLauncher] = useState(false);
  const [_isCreatingNewSession, setIsCreatingNewSession] = useState(false);  // Track if user came from "+New Session"
  const [showClusterConfirm, setShowClusterConfirm] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [showConcludeConfirm, setShowConcludeConfirm] = useState(false);
  const [showEndOfSessionModal, setShowEndOfSessionModal] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [completedDevices, setCompletedDevices] = useState<string[]>([]);
  const [_availableDevices, setAvailableDevices] = useState<string[]>([]);
  const [autoSelectDevice, setAutoSelectDevice] = useState<string | null>(null);
  const [userLabels, setUserLabels] = useState<Map<string, LabelType>>(new Map());
  const [showLoadConfirm, setShowLoadConfirm] = useState(false);
  const [showEarlyExitConfirm, setShowEarlyExitConfirm] = useState(false);
  const [showHotkeyGuide, setShowHotkeyGuide] = useState(false);
  const [showPushOnExitConfirm, setShowPushOnExitConfirm] = useState(false);
  const [showNextDevicePrompt, setShowNextDevicePrompt] = useState(false);
  const [showAllRunsLabeledModal, setShowAllRunsLabeledModal] = useState(false);
  const [isVerifyingLabels, setIsVerifyingLabels] = useState(false);
  const [verifiedLabelCount, setVerifiedLabelCount] = useState(0);
  const [isPushing, _setIsPushing] = useState(false);
  const [pushingSessionId, setPushingSessionId] = useState<string | null>(null);
  const [showPushCompleteRefresh, setShowPushCompleteRefresh] = useState(false);
  const [refreshSessionsTrigger, setRefreshSessionsTrigger] = useState(0);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [pendingLoadParams, setPendingLoadParams] = useState<{
    deviceIds: string[];
    startTs: number;
    endTs: number;
    modelType: string;
    sampleSize: number;
    labelerName: string;
  } | null>(null);

  const COMPLETED_DEVICES_KEY = 'labeler_completed_devices';
  const DEVICE_SESSIONS_KEY = 'labeler_device_sessions';

  // Cache for in-progress device sessions (only run IDs, not full metadata/timeseries)
  const [deviceSessions, setDeviceSessions] = useState<Record<string, {
    runIds: string[];  // Just the run IDs, not full RunMetadata
    userLabels: [string, LabelType][];  // User's labels as serializable array
    globalYMax: number | null;
    currentIndex: number;
  }>>({});

  const {
    runs,
    currentIndex,
    currentRun,
    loading,
    error,
    loadRuns: _loadRuns,
    loadRunsByIds: _loadRunsByIds,
    goToNext: _goToNext,
    goToPrevious: _goToPrevious,
    goToIndex,
    submitLabel,
    restoreSession,
    clearSession,
    hasNext: _hasNext,
    hasPrevious: _hasPrevious,
    globalYMax,
  } = useRunsData();

  const SESSION_STORAGE_KEY = 'labeler_session';

  // Load completed devices from localStorage on mount
  useEffect(() => {
    const savedCompletedDevices = localStorage.getItem(COMPLETED_DEVICES_KEY);
    if (savedCompletedDevices) {
      try {
        setCompletedDevices(JSON.parse(savedCompletedDevices));
      } catch (e) {
        localStorage.removeItem(COMPLETED_DEVICES_KEY);
      }
    }
  }, []);

  // Save completed devices to localStorage when they change
  useEffect(() => {
    if (completedDevices.length > 0) {
      localStorage.setItem(COMPLETED_DEVICES_KEY, JSON.stringify(completedDevices));
    }
  }, [completedDevices]);

  // Load device sessions from localStorage on mount
  useEffect(() => {
    const savedDeviceSessions = localStorage.getItem(DEVICE_SESSIONS_KEY);
    if (savedDeviceSessions) {
      try {
        setDeviceSessions(JSON.parse(savedDeviceSessions));
      } catch (e) {
        localStorage.removeItem(DEVICE_SESSIONS_KEY);
      }
    }
  }, []);

  // Save device sessions to localStorage when they change
  useEffect(() => {
    if (Object.keys(deviceSessions).length > 0) {
      localStorage.setItem(DEVICE_SESSIONS_KEY, JSON.stringify(deviceSessions));
    }
  }, [deviceSessions]);

  // Save current session to device cache when switching away (only run IDs, not full data)
  const saveCurrentSessionToCache = useCallback(() => {
    if (currentDeviceId && runs.length > 0 && userLabels.size < runs.length) {
      setDeviceSessions(prev => ({
        ...prev,
        [currentDeviceId]: {
          runIds: runs.map(r => r.run_id),  // Just the IDs
          userLabels: mapToArray(userLabels),
          globalYMax,
          currentIndex,
        }
      }));
    }
  }, [currentDeviceId, runs, userLabels, globalYMax, currentIndex]);

  // Clear device session from cache (when completed)
  const clearDeviceSessionCache = useCallback((deviceId: string) => {
    setDeviceSessions(prev => {
      const newSessions = { ...prev };
      delete newSessions[deviceId];
      // Also update localStorage
      if (Object.keys(newSessions).length === 0) {
        localStorage.removeItem(DEVICE_SESSIONS_KEY);
      }
      return newSessions;
    });
  }, []);

  // Save session to localStorage when state changes
  useEffect(() => {
    if (sessionActive && runs.length > 0) {
      const sessionData = {
        runs,
        currentIndex,
        globalYMax,
        modelType,
        labelerName,
        currentDeviceId,
        userLabels: mapToArray(userLabels),
        activeSessionId,  // Save session ID for loading from cache on refresh
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    }
  }, [sessionActive, runs, currentIndex, globalYMax, modelType, labelerName, currentDeviceId, userLabels, activeSessionId]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedSession) {
      try {
        const sessionData = JSON.parse(savedSession);
        if (sessionData.runs && sessionData.runs.length > 0) {
          setModelType(sessionData.modelType);
          setLabelerName(sessionData.labelerName);
          setCurrentDeviceId(sessionData.currentDeviceId || null);
          setSessionActive(true);
          // Restore activeSessionId if available (for loading from session cache)
          if (sessionData.activeSessionId) {
            setActiveSessionId(sessionData.activeSessionId);
          }
          // Restore user labels (support both old and new format)
          if (sessionData.userLabels) {
            setUserLabels(arrayToMap(sessionData.userLabels));
          } else if (sessionData.labeledRunIds) {
            // Legacy format: old sessions won't have label info, just start fresh
            // Users will need to re-label any previously labeled runs
            setUserLabels(new Map());
          }
          // Pass sessionId to load run details from session cache (not rle_runs)
          restoreSession(
            sessionData.runs,
            sessionData.currentIndex,
            sessionData.globalYMax,
            sessionData.modelType,
            sessionData.activeSessionId  // Load from session cache
          );
          // Show notification after a brief delay to ensure UI is ready
          setTimeout(() => {
            setNotification(`Session restored. Resuming at run ${sessionData.currentIndex + 1} of ${sessionData.runs.length}.`);
            setTimeout(() => setNotification(null), 3000);
          }, 500);
        }
      } catch (e) {
        // Invalid session data, clear it
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }, []); // Only run on mount

  // Actually perform the load runs operation
  const performLoadRuns = async (
    deviceIds: string[],  // Array of device IDs
    startTs: number,
    endTs: number,
    modelType: string,
    sampleSize: number,
    labelerName: string,
    _forceNewSample: boolean = false
  ) => {
    setIsLoadingRuns(true);
    setModelType(modelType);
    setLabelerName(labelerName);
    setCurrentDeviceId(deviceIds[0] || null);  // Track first device for display
    // Clear auto-select after it's been used
    if (autoSelectDevice) {
      setAutoSelectDevice(null);
    }

    // Fresh sample - reset user labels tracking
    setUserLabels(new Map());

    // Always create a backend session via API (pulls from Delta Lake)
    if (!activeSessionId) {
      try {
        showNotification(`Creating session for ${deviceIds.length} devices...`);
        const result = await api.createSession({
          device_ids: deviceIds,
          date_range_start: startTs,
          date_range_end: endTs,
          model_type: modelType,
          labeler: labelerName,
          sample_size: sampleSize,
        });
          if (result.success && result.session_id) {
            setActiveSessionId(result.session_id);
            // Load runs from the session cache (already pulled from Delta)
            const sessionRuns = await api.getSessionRuns(result.session_id);
            if (sessionRuns.runs.length > 0) {
              // Use the hook's restoreSession to properly set runs and load first run
              // Pass sessionId so it loads run details from session cache
              await restoreSession(
                sessionRuns.runs,
                0,
                sessionRuns.global_y_max,
                modelType,
                result.session_id  // Load from session cache
              );
              setSessionActive(true);
              setIsLoadingRuns(false);
              showNotification(`Loaded ${sessionRuns.runs.length} runs from Delta Lake.`);
              setIsCreatingNewSession(false);
              return;
            }
          } else {
            // Session creation failed (no runs found)
            setIsLoadingRuns(false);
            showNotification(result.message || 'No unlabeled runs found for the selected criteria.');
            setIsCreatingNewSession(false);
            return;
          }
        } catch (error) {
          console.error('Failed to create backend session:', error);
          setIsLoadingRuns(false);
          showNotification('Failed to load runs from Delta Lake. Check console for details.');
          setIsCreatingNewSession(false);
          return;
        }
      }
  };

  // Show notification when runs finish loading
  const previousRunsLengthRef = useRef(0);
  useEffect(() => {
    if (runs.length > 0 && runs.length !== previousRunsLengthRef.current && sessionActive && !loading) {
      showNotification(`Loaded ${runs.length} runs. Ready to label!`);
    }
    previousRunsLengthRef.current = runs.length;
  }, [runs.length, sessionActive, loading]);

  // Handle load runs request - show confirmation if session active
  const handleLoadRuns = async (
    deviceIds: string[],  // Now accepts array
    startTs: number,
    endTs: number,
    modelType: string,
    sampleSize: number,
    labelerName: string
  ) => {
    // If session is active, show confirmation first
    if (sessionActive && runs.length > 0) {
      setPendingLoadParams({ deviceIds, startTs, endTs, modelType, sampleSize, labelerName });
      setShowLoadConfirm(true);
      return;
    }
    // No active session, proceed directly
    await performLoadRuns(deviceIds, startTs, endTs, modelType, sampleSize, labelerName);
  };

  // Confirm loading new runs (replacing current session)
  const handleConfirmLoadRuns = useCallback(async () => {
    setShowLoadConfirm(false);
    if (pendingLoadParams) {
      const { deviceIds, startTs, endTs, modelType, sampleSize, labelerName } = pendingLoadParams;
      setPendingLoadParams(null);

      const allLabeled = userLabels.size === runs.length;
      const previousDeviceId = currentDeviceId;
      const labeledCountBefore = userLabels.size;
      const totalRunsBefore = runs.length;

      // Save current session to cache before switching (if not complete)
      if (!allLabeled && previousDeviceId && labeledCountBefore > 0) {
        saveCurrentSessionToCache();
      }

      // Labels are already saved to backend, just clear local session
      localStorage.removeItem(SESSION_STORAGE_KEY);
      clearSession();

      // Only move previous device to finished if ALL runs were labeled
      if (allLabeled && previousDeviceId && !completedDevices.includes(previousDeviceId)) {
        const newCompletedDevices = [...completedDevices, previousDeviceId];
        setCompletedDevices(newCompletedDevices);
        // Clear the device from cache since it's complete
        clearDeviceSessionCache(previousDeviceId);
        showNotification(`Previous device completed! ${labeledCountBefore} runs labeled.`);
      } else if (previousDeviceId && labeledCountBefore > 0) {
        showNotification(`Previous session cached. ${labeledCountBefore} of ${totalRunsBefore} runs labeled.`);
      }

      await performLoadRuns(deviceIds, startTs, endTs, modelType, sampleSize, labelerName);
    }
  }, [pendingLoadParams, clearSession, userLabels, runs.length, currentDeviceId, completedDevices, saveCurrentSessionToCache, clearDeviceSessionCache]);

  // Cancel loading new runs
  const handleCancelLoadRuns = useCallback(() => {
    setShowLoadConfirm(false);
    setPendingLoadParams(null);
  }, []);

  // Compute per-device progress from runs (must be before handleLabel)
  const deviceProgressList = useMemo(() => {
    const deviceMap = new Map<string, { total: number; labeled: number }>();

    runs.forEach(run => {
      const deviceId = run.device_id;
      if (!deviceMap.has(deviceId)) {
        deviceMap.set(deviceId, { total: 0, labeled: 0 });
      }
      const entry = deviceMap.get(deviceId)!;
      entry.total++;
      if (userLabels.has(run.run_id)) {
        entry.labeled++;
      }
    });

    return Array.from(deviceMap.entries()).map(([deviceId, stats]) => ({
      deviceId,
      labeledCount: stats.labeled,
      totalRuns: stats.total,
    }));
  }, [runs, userLabels]);

  // Get runs for current device only
  const currentDeviceRuns = useMemo(() => {
    if (!currentDeviceId) return runs;
    return runs.filter(r => r.device_id === currentDeviceId);
  }, [runs, currentDeviceId]);

  // Get current index within device
  const currentDeviceIndex = useMemo(() => {
    if (!currentRun || !currentDeviceId) return 0;
    return currentDeviceRuns.findIndex(r => r.run_id === currentRun.run_id);
  }, [currentDeviceRuns, currentRun, currentDeviceId]);

  // Navigation within current device
  const hasNextInDevice = currentDeviceIndex < currentDeviceRuns.length - 1;
  const hasPreviousInDevice = currentDeviceIndex > 0;

  const handleLabel = (label: LabelType) => {
    if (!currentRun || !labelerName) return;

    const runId = currentRun.run_id;
    const previousLabel = userLabels.get(runId) ?? null;

    // Optimistic UI update FIRST (instant feedback)
    const newUserLabels = new Map(userLabels);
    newUserLabels.set(runId, label);
    setUserLabels(newUserLabels);
    showNotification(`Labeled as: ${['Class A', 'Class B', 'Invalid'][label]}`);

    // Fire API in background (don't await)
    submitLabel(runId, modelType, labelerName, label, previousLabel)
      .catch(() => {
        // Rollback on failure
        const rolledBack = new Map(userLabels);
        if (previousLabel !== null) {
          rolledBack.set(runId, previousLabel);
        } else {
          rolledBack.delete(runId);
        }
        setUserLabels(rolledBack);
        showNotification('Label failed to save!');
      });

    // Auto-advance immediately (don't wait for API)
    if (newUserLabels.size === runs.length) {
      // All runs labeled - show completion modal
      setShowAllRunsLabeledModal(true);
    } else if (hasNextInDevice) {
      // Auto-advance to next run within current device
      const nextIndex = currentDeviceIndex + 1;
      const nextRun = currentDeviceRuns[nextIndex];
      const globalIndex = runs.findIndex(r => r.run_id === nextRun.run_id);
      if (globalIndex >= 0) {
        goToIndex(globalIndex, modelType, activeSessionId || undefined, nextRun.run_id);
      }
    } else {
      // End of current device - check if device is now complete
      const currentDeviceProgress = deviceProgressList.find(d => d.deviceId === currentDeviceId);
      if (currentDeviceProgress) {
        const remaining = currentDeviceProgress.totalRuns - currentDeviceProgress.labeledCount - 1;
        if (remaining <= 0) {
          const availableDevices = deviceProgressList.filter(
            d => d.deviceId !== currentDeviceId && d.labeledCount < d.totalRuns
          );
          if (availableDevices.length > 0) {
            setShowNextDevicePrompt(true);
          } else {
            showNotification('All devices complete! Use Early Exit or Sessions when ready to push.');
          }
        } else {
          showNotification('End of device runs. Use Previous or select another device.');
        }
      }
    }
  };

  // Navigate within current device only
  const handlePrevious = useCallback(() => {
    if (hasPreviousInDevice && currentDeviceRuns.length > 0) {
      const prevIndex = currentDeviceIndex - 1;
      const prevRun = currentDeviceRuns[prevIndex];
      const globalIndex = runs.findIndex(r => r.run_id === prevRun.run_id);
      if (globalIndex >= 0) {
        // Pass run_id directly to avoid stale closure issues
        goToIndex(globalIndex, modelType, activeSessionId || undefined, prevRun.run_id);
      }
    }
  }, [hasPreviousInDevice, currentDeviceRuns, currentDeviceIndex, runs, goToIndex, modelType, activeSessionId]);

  const handleNext = useCallback(() => {
    if (hasNextInDevice && currentDeviceRuns.length > 0) {
      const nextIndex = currentDeviceIndex + 1;
      const nextRun = currentDeviceRuns[nextIndex];
      const globalIndex = runs.findIndex(r => r.run_id === nextRun.run_id);
      if (globalIndex >= 0) {
        // Pass run_id directly to avoid stale closure issues
        goToIndex(globalIndex, modelType, activeSessionId || undefined, nextRun.run_id);
      }
    }
  }, [hasNextInDevice, currentDeviceRuns, currentDeviceIndex, runs, goToIndex, modelType, activeSessionId]);

  // Handle device selection from DeviceNavigator
  const handleDeviceSelect = useCallback((deviceId: string) => {
    // Save current device progress before switching
    if (currentDeviceId && currentDeviceId !== deviceId) {
      saveCurrentSessionToCache();
    }

    setCurrentDeviceId(deviceId);

    // Find first run of the selected device
    const deviceRuns = runs.filter(r => r.device_id === deviceId);
    if (deviceRuns.length > 0) {
      // Find first unlabeled run in this device, or first run if all labeled
      const firstUnlabeled = deviceRuns.find(r => !userLabels.has(r.run_id));
      const targetRun = firstUnlabeled || deviceRuns[0];
      const globalIndex = runs.findIndex(r => r.run_id === targetRun.run_id);

      if (globalIndex >= 0) {
        // goToIndex checks cache synchronously - no await needed
        goToIndex(globalIndex, modelType, activeSessionId || undefined, targetRun.run_id);
      }
    }
  }, [currentDeviceId, runs, userLabels, saveCurrentSessionToCache, goToIndex, modelType, activeSessionId]);

  // Proceed to next available device (from prompt)
  const handleProceedToNextDevice = useCallback(() => {
    setShowNextDevicePrompt(false);

    // Find the next available (incomplete) device
    const availableDevices = deviceProgressList.filter(
      d => d.deviceId !== currentDeviceId && d.labeledCount < d.totalRuns
    );

    if (availableDevices.length > 0) {
      const nextDevice = availableDevices[0];
      handleDeviceSelect(nextDevice.deviceId);
    }
  }, [deviceProgressList, currentDeviceId, handleDeviceSelect]);

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  // Handle session selection from SessionLaunchPage
  const handleSessionSelect = useCallback(async (sessionId: string) => {
    try {
      // Fetch all session data in parallel for faster load
      const [sessionInfo, response, labelsRecord] = await Promise.all([
        api.getSession(sessionId),
        api.getSessionRuns(sessionId),
        api.getSessionUserLabels(sessionId).catch(() => ({} as Record<string, number>)),
      ]);

      setModelType(sessionInfo.model_type);
      setLabelerName(sessionInfo.labeler);
      setActiveSessionId(sessionId);

      // Always close the session launcher and go to labeling interface
      setShowSessionLauncher(false);

      if (response.runs && response.runs.length > 0) {
        // Convert labels Record<string, number> to Map<string, LabelType>
        const labelsMap = new Map<string, LabelType>();
        Object.entries(labelsRecord).forEach(([runId, label]) => {
          labelsMap.set(runId, label as LabelType);
        });
        setUserLabels(labelsMap);

        // Set current device to first device in runs
        const firstDeviceId = response.runs[0]?.device_id;
        if (firstDeviceId) {
          setCurrentDeviceId(firstDeviceId);
        }

        // Use restoreSession to load runs directly from session cache
        // Don't await - show UI immediately, first run loads async
        restoreSession(
          response.runs,
          0,
          response.global_y_max,
          sessionInfo.model_type,
          sessionId
        );
        setSessionActive(true);
        showNotification(`Session loaded: ${response.runs.length} runs`);
      } else {
        // No runs in session - still go to main interface but show message
        setSessionActive(false);
        showNotification('Session has no runs. Select a device to start labeling.');
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      showNotification('Failed to load session');
      setShowSessionLauncher(false); // Still close launcher on error
    }
  }, [restoreSession]);

  // Handle Shift+S to start cluster
  const handleStartCluster = useCallback(async () => {
    setShowClusterConfirm(false);
    try {
      await api.startCluster();
      showNotification('Spark cluster starting...');
    } catch (error) {
      console.error('Failed to start cluster:', error);
      showNotification('Failed to start cluster');
    }
  }, []);

  // Check if there are unpushed labels and prompt to push before exiting
  const handleEarlyExitConfirmed = useCallback(() => {
    setShowEarlyExitConfirm(false);

    // If there are labeled runs, offer to push to Delta
    if (userLabels.size > 0 && activeSessionId) {
      setShowPushOnExitConfirm(true);
    } else {
      // No labels to push, proceed directly to conclude
      finalizeConclude();
    }
  }, [userLabels.size, activeSessionId]);

  // Finalize the session conclusion (called after push decision)
  const finalizeConclude = useCallback(() => {
    const labeledCount = userLabels.size;
    const totalRuns = runs.length;

    // Close all modals
    setShowConcludeConfirm(false);
    setShowEndOfSessionModal(false);
    setShowLoadConfirm(false);
    setShowEarlyExitConfirm(false);
    setShowPushOnExitConfirm(false);
    setPendingLoadParams(null);
    setSessionActive(false);
    setCurrentDeviceId(null);
    setUserLabels(new Map());
    setAutoSelectDevice(null);
    setCompletedDevices([]);
    setDeviceSessions({});

    // Clear localStorage for device-based sessions
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(COMPLETED_DEVICES_KEY);
    localStorage.removeItem(DEVICE_SESSIONS_KEY);

    clearSession();

    // Go to SessionLaunchPage so user can see saved sessions and push to Delta
    setShowSessionLauncher(true);
    setRefreshSessionsTrigger(prev => prev + 1);  // Fetch fresh session data immediately
    setActiveSessionId(null);

    showNotification(`Session concluded. Labeled ${labeledCount} of ${totalRuns} runs.`);
  }, [runs.length, clearSession, userLabels]);

  // Push labels to Delta in background and then conclude
  const handlePushAndConclude = useCallback(async () => {
    const sessionIdToPush = activeSessionId;
    const labeledCount = userLabels.size;

    // Close modal and navigate immediately
    setShowPushOnExitConfirm(false);
    setShowConcludeConfirm(false);
    setShowEndOfSessionModal(false);
    setShowLoadConfirm(false);
    setShowEarlyExitConfirm(false);
    setPendingLoadParams(null);
    setSessionActive(false);
    setCurrentDeviceId(null);
    setUserLabels(new Map());
    setAutoSelectDevice(null);
    setCompletedDevices([]);
    setDeviceSessions({});

    // Clear localStorage for device-based sessions
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(COMPLETED_DEVICES_KEY);
    localStorage.removeItem(DEVICE_SESSIONS_KEY);

    clearSession();

    // Go to SessionLaunchPage immediately and trigger refresh for fresh data
    setShowSessionLauncher(true);
    setRefreshSessionsTrigger(prev => prev + 1);  // Fetch fresh session data immediately
    setActiveSessionId(null);

    if (!sessionIdToPush) {
      showNotification(`Session ended. ${labeledCount} labels saved locally.`);
      return;
    }

    // Show notification that push is starting and track the session being pushed
    setPushingSessionId(sessionIdToPush);
    showNotification(`Pushing ${labeledCount} labels to Delta Lake...`);

    // Push in background (don't await in UI thread)
    (async () => {
      try {
        await api.pushSession(sessionIdToPush);
        // Only delete session after successful push
        await api.deleteSession(sessionIdToPush);
        // Trigger refresh of sessions list to remove the pushed session
        setRefreshSessionsTrigger(prev => prev + 1);
        // Show refresh prompt instead of notification
        setShowPushCompleteRefresh(true);
      } catch (error) {
        console.error('Failed to push labels:', error);
        showNotification('Push failed. Session saved locally - try again from Sessions.');
      } finally {
        setPushingSessionId(null);
      }
    })();
  }, [activeSessionId, clearSession, userLabels]);

  // Verify labels are synced before pushing (from All Runs Labeled modal)
  const handleVerifyAndPush = useCallback(async () => {
    if (!activeSessionId) {
      setShowAllRunsLabeledModal(false);
      handlePushAndConclude();
      return;
    }

    const expectedCount = runs.length;
    setIsVerifyingLabels(true);
    setVerifiedLabelCount(0);

    // Poll the backend until all labels are synced
    const maxAttempts = 30; // 30 attempts * 500ms = 15 seconds max
    let attempts = 0;

    const pollProgress = async () => {
      try {
        const progress = await api.getSessionProgress(activeSessionId);
        setVerifiedLabelCount(progress.labeled_count);

        if (progress.labeled_count >= expectedCount) {
          // All labels synced - proceed with push
          setIsVerifyingLabels(false);
          setShowAllRunsLabeledModal(false);
          handlePushAndConclude();
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          // Continue polling
          setTimeout(pollProgress, 500);
        } else {
          // Timeout - proceed anyway with warning
          setIsVerifyingLabels(false);
          setShowAllRunsLabeledModal(false);
          showNotification(`Warning: Only ${progress.labeled_count}/${expectedCount} labels synced. Proceeding with push...`);
          handlePushAndConclude();
        }
      } catch (error) {
        console.error('Failed to verify labels:', error);
        setIsVerifyingLabels(false);
        setShowAllRunsLabeledModal(false);
        showNotification('Failed to verify labels. Proceeding with push...');
        handlePushAndConclude();
      }
    };

    // Start polling
    pollProgress();
  }, [activeSessionId, runs.length, handlePushAndConclude]);

  // Save session as draft and conclude (don't push to Delta)
  const handleSkipPushAndConclude = useCallback(() => {
    const labeledCount = userLabels.size;
    setShowPushOnExitConfirm(false);

    // Close all modals and reset state, but keep session in backend
    setShowConcludeConfirm(false);
    setShowEndOfSessionModal(false);
    setShowLoadConfirm(false);
    setShowEarlyExitConfirm(false);
    setPendingLoadParams(null);
    setSessionActive(false);
    setCurrentDeviceId(null);
    setUserLabels(new Map());
    setAutoSelectDevice(null);
    setCompletedDevices([]);
    setDeviceSessions({});

    // Clear localStorage for device-based sessions
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(COMPLETED_DEVICES_KEY);
    localStorage.removeItem(DEVICE_SESSIONS_KEY);

    clearSession();

    // Go to SessionLaunchPage - session is saved in backend
    setShowSessionLauncher(true);
    setRefreshSessionsTrigger(prev => prev + 1);  // Fetch fresh session data immediately
    setActiveSessionId(null);

    showNotification(`Session saved! ${labeledCount} labels saved as draft. Resume anytime from Sessions.`);
  }, [clearSession, userLabels]);

  // Legacy handler for other modals that don't need push check
  const handleConcludeSession = useCallback(() => {
    // Close early exit first if open
    setShowEarlyExitConfirm(false);

    // If there are labeled runs, offer to push to Delta
    if (userLabels.size > 0 && activeSessionId) {
      setShowPushOnExitConfirm(true);
    } else {
      finalizeConclude();
    }
  }, [userLabels.size, activeSessionId, finalizeConclude]);

  // Calculate session stats
  const labeledCount = userLabels.size;
  const missedCount = runs.length - labeledCount;
  const completionPercent = runs.length > 0 ? (labeledCount / runs.length) * 100 : 0;

  // Track if we've shown the 80% cluster notification for this session
  const [hasShown80PercentNotice, setHasShown80PercentNotice] = useState(false);

  // 80% cluster start trigger - based on ENTIRE session progress
  useEffect(() => {
    // Only trigger once per session when crossing 80% threshold
    if (
      sessionActive &&
      runs.length > 0 &&
      !hasShown80PercentNotice &&
      completionPercent >= 80
    ) {
      setHasShown80PercentNotice(true);
      showNotification(`80% complete! Consider starting Spark cluster (Shift+S) for pushing to Delta.`);
    }
  }, [sessionActive, runs.length, completionPercent, hasShown80PercentNotice]);

  // Reset 80% notice flag when session changes
  useEffect(() => {
    if (!sessionActive) {
      setHasShown80PercentNotice(false);
    }
  }, [sessionActive]);

  // Find first unlabeled run index
  const findFirstUnlabeledIndex = useCallback(() => {
    for (let i = 0; i < runs.length; i++) {
      if (!userLabels.has(runs[i].run_id)) {
        return i;
      }
    }
    return -1;
  }, [runs, userLabels]);

  // Handler to go to first unlabeled run
  const handleGoToFirstUnlabeled = useCallback(() => {
    const index = findFirstUnlabeledIndex();
    if (index >= 0 && index < runs.length) {
      setShowEndOfSessionModal(false);
      // Pass run_id directly to avoid stale closure issues
      goToIndex(index, modelType, activeSessionId || undefined, runs[index].run_id);
      showNotification(`Jumped to first unlabeled run (${index + 1} of ${runs.length})`);
    }
  }, [findFirstUnlabeledIndex, goToIndex, modelType, runs, activeSessionId]);

  // Handler to go to specific index
  const handleGoToIndex = useCallback((index: number) => {
    if (index >= 0 && index < runs.length) {
      // Pass run_id directly to avoid stale closure issues
      goToIndex(index, modelType, activeSessionId || undefined, runs[index].run_id);
    }
  }, [goToIndex, modelType, runs, activeSessionId]);

  // Get color for completion percentage
  const getCompletionColor = (percent: number) => {
    if (percent >= 90) return '#059669'; // green
    if (percent >= 70) return '#d97706'; // yellow/amber
    return '#dc2626'; // red
  };

  // Keyboard handler for spacebar (conclude) and Y/N confirmation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // ? key to toggle hotkey guide (works anytime, even when modals are open)
      if (event.key === '?' && !showEarlyExitConfirm) {
        event.preventDefault();
        setShowHotkeyGuide(prev => !prev);
        return;
      }

      // Shift+S to start Spark cluster (with confirmation)
      if (event.key === 'S' && event.shiftKey && !showClusterConfirm) {
        event.preventDefault();
        setShowClusterConfirm(true);
        return;
      }

      // Y/N for cluster confirmation
      if (showClusterConfirm) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleStartCluster();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          setShowClusterConfirm(false);
        }
        return;
      }

      // Escape to close hotkey guide
      if (event.key === 'Escape' && showHotkeyGuide) {
        event.preventDefault();
        setShowHotkeyGuide(false);
        return;
      }

      // Don't process other keys if hotkey guide is open
      if (showHotkeyGuide) return;

      // Spacebar or Escape to show early exit confirmation (not if another modal is open)
      if ((event.code === 'Space' || event.key === 'Escape') && sessionActive && !showConcludeConfirm && !showEndOfSessionModal && !showLoadConfirm && !showEarlyExitConfirm) {
        event.preventDefault();
        setShowEarlyExitConfirm(true);
        return;
      }

      // H to go to first unlabeled run (works during session and in end-of-session modal)
      if ((event.key === 'h' || event.key === 'H') && sessionActive && !showConcludeConfirm && !showLoadConfirm && !showEarlyExitConfirm) {
        event.preventDefault();
        handleGoToFirstUnlabeled();
        return;
      }

      // N to go to last run (end)
      if ((event.key === 'n' || event.key === 'N') && sessionActive && !showConcludeConfirm && !showEndOfSessionModal && !showLoadConfirm && !showEarlyExitConfirm && !showNextDevicePrompt && !showAllRunsLabeledModal) {
        event.preventDefault();
        handleGoToIndex(runs.length - 1);
        return;
      }

      // Y/N/Enter/Esc when conclude confirmation is shown
      if (showConcludeConfirm) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleConcludeSession();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          setShowConcludeConfirm(false);
        }
      }

      // Y/N/Enter/Esc when early exit confirmation is shown
      if (showEarlyExitConfirm) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleEarlyExitConfirmed();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          setShowEarlyExitConfirm(false);
        }
      }

      // Y/N/Enter/Esc when save session confirmation is shown
      // Y = Save as draft, N = Push to Delta now
      if (showPushOnExitConfirm && !isPushing) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleSkipPushAndConclude();  // Save session (don't push)
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          handlePushAndConclude();  // Push to Delta
        }
      }

      // Y/N/Enter/Esc when load new runs confirmation is shown
      if (showLoadConfirm) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleConfirmLoadRuns();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          handleCancelLoadRuns();
        }
      }

      // Y/N when end-of-session modal is shown
      // Y = Push to Delta, N = Save draft
      if (showEndOfSessionModal) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handlePushAndConclude();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          handleSkipPushAndConclude();
        }
      }

      // Y/N when next device prompt is shown
      // Y = Next Device, N = Stay Here
      if (showNextDevicePrompt) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleProceedToNextDevice();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          setShowNextDevicePrompt(false);
        }
      }

      // Y/N when all runs labeled modal is shown (ignore if verifying)
      // Y = Push to Delta (with verification), N = Save draft
      if (showAllRunsLabeledModal && !isVerifyingLabels) {
        event.preventDefault();
        if (event.key === 'y' || event.key === 'Y' || event.key === 'Enter') {
          handleVerifyAndPush();
        } else if (event.key === 'n' || event.key === 'N' || event.key === 'Escape') {
          setShowAllRunsLabeledModal(false);
          handleSkipPushAndConclude();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionActive, showConcludeConfirm, showEndOfSessionModal, showLoadConfirm, showEarlyExitConfirm, showHotkeyGuide, showClusterConfirm, showPushOnExitConfirm, showNextDevicePrompt, showAllRunsLabeledModal, isVerifyingLabels, isPushing, handleConcludeSession, handleGoToFirstUnlabeled, handleGoToIndex, handleConfirmLoadRuns, handleCancelLoadRuns, handleStartCluster, handleEarlyExitConfirmed, handlePushAndConclude, handleSkipPushAndConclude, handleProceedToNextDevice, handleVerifyAndPush, runs.length]);

  useKeyboardNav({
    onPrevious: handlePrevious,
    onNext: handleNext,
    onLabel: handleLabel,
    enabled: sessionActive && !!currentRun && !loading && !showConcludeConfirm && !showEndOfSessionModal && !showLoadConfirm && !showEarlyExitConfirm && !showHotkeyGuide && !showNextDevicePrompt && !showAllRunsLabeledModal,
  });

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        {/* Early Exit Button - Top Left */}
        {sessionActive && (
          <button
            onClick={() => setShowEarlyExitConfirm(true)}
            style={styles.earlyExitButton}
          >
            Early Exit<br />
            <span style={styles.earlyExitHotkey}>(Esc / Space)</span>
          </button>
        )}

        {/* Top Right Controls */}
        <div style={styles.topRightControls}>
          <ClusterIndicator />
          {!showSessionLauncher && (
            <button
              onClick={() => setShowSessionLauncher(true)}
              style={styles.sessionsButton}
              title="Manage sessions"
            >
              Sessions
            </button>
          )}
          <span
            style={styles.utcPill}
            title="All timestamps are stored in UTC"
          >
            {(() => {
              const offsetMinutes = new Date().getTimezoneOffset();
              const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
              const offsetMins = Math.abs(offsetMinutes) % 60;
              const sign = offsetMinutes <= 0 ? '+' : '-';
              return offsetMins === 0
                ? `UTC${sign}${offsetHours}`
                : `UTC${sign}${offsetHours}:${String(offsetMins).padStart(2, '0')}`;
            })()}
          </span>
          <button
            onClick={() => setShowHotkeyGuide(true)}
            style={styles.helpButton}
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </div>

        <h1 style={styles.title}>Time Series Classification Labeler</h1>
        <p style={styles.subtitle}>
          Press <strong>?</strong> for keyboard shortcuts
        </p>
      </header>

      {/* Conclude Session Confirmation Modal */}
      {showConcludeConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>
              {currentIndex === 0 ? 'No Labels Submitted!' : 'Conclude Session?'}
            </h2>
            {currentIndex === 0 ? (
              <p style={styles.modalWarning}>
                You haven't labeled any runs yet. Are you sure you want to end the session?
              </p>
            ) : (
              <p style={styles.modalText}>
                You have labeled {currentIndex} of {runs.length} runs.
              </p>
            )}
            <p style={styles.modalText}>
              Press <strong>Y</strong> (<strong>Enter</strong>) to confirm, <strong>N</strong> (<strong>Esc</strong>) to cancel.
            </p>
            <div style={styles.modalButtons}>
              <button
                onClick={handleConcludeSession}
                style={currentIndex === 0 ? styles.modalButtonWarning : styles.modalButtonConfirm}
              >
                Yes (Y)
              </button>
              <button
                onClick={() => setShowConcludeConfirm(false)}
                style={styles.modalButtonCancel}
              >
                No (N)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load New Runs Confirmation Modal */}
      {showLoadConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>Load New Runs?</h2>
            <p style={styles.modalText}>
              You have an active session with {labeledCount} of {runs.length} runs labeled.
            </p>
            <p style={styles.modalText}>
              Your labels have been saved. Loading new runs will end your current session.
            </p>
            <p style={styles.modalText}>
              Press <strong>Y</strong> to confirm, <strong>N</strong> to cancel.
            </p>
            <div style={styles.modalButtons}>
              <button
                onClick={handleConfirmLoadRuns}
                style={styles.modalButtonConfirm}
              >
                Yes, Load New Runs (Y)
              </button>
              <button
                onClick={handleCancelLoadRuns}
                style={styles.modalButtonCancel}
              >
                No, Keep Session (N)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Early Exit Confirmation Modal - Red/Danger styling */}
      {showEarlyExitConfirm && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modal, border: '3px solid #dc2626' }}>
            <h2 style={{ ...styles.modalTitle, color: '#dc2626' }}>
              Early Exit - Are You Sure?
            </h2>
            <p style={styles.modalText}>
              You have labeled <strong>{labeledCount}</strong> of <strong>{runs.length}</strong> runs.
            </p>
            <p style={{ ...styles.modalText, color: '#dc2626', fontWeight: '500' }}>
              This will clear ALL session data including:
            </p>
            <ul style={styles.earlyExitList}>
              <li>Completed devices list</li>
              <li>Cached device sessions</li>
              <li>Current progress</li>
            </ul>
            <p style={styles.modalText}>
              Your submitted labels are saved. Press <strong>Y</strong> to exit, <strong>N</strong> to cancel.
            </p>
            <div style={styles.modalButtons}>
              <button
                onClick={handleEarlyExitConfirmed}
                style={styles.modalButtonDanger}
              >
                Yes, Exit (Y)
              </button>
              <button
                onClick={() => setShowEarlyExitConfirm(false)}
                style={styles.modalButtonCancel}
              >
                No, Cancel (N)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Session Confirmation Modal - Dark theme like Shift+S */}
      {showPushOnExitConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '450px',
              textAlign: 'center',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white', fontSize: '20px' }}>
              Save Session for Later?
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 12px 0' }}>
              You have <strong style={{ color: '#10b981' }}>{labeledCount}</strong> labels in this session.
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 8px 0', fontSize: '14px' }}>
              <strong style={{ color: '#9ca3af' }}>Yes</strong> = Save as draft, resume later
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 20px 0', fontSize: '14px' }}>
              <strong style={{ color: '#9ca3af' }}>No</strong> = Push to Delta Lake now (starts Spark if needed)
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={handlePushAndConclude}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                No, Push Now (N)
              </button>
              <button
                onClick={handleSkipPushAndConclude}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Yes, Save (Y)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next Device Prompt Modal */}
      {showNextDevicePrompt && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '400px',
              textAlign: 'center',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', color: '#22c55e', fontSize: '20px' }}>
              Device Complete!
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 20px 0' }}>
              All runs for <strong style={{ color: 'white' }}>{currentDeviceId}</strong> have been labeled.
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 12px 0', fontSize: '14px' }}>
              {deviceProgressList.filter(d => d.deviceId !== currentDeviceId && d.labeledCount < d.totalRuns).length} devices remaining
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 20px 0', fontSize: '13px' }}>
              Press <strong style={{ color: '#9ca3af' }}>Y</strong> for Next Device, <strong style={{ color: '#9ca3af' }}>N</strong> to Stay Here
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => setShowNextDevicePrompt(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Stay Here (N)</button>
              <button
                onClick={handleProceedToNextDevice}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
              >
                Next Device (Y) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All Runs Labeled Modal - shown when user finishes all runs */}
      {showAllRunsLabeledModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '32px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '450px',
              textAlign: 'center',
            }}
          >
            {isVerifyingLabels ? (
              <>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    margin: '0 auto 16px',
                    border: '3px solid #374151',
                    borderTop: '3px solid #22c55e',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <h3 style={{ margin: '0 0 16px 0', color: '#22c55e', fontSize: '24px' }}>
                  Syncing Labels...
                </h3>
                <p style={{ color: '#9ca3af', margin: '0 0 8px 0' }}>
                  Verifying <strong style={{ color: 'white' }}>{verifiedLabelCount}</strong> / <strong style={{ color: 'white' }}>{runs.length}</strong> labels saved
                </p>
                <p style={{ color: '#6b7280', margin: '0', fontSize: '14px' }}>
                  Please wait while labels sync to database...
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
                <h3 style={{ margin: '0 0 16px 0', color: '#22c55e', fontSize: '24px' }}>
                  All Runs Labeled!
                </h3>
                <p style={{ color: '#9ca3af', margin: '0 0 8px 0' }}>
                  You've labeled all <strong style={{ color: 'white' }}>{runs.length}</strong> runs in this session.
                </p>
                <p style={{ color: '#6b7280', margin: '0 0 24px 0', fontSize: '14px' }}>
                  What would you like to do?
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button
                    onClick={() => {
                      setShowAllRunsLabeledModal(false);
                      handleSkipPushAndConclude();
                    }}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#374151',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Save for Later
                  </button>
                  <button
                    onClick={handleVerifyAndPush}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#22c55e',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                    }}
                  >
                    Push to Delta Lake
                  </button>
                </div>
                <p style={{ color: '#6b7280', margin: '16px 0 0 0', fontSize: '12px' }}>
                  Press <strong style={{ color: '#9ca3af' }}>N</strong> to Save, <strong style={{ color: '#9ca3af' }}>Y</strong> to Push
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hotkey Guide Modal */}
      {showHotkeyGuide && (
        <div style={styles.modalOverlay} onClick={() => setShowHotkeyGuide(false)}>
          <div style={{ ...styles.modal, maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Keyboard Shortcuts</h2>

            <div style={styles.hotkeySection}>
              <h3 style={styles.hotkeySectionTitle}>Navigation</h3>
              <div style={styles.hotkeyGrid}>
                <span style={styles.hotkeyKey}>← / T</span><span style={styles.hotkeyDesc}>Previous run</span>
                <span style={styles.hotkeyKey}>→ / G</span><span style={styles.hotkeyDesc}>Next run</span>
                <span style={styles.hotkeyKey}>H</span><span style={styles.hotkeyDesc}>Jump to first unlabeled</span>
                <span style={styles.hotkeyKey}>N</span><span style={styles.hotkeyDesc}>Jump to last run</span>
              </div>
            </div>

            <div style={styles.hotkeySection}>
              <h3 style={styles.hotkeySectionTitle}>Labeling</h3>
              <div style={styles.hotkeyGrid}>
                <span style={styles.hotkeyKey}>1</span><span style={styles.hotkeyDesc}>Label as Class A</span>
                <span style={styles.hotkeyKey}>2</span><span style={styles.hotkeyDesc}>Label as Class B</span>
                <span style={styles.hotkeyKey}>3</span><span style={styles.hotkeyDesc}>Label as Invalid</span>
              </div>
            </div>

            <div style={styles.hotkeySection}>
              <h3 style={styles.hotkeySectionTitle}>Chart Controls</h3>
              <div style={styles.hotkeyGrid}>
                <span style={styles.hotkeyKey}>Q / E</span><span style={styles.hotkeyDesc}>Move slider window left/right</span>
                <span style={styles.hotkeyKey}>A</span><span style={styles.hotkeyDesc}>Toggle Auto Scale (visible data)</span>
                <span style={styles.hotkeyKey}>S</span><span style={styles.hotkeyDesc}>Toggle Full Scale (entire series)</span>
                <span style={styles.hotkeyKey}>C</span><span style={styles.hotkeyDesc}>Toggle Colorblind Mode</span>
                <span style={styles.hotkeyKey}>R</span><span style={styles.hotkeyDesc}>Reset chart view</span>
                <span style={styles.hotkeyKey}>Ctrl+Z</span><span style={styles.hotkeyDesc}>Undo zoom</span>
              </div>
            </div>

            <div style={styles.hotkeySection}>
              <h3 style={styles.hotkeySectionTitle}>Session</h3>
              <div style={styles.hotkeyGrid}>
                <span style={styles.hotkeyKey}>Esc / Space</span><span style={styles.hotkeyDesc}>Early exit dialog</span>
                <span style={styles.hotkeyKey}>Y</span><span style={styles.hotkeyDesc}>Confirm / Push to Delta (in dialogs)</span>
                <span style={styles.hotkeyKey}>N</span><span style={styles.hotkeyDesc}>Cancel / Save for later (in dialogs)</span>
                <span style={styles.hotkeyKey}>Shift+S</span><span style={styles.hotkeyDesc}>Start Spark cluster</span>
                <span style={styles.hotkeyKey}>?</span><span style={styles.hotkeyDesc}>Toggle this help</span>
              </div>
            </div>

            <div style={styles.hotkeySection}>
              <h3 style={styles.hotkeySectionTitle}>Device Selector</h3>
              <div style={styles.hotkeyGrid}>
                <span style={styles.hotkeyKey}>Ctrl+Enter</span><span style={styles.hotkeyDesc}>Load runs (in device filter)</span>
              </div>
            </div>

            <button
              onClick={() => setShowHotkeyGuide(false)}
              style={{ ...styles.modalButtonConfirm, marginTop: '20px' }}
            >
              Close (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Cluster Start Confirmation Modal - Dark theme */}
      {showClusterConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowClusterConfirm(false)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px 0', color: 'white' }}>
              Start Spark Cluster?
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 12px 0' }}>
              The cluster will automatically shut down after 3 minutes of inactivity.
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 20px 0', fontSize: '14px' }}>
              Press <strong style={{ color: '#9ca3af' }}>Y</strong> to confirm, <strong style={{ color: '#9ca3af' }}>N</strong> to cancel
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowClusterConfirm(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                No (N)
              </button>
              <button
                onClick={handleStartCluster}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Yes (Y)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End of Session Modal - Session complete or reached end */}
      {showEndOfSessionModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modal, maxWidth: '450px' }}>
            <h2 style={styles.modalTitle}>
              {missedCount === 0 ? 'All Runs Labeled!' : 'End of Runs'}
            </h2>
            <p style={{
              ...styles.modalText,
              color: getCompletionColor(completionPercent),
              fontWeight: '600',
              fontSize: '18px',
              marginBottom: '15px'
            }}>
              {labeledCount} of {runs.length} runs labeled ({completionPercent.toFixed(0)}%)
            </p>
            {missedCount > 0 && (
              <p style={{
                ...styles.modalText,
                color: getCompletionColor(completionPercent),
                marginBottom: '15px'
              }}>
                You missed {missedCount} run{missedCount > 1 ? 's' : ''}.
              </p>
            )}
            {missedCount === 0 ? (
              <p style={styles.modalSuccess}>
                Great work! You've labeled all runs in this batch.
              </p>
            ) : (
              <p style={styles.modalText}>
                Would you like to go back and label the missed runs?
              </p>
            )}
            <p style={{ ...styles.modalText, fontSize: '13px', color: '#6b7280' }}>
              {missedCount > 0 && <><strong>H</strong> = Go to missed | </>}<strong>Y</strong> = Push to Delta | <strong>N</strong> = Save draft
            </p>
            <div style={{ ...styles.modalButtons, flexWrap: 'wrap', gap: '10px' }}>
              {missedCount > 0 && (
                <button
                  onClick={handleGoToFirstUnlabeled}
                  style={{
                    ...styles.modalButtonConfirm,
                    backgroundColor: '#3b82f6',
                    width: '100%',
                  }}
                >
                  Go to First Missed Run <strong>(H)</strong>
                </button>
              )}
              <button
                onClick={handlePushAndConclude}
                style={{ ...styles.modalButtonConfirm, flex: 1 }}
              >
                Push to Delta (Y)
              </button>
              <button
                onClick={handleSkipPushAndConclude}
                style={{ ...styles.modalButtonCancel, flex: 1 }}
              >
                Save Draft (N)
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div style={styles.notification}>
          {notification}
        </div>
      )}

      {/* Push Complete Refresh Prompt Modal */}
      {showPushCompleteRefresh && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              padding: '32px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              maxWidth: '450px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h3 style={{ margin: '0 0 16px 0', color: '#22c55e', fontSize: '24px' }}>
              Push Complete!
            </h3>
            <p style={{ color: '#9ca3af', margin: '0 0 8px 0' }}>
              Labels have been successfully pushed to Delta Lake.
            </p>
            <p style={{ color: '#6b7280', margin: '0 0 24px 0', fontSize: '14px' }}>
              Please refresh the page to clear the saved session state.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 32px',
                backgroundColor: '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500',
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      )}

      {/* Session Banner - shows progress when backend session is active (hide when launcher is shown) */}
      {activeSessionId && sessionActive && !showSessionLauncher && (
        <SessionBanner
          sessionId={activeSessionId}
          localLabeledCount={userLabels.size}
          localTotalRuns={runs.length}
        />
      )}

      {/* Session Launch Page */}
      {showSessionLauncher && (
        <SessionLaunchPage
          onSessionSelect={handleSessionSelect}
          onNewSession={() => {
            // Close sessions page and show the main interface with DeviceSelector
            setShowSessionLauncher(false);
            setIsCreatingNewSession(true);  // Mark that we're creating a new backend session
            // Clear completed devices from previous sessions - starting fresh
            setCompletedDevices([]);
            setDeviceSessions({});
            localStorage.removeItem(COMPLETED_DEVICES_KEY);
            localStorage.removeItem(DEVICE_SESSIONS_KEY);
          }}
          labelerName={labelerName || 'default_labeler'}
          modelType={modelType}
          pushingSessionId={pushingSessionId}
          refreshTrigger={refreshSessionsTrigger}
        />
      )}

      {/* Main labeling interface - only show when not in session launcher */}
      {!showSessionLauncher && (
        <>
          {/* Show DeviceNavigator during active session, DeviceSelector otherwise */}
          {sessionActive ? (
            <DeviceNavigator
              devices={deviceProgressList}
              currentDeviceId={currentDeviceId}
              onDeviceSelect={handleDeviceSelect}
              labelerName={labelerName}
              modelType={modelType}
            />
          ) : (
            <DeviceSelector
              onLoadRuns={handleLoadRuns}
              disabled={loading}
              completedDevices={completedDevices}
              onDevicesLoaded={setAvailableDevices}
              autoSelectDevice={autoSelectDevice}
              sessionActive={sessionActive}
              onNotification={showNotification}
            />
          )}

          {error && (
            <div style={styles.errorBox}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {sessionActive && runs.length === 0 && !loading && (
            <div style={styles.infoBox}>
              No unlabeled runs found for the selected criteria.
            </div>
          )}

          {sessionActive && currentRun && (
            <div style={styles.session}>
              <RunNavigator
                currentIndex={currentDeviceIndex}
                totalRuns={currentDeviceRuns.length}
                runId={currentRun.run_id}
                deviceId={currentRun.device_id}
                onPrevious={handlePrevious}
                onNext={handleNext}
                onGoToIndex={(deviceIdx) => {
                  // Convert device index to global index
                  if (deviceIdx >= 0 && deviceIdx < currentDeviceRuns.length) {
                    const targetRun = currentDeviceRuns[deviceIdx];
                    const globalIdx = runs.findIndex(r => r.run_id === targetRun.run_id);
                    if (globalIdx >= 0) {
                      handleGoToIndex(globalIdx);
                    }
                  }
                }}
                hasPrevious={hasPreviousInDevice}
                hasNext={hasNextInDevice}
                labeledRunIds={new Set(userLabels.keys())}
                runs={currentDeviceRuns}
              />

              <StatusIndicator
                status={currentRun.label_status}
                userLabel={userLabels.get(currentRun.run_id) ?? null}
              />

              <div style={styles.chartContainer}>
                <TimeSeriesChart
                  key={currentRun.run_id}
                  data={currentRun.timeseries}
                  title={`Run ${currentDeviceIndex + 1} of ${currentDeviceRuns.length} (Device: ${currentRun.device_id})`}
                  globalYMax={globalYMax}
                />
              </div>

              <LabelButtons onLabel={handleLabel} disabled={loading} />
            </div>
          )}

          {(loading || isLoadingRuns) && (
            <div style={styles.loading}>
              <div style={styles.spinner}></div>
              <p>{isLoadingRuns ? 'Loading Runs...' : 'Loading...'}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '30px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '30px',
    position: 'relative' as const,
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '32px',
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    margin: 0,
    fontSize: '16px',
    color: '#6b7280',
  },
  notification: {
    position: 'fixed' as const,
    top: '20px',
    right: '20px',
    padding: '15px 20px',
    backgroundColor: '#10b981',
    color: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    fontWeight: '500',
    zIndex: 99999,  // Above everything including modals
    animation: 'slideIn 0.3s ease-out',
    fontSize: '14px',
    maxWidth: '400px',
  },
  errorBox: {
    padding: '15px',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  infoBox: {
    padding: '15px',
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  session: {
    marginTop: '30px',
  },
  chartContainer: {
    marginBottom: '25px',
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '50px',
    color: '#6b7280',
  },
  spinner: {
    width: '40px',
    height: '40px',
    margin: '0 auto 15px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    backgroundColor: 'white',
    padding: '30px 40px',
    borderRadius: '12px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
    textAlign: 'center' as const,
    maxWidth: '400px',
  },
  modalTitle: {
    margin: '0 0 15px 0',
    fontSize: '24px',
    fontWeight: '600',
    color: '#111827',
  },
  modalText: {
    margin: '0 0 10px 0',
    fontSize: '16px',
    color: '#4b5563',
  },
  modalWarning: {
    margin: '0 0 10px 0',
    fontSize: '16px',
    color: '#dc2626',
    fontWeight: '500',
  },
  modalSuccess: {
    margin: '0 0 10px 0',
    fontSize: '16px',
    color: '#059669',
    fontWeight: '500',
  },
  modalButtons: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'center',
    marginTop: '20px',
  },
  modalButtonConfirm: {
    padding: '10px 25px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  modalButtonWarning: {
    padding: '10px 25px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  modalButtonCancel: {
    padding: '10px 25px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  modalButtonDanger: {
    padding: '10px 25px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  earlyExitButton: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    padding: '8px 16px',
    backgroundColor: 'white',
    color: '#dc2626',
    border: '2px solid #dc2626',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    lineHeight: '1.3',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  earlyExitHotkey: {
    fontSize: '11px',
    opacity: 0.8,
  } as React.CSSProperties,
  topRightControls: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as React.CSSProperties,
  sessionsButton: {
    padding: '8px 16px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  helpButton: {
    width: '36px',
    height: '36px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '50%',
    fontSize: '18px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  utcPill: {
    padding: '4px 8px',
    backgroundColor: '#374151',
    color: '#9ca3af',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace',
  } as React.CSSProperties,
  earlyExitList: {
    textAlign: 'left' as const,
    margin: '10px 0',
    paddingLeft: '30px',
    color: '#4b5563',
    fontSize: '14px',
    lineHeight: '1.8',
  },
  hotkeySection: {
    marginBottom: '20px',
    textAlign: 'left' as const,
  },
  hotkeySectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  hotkeyGrid: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr',
    gap: '8px 16px',
    alignItems: 'center',
  },
  hotkeyKey: {
    fontFamily: 'monospace',
    backgroundColor: '#f3f4f6',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center' as const,
    border: '1px solid #e5e7eb',
  },
  hotkeyDesc: {
    fontSize: '14px',
    color: '#6b7280',
  },
};

export default App;
