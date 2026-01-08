# Performance TODO

## High Priority

### 1. Parallelize Session Load API Calls (App.tsx:532-588)

**Problem:** `handleSessionSelect` makes 3 sequential API calls:
```tsx
const sessionInfo = await api.getSession(sessionId);        // Wait...
const response = await api.getSessionRuns(sessionId);       // Wait...
const labelsRecord = await api.getSessionUserLabels(sessionId); // Wait...
```

**Fix:** Fetch all in parallel:
```tsx
const [sessionInfo, runsResponse, labelsRecord] = await Promise.all([
  api.getSession(sessionId),
  api.getSessionRuns(sessionId),
  api.getSessionUserLabels(sessionId).catch(() => ({})),  // Graceful fallback
]);
```

---

### 2. Optimistic Label Submission (App.tsx:402-460)

**Problem:** `handleLabel` awaits API response before updating UI, causing perceived lag.

**Fix:** Update UI immediately, fire API in background:

```tsx
const handleLabel = async (label: LabelType) => {
  if (!currentRun || !labelerName) return;

  const previousLabel = userLabels.get(currentRun.run_id) ?? null;
  const runId = currentRun.run_id;

  // 1. Optimistic UI update FIRST (instant feedback)
  const newUserLabels = new Map(userLabels);
  newUserLabels.set(runId, label);
  setUserLabels(newUserLabels);
  showNotification(`Labeled as: ${['Class A', 'Class B', 'Invalid'][label]}`);

  // 2. Fire API call in background (don't await)
  submitLabel(runId, modelType, labelerName, label, previousLabel)
    .catch(() => {
      // Rollback on failure
      const rolledBack = new Map(userLabels);
      rolledBack.delete(runId);
      setUserLabels(rolledBack);
      showNotification('Label failed to save!');
    });

  // 3. Auto-advance immediately (don't wait for API)
  if (newUserLabels.size === runs.length) {
    setShowAllRunsLabeledModal(true);
  } else if (hasNextInDevice) {
    // ... existing navigation logic
  }
};
```

---

### 3. Navigation Cache Check (useRunsData.ts:139-162)

**Problem:** `goToIndex` calls `loadCurrentRun` which is async even when cached.

**Current:**
```tsx
const goToIndex = useCallback(async (index: number, ...) => {
  setCurrentIndex(index);
  await loadCurrentRun(targetRunId, modelType, sessionId);  // Awaits even if cached
}, [runs]);
```

**Fix:** Check cache synchronously, only await if miss:
```tsx
const goToIndex = useCallback((index: number, ...) => {
  setCurrentIndex(index);
  const cached = runsCache.current.get(targetRunId);
  if (cached) {
    setCurrentRun(cached);  // Sync - instant
  } else {
    loadCurrentRun(targetRunId, modelType, sessionId);  // Fire and forget
  }
}, [runs]);
```

---

### 4. Remove Unnecessary Awaits in Device Selection (App.tsx:488-524)

**Problem:** `handleDeviceSelect` and `handleProceedToNextDevice` await navigation even though runs are already cached:
```tsx
await goToIndex(globalIndex, modelType, activeSessionId || undefined, targetRun.run_id);
```

**Fix:** Don't await - runs are cached from session load:
```tsx
// No await needed - cache is populated
goToIndex(globalIndex, modelType, activeSessionId || undefined, targetRun.run_id);
```

Same for `handleProceedToNextDevice`:
```tsx
// Before
await handleDeviceSelect(nextDevice.deviceId);

// After - no await needed
handleDeviceSelect(nextDevice.deviceId);
```

---

### 5. Don't Await restoreSession First Run (useRunsData.ts:239)

**Problem:** `restoreSession` awaits `loadCurrentRun` for the first run:
```tsx
await loadCurrentRun(savedRuns[savedIndex].run_id, modelType, sessionId);
```

**Fix:** Since this is the first load and cache is empty, we need the await for the first run. BUT the caller (`handleSessionSelect`) doesn't need to await `restoreSession` - it can show the UI immediately while the first run loads:
```tsx
// In App.tsx handleSessionSelect, line 569
// Before
await restoreSession(response.runs, 0, response.global_y_max, sessionInfo.model_type, sessionId);
setSessionActive(true);

// After - show UI immediately, first run will appear when loaded
restoreSession(response.runs, 0, response.global_y_max, sessionInfo.model_type, sessionId);
setSessionActive(true);
```

---

## Medium Priority

### 6. Cancel Preloading on Session End (useRunsData.ts:107-137)

**Problem:** Background preloading continues after session push, causing 404 errors.

**Fix:** Add AbortController:
```tsx
const preloadAbortRef = useRef<AbortController | null>(null);

const preloadAllRuns = useCallback(async (runIds, modelType, sessionId, onProgress) => {
  // Cancel any existing preload
  preloadAbortRef.current?.abort();
  preloadAbortRef.current = new AbortController();
  const signal = preloadAbortRef.current.signal;

  for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
    if (signal.aborted) return;  // Exit if cancelled
    // ... existing batch logic
  }
}, []);

const clearSession = () => {
  preloadAbortRef.current?.abort();  // Cancel preloading
  // ... existing cleanup
};
```

---

### 7. Reduce Preload Batch Size for Low-End Devices

**File:** `useRunsData.ts:117`

**Current:** `const BATCH_SIZE = 10;`

**Option:** Make configurable or detect device capability:
```tsx
const BATCH_SIZE = navigator.hardwareConcurrency > 4 ? 10 : 3;
```

---

## Low Priority (Minor Gains)

### 8. ECharts Lazy Update (TimeSeriesChart.tsx:913)

```tsx
<ReactECharts
  ref={chartRef}
  option={option}
  lazyUpdate={true}   // Add
  notMerge={false}    // Add
  // ...
/>
```

### 9. Memoize Chart Option (TimeSeriesChart.tsx:676-855)

Wrap `option` object in `useMemo` with proper dependencies. More involved refactor - the option has many dependencies that need careful tracking.

---

## Notes

- **Items 1-5** (High Priority) will have the most noticeable impact:
  - #1: Faster session load (parallel API calls)
  - #2: Instant label feedback (optimistic updates)
  - #3: Instant navigation when cached
  - #4: Instant device switching
  - #5: Faster session resume
- **Item 6** eliminates 404 noise in console after push
- **Items 8 & 9** are micro-optimizations, likely minimal perceived difference
