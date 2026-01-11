/**
 * Tests for API service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'

// Helper to mock fetch responses
function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(data),
    statusText: 'OK',
  } as Response)
}

function mockFetchError(status: number, detail: string) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ detail }),
    statusText: detail,
  } as Response)
}

describe('api', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  describe('getDevices', () => {
    it('fetches devices with time range', async () => {
      const mockDevices = { devices: ['device_1', 'device_2'] }
      mockFetchResponse(mockDevices)

      const result = await api.getDevices(1704067200, 1704153600)

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/devices?start_ts=1704067200&end_ts=1704153600'),
        expect.any(Object)
      )
      expect(result).toEqual(['device_1', 'device_2'])
    })

    it('includes optional model_type and labeler params', async () => {
      mockFetchResponse({ devices: [] })

      await api.getDevices(1704067200, 1704153600, 'classification_v1', 'test_user')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('model_type=classification_v1'),
        expect.any(Object)
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('labeler=test_user'),
        expect.any(Object)
      )
    })
  })

  describe('getRun', () => {
    it('fetches run with timeseries', async () => {
      const mockRun = {
        run_id: 'run_001',
        device_id: 'device_1',
        start_ts: 1704067200,
        end_ts: 1704067260,
        timeseries: [{ ts: 1704067200, value: 50 }],
        label_status: { is_labeled: false, n_votes: 0, counts: {} },
      }
      mockFetchResponse(mockRun)

      const result = await api.getRun('run_001', 'classification_v1')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/runs/run_001?model_type=classification_v1'),
        expect.any(Object)
      )
      expect(result.run_id).toBe('run_001')
      expect(result.timeseries).toHaveLength(1)
    })
  })

  describe('submitLabel', () => {
    it('submits label vote', async () => {
      const mockResponse = { success: true, already_labeled: false }
      mockFetchResponse(mockResponse)

      const vote = {
        run_id: 'run_001',
        model_type: 'classification_v1',
        labeler: 'test_user',
        label: 0,
      }
      const result = await api.submitLabel(vote)

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/labels'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(vote),
        })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('getLabelStatus', () => {
    it('fetches label status for run', async () => {
      const mockStatus = {
        is_labeled: true,
        n_votes: 2,
        counts: { '0': 1, '1': 1 },
      }
      mockFetchResponse(mockStatus)

      const result = await api.getLabelStatus('run_001', 'classification_v1')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/labels/status/run_001?model_type=classification_v1'),
        expect.any(Object)
      )
      expect(result.is_labeled).toBe(true)
      expect(result.n_votes).toBe(2)
    })
  })

  describe('error handling', () => {
    it('throws ApiError on 404', async () => {
      mockFetchError(404, 'Run not found')

      await expect(api.getRun('nonexistent', 'classification_v1'))
        .rejects.toThrow('Run not found')
    })

    it('throws ApiError on 500', async () => {
      mockFetchError(500, 'Internal server error')

      await expect(api.getDevices(0, 0))
        .rejects.toThrow('Internal server error')
    })
  })

  describe('session management', () => {
    it('lists sessions', async () => {
      const mockSessions = {
        sessions: [
          {
            session_id: 'sess_001',
            name: 'Session 1',
            device_ids: ['device_1'],
            total_runs: 10,
            labeled_count: 5,
            progress_percent: 50,
            progress_color: 'yellow',
          },
        ],
        max_sessions: 3,
      }
      mockFetchResponse(mockSessions)

      const result = await api.getSessions()

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions'),
        expect.any(Object)
      )
      expect(result.sessions).toHaveLength(1)
      expect(result.max_sessions).toBe(3)
    })

    it('creates new session', async () => {
      const mockResponse = {
        success: true,
        session_id: 'sess_new',
        runs_loaded: 50,
      }
      mockFetchResponse(mockResponse)

      const request = {
        device_ids: ['device_1', 'device_2'],
        date_range_start: 1704067200,
        date_range_end: 1704153600,
        model_type: 'classification_v1',
        labeler: 'test_user',
        sample_size: 50,
      }
      const result = await api.createSession(request)

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(request),
        })
      )
      expect(result.success).toBe(true)
      expect(result.session_id).toBe('sess_new')
    })

    it('deletes session', async () => {
      const mockResponse = { success: true }
      mockFetchResponse(mockResponse)

      const result = await api.deleteSession('sess_001')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/sess_001'),
        expect.objectContaining({ method: 'DELETE' })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('cluster management', () => {
    it('gets cluster status', async () => {
      const mockStatus = { status: 'on', seconds_until_timeout: 120 }
      mockFetchResponse(mockStatus)

      const result = await api.getClusterStatus()

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/cluster/status'),
        expect.any(Object)
      )
      expect(result.status).toBe('on')
    })

    it('starts cluster', async () => {
      const mockStatus = { status: 'starting', seconds_until_timeout: null }
      mockFetchResponse(mockStatus)

      const result = await api.startCluster()

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/cluster/start'),
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.status).toBe('starting')
    })
  })
})
