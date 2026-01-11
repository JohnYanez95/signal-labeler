/**
 * Tests for useRunsData hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRunsData } from './useRunsData'
import { api } from '../services/api'
import type { Run, RunMetadata } from '../types'

// Mock the API module
vi.mock('../services/api', () => ({
  api: {
    getRun: vi.fn(),
    getSessionRunDetail: vi.fn(),
    submitLabel: vi.fn(),
  },
}))

// Sample test data
const mockRunMetadata: RunMetadata = {
  run_id: 'run_001',
  device_id: 'device_1',
  start_ts: 1704067200,
  end_ts: 1704067260,
  run_length: 60,
  is_labeled: false,
}

const mockRun: Run = {
  ...mockRunMetadata,
  timeseries: [
    { ts: 1704067200, value: 50 },
    { ts: 1704067210, value: 55 },
  ],
  label_status: {
    is_labeled: false,
    n_votes: 0,
    counts: {},
  },
}

describe('useRunsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('starts with empty runs array', () => {
      const { result } = renderHook(() => useRunsData())

      expect(result.current.runs).toEqual([])
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentRun).toBeNull()
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
    })
  })

  describe('restoreSession', () => {
    it('restores session state and loads current run', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      expect(result.current.runs).toHaveLength(1)
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.globalYMax).toBe(100)

      await waitFor(() => {
        expect(result.current.currentRun).not.toBeNull()
      })
    })

    it('uses session cache endpoint when sessionId provided', async () => {
      vi.mocked(api.getSessionRunDetail).mockResolvedValueOnce(mockRun)

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1',
          'session_001'
        )
      })

      expect(api.getSessionRunDetail).toHaveBeenCalledWith(
        'session_001',
        'run_001',
        'classification_v1'
      )
    })
  })

  describe('goToIndex', () => {
    it('navigates to specified index', async () => {
      const runs = [
        { ...mockRunMetadata, run_id: 'run_001' },
        { ...mockRunMetadata, run_id: 'run_002' },
      ]
      const run2: Run = { ...mockRun, run_id: 'run_002' }

      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)
      vi.mocked(api.getRun).mockResolvedValueOnce(run2)

      const { result } = renderHook(() => useRunsData())

      // Restore session with first run
      await act(async () => {
        await result.current.restoreSession(runs, 0, 100, 'classification_v1')
      })

      // Navigate to second run
      await act(async () => {
        result.current.goToIndex(1, 'classification_v1')
      })

      expect(result.current.currentIndex).toBe(1)
    })

    it('uses cached run if available', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      // Clear the mock to verify cache is used
      vi.mocked(api.getRun).mockClear()

      // Navigate back to same index (should use cache)
      await act(async () => {
        result.current.goToIndex(0, 'classification_v1')
      })

      // Should not call API again - using cache
      expect(api.getRun).not.toHaveBeenCalled()
    })

    it('ignores invalid index', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      // Try invalid indices
      await act(async () => {
        result.current.goToIndex(-1, 'classification_v1')
      })
      expect(result.current.currentIndex).toBe(0)

      await act(async () => {
        result.current.goToIndex(999, 'classification_v1')
      })
      expect(result.current.currentIndex).toBe(0)
    })
  })

  describe('submitLabel', () => {
    it('submits label and updates cache', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)
      vi.mocked(api.submitLabel).mockResolvedValueOnce({ success: true, already_labeled: false })

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      await act(async () => {
        const success = await result.current.submitLabel(
          'run_001',
          'classification_v1',
          'test_user',
          0
        )
        expect(success).toBe(true)
      })

      expect(api.submitLabel).toHaveBeenCalledWith({
        run_id: 'run_001',
        model_type: 'classification_v1',
        labeler: 'test_user',
        label: 0,
      })

      // Cache should be updated
      expect(result.current.currentRun?.label_status.is_labeled).toBe(true)
      expect(result.current.currentRun?.label_status.n_votes).toBe(1)
      expect(result.current.currentRun?.label_status.counts[0]).toBe(1)
    })

    it('handles re-vote correctly', async () => {
      const labeledRun: Run = {
        ...mockRun,
        label_status: { is_labeled: true, n_votes: 1, counts: { 0: 1 } },
      }
      vi.mocked(api.getRun).mockResolvedValueOnce(labeledRun)
      vi.mocked(api.submitLabel).mockResolvedValueOnce({ success: true, already_labeled: true })

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      // Re-vote from 0 to 1
      await act(async () => {
        await result.current.submitLabel(
          'run_001',
          'classification_v1',
          'test_user',
          1,
          0  // previous label
        )
      })

      // n_votes should stay the same, counts should update
      expect(result.current.currentRun?.label_status.n_votes).toBe(1)
      expect(result.current.currentRun?.label_status.counts[0]).toBe(0)
      expect(result.current.currentRun?.label_status.counts[1]).toBe(1)
    })

    it('returns false on error', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)
      vi.mocked(api.submitLabel).mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      await act(async () => {
        const success = await result.current.submitLabel(
          'run_001',
          'classification_v1',
          'test_user',
          0
        )
        expect(success).toBe(false)
      })

      expect(result.current.error).toBe('Network error')
    })
  })

  describe('clearSession', () => {
    it('clears all state', async () => {
      vi.mocked(api.getRun).mockResolvedValueOnce(mockRun)

      const { result } = renderHook(() => useRunsData())

      await act(async () => {
        await result.current.restoreSession(
          [mockRunMetadata],
          0,
          100,
          'classification_v1'
        )
      })

      act(() => {
        result.current.clearSession()
      })

      expect(result.current.runs).toEqual([])
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentRun).toBeNull()
      expect(result.current.globalYMax).toBeNull()
      expect(result.current.error).toBeNull()
    })
  })
})
