/**
 * API client for communicating with the backend.
 */

import type {
  DevicesResponse,
  DeltaDevicesResponse,
  SampleRunsRequest,
  SampleRunsResponse,
  RunsByIdsResponse,
  Run,
  LabelVote,
  LabelSubmitResponse,
  LabelStatus,
  User,
  UsersResponse,
  ModelType,
  ModelsResponse,
  ClusterStatusResponse,
  SessionInfo,
  SessionsListResponse,
  NewSessionRequest,
  NewSessionResponse,
  SessionProgressResponse,
  PushSessionResponse,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, error.detail || 'Request failed');
  }

  return response.json();
}

export const api = {
  /**
   * Get list of device IDs in a time range.
   * If modelType and labeler are provided, only returns devices with unlabeled runs for that labeler.
   */
  async getDevices(startTs: number, endTs: number, modelType?: string, labeler?: string): Promise<string[]> {
    let url = `${API_BASE_URL}/api/devices?start_ts=${startTs}&end_ts=${endTs}`;
    if (modelType) url += `&model_type=${encodeURIComponent(modelType)}`;
    if (labeler) url += `&labeler=${encodeURIComponent(labeler)}`;
    const response = await fetchJson<DevicesResponse>(url);
    return response.devices;
  },

  /**
   * Query Delta Lake for devices and their runs (metadata only).
   * This starts Spark if needed and queries Delta directly.
   */
  async queryDeltaDevices(startTs: number, endTs: number, modelType?: string, labeler?: string): Promise<DeltaDevicesResponse> {
    let url = `${API_BASE_URL}/api/delta/devices?start_ts=${startTs}&end_ts=${endTs}`;
    if (modelType) url += `&model_type=${encodeURIComponent(modelType)}`;
    if (labeler) url += `&labeler=${encodeURIComponent(labeler)}`;
    return fetchJson<DeltaDevicesResponse>(url);
  },

  /**
   * Get the current system username (for autofill).
   */
  async getSystemUsername(): Promise<string | null> {
    try {
      const response = await fetchJson<{ username: string | null }>(`${API_BASE_URL}/api/system/username`);
      return response.username;
    } catch {
      return null;
    }
  },

  /**
   * Sample unlabeled runs for a device.
   */
  async sampleRuns(request: SampleRunsRequest): Promise<SampleRunsResponse> {
    return fetchJson<SampleRunsResponse>(
      `${API_BASE_URL}/api/runs/sample`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  },

  /**
   * Get runs by their IDs (for restoring cached sessions).
   */
  async getRunsByIds(runIds: string[]): Promise<RunsByIdsResponse> {
    return fetchJson<RunsByIdsResponse>(
      `${API_BASE_URL}/api/runs/by-ids`,
      {
        method: 'POST',
        body: JSON.stringify({ run_ids: runIds }),
      }
    );
  },

  /**
   * Get full run details including timeseries and label status.
   */
  async getRun(runId: string, modelType: string): Promise<Run> {
    return fetchJson<Run>(
      `${API_BASE_URL}/api/runs/${runId}?model_type=${modelType}`
    );
  },

  /**
   * Submit a label vote.
   */
  async submitLabel(vote: LabelVote): Promise<LabelSubmitResponse> {
    return fetchJson<LabelSubmitResponse>(
      `${API_BASE_URL}/api/labels`,
      {
        method: 'POST',
        body: JSON.stringify(vote),
      }
    );
  },

  /**
   * Get label status for a run.
   */
  async getLabelStatus(runId: string, modelType: string): Promise<LabelStatus> {
    return fetchJson<LabelStatus>(
      `${API_BASE_URL}/api/labels/status/${runId}?model_type=${modelType}`
    );
  },

  /**
   * Get all users.
   */
  async getUsers(): Promise<User[]> {
    const response = await fetchJson<UsersResponse>(`${API_BASE_URL}/api/users`);
    return response.users;
  },

  /**
   * Create a new user.
   */
  async createUser(userName: string): Promise<User> {
    return fetchJson<User>(
      `${API_BASE_URL}/api/users`,
      {
        method: 'POST',
        body: JSON.stringify({ user_name: userName }),
      }
    );
  },

  /**
   * Get all model types.
   */
  async getModels(): Promise<ModelType[]> {
    const response = await fetchJson<ModelsResponse>(`${API_BASE_URL}/api/models`);
    return response.models;
  },

  /**
   * Create a new model type.
   */
  async createModel(modelName: string): Promise<ModelType> {
    return fetchJson<ModelType>(
      `${API_BASE_URL}/api/models`,
      {
        method: 'POST',
        body: JSON.stringify({ model_name: modelName }),
      }
    );
  },

  // Cluster API

  /**
   * Get Spark cluster status.
   */
  async getClusterStatus(): Promise<ClusterStatusResponse> {
    return fetchJson<ClusterStatusResponse>(`${API_BASE_URL}/api/cluster/status`);
  },

  /**
   * Start the Spark cluster manually.
   */
  async startCluster(): Promise<ClusterStatusResponse> {
    return fetchJson<ClusterStatusResponse>(
      `${API_BASE_URL}/api/cluster/start`,
      { method: 'POST' }
    );
  },

  /**
   * Reset cluster timeout (keep alive).
   */
  async touchCluster(): Promise<ClusterStatusResponse> {
    return fetchJson<ClusterStatusResponse>(
      `${API_BASE_URL}/api/cluster/touch`,
      { method: 'POST' }
    );
  },

  // Sessions API

  /**
   * Get all saved sessions.
   */
  async getSessions(): Promise<SessionsListResponse> {
    return fetchJson<SessionsListResponse>(`${API_BASE_URL}/api/sessions`);
  },

  /**
   * Get a specific session.
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    return fetchJson<SessionInfo>(`${API_BASE_URL}/api/sessions/${sessionId}`);
  },

  /**
   * Create a new labeling session.
   */
  async createSession(request: NewSessionRequest): Promise<NewSessionResponse> {
    return fetchJson<NewSessionResponse>(
      `${API_BASE_URL}/api/sessions`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  },

  /**
   * Get session progress.
   */
  async getSessionProgress(sessionId: string): Promise<SessionProgressResponse> {
    return fetchJson<SessionProgressResponse>(
      `${API_BASE_URL}/api/sessions/${sessionId}/progress`
    );
  },

  /**
   * Push session labels to Delta Lake.
   */
  async pushSession(sessionId: string): Promise<PushSessionResponse> {
    return fetchJson<PushSessionResponse>(
      `${API_BASE_URL}/api/sessions/${sessionId}/push`,
      { method: 'POST' }
    );
  },

  /**
   * Delete a session.
   */
  async deleteSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    return fetchJson<{ success: boolean; message: string }>(
      `${API_BASE_URL}/api/sessions/${sessionId}`,
      { method: 'DELETE' }
    );
  },

  /**
   * Get runs cached in a session.
   */
  async getSessionRuns(sessionId: string): Promise<RunsByIdsResponse> {
    return fetchJson<RunsByIdsResponse>(
      `${API_BASE_URL}/api/sessions/${sessionId}/runs`
    );
  },

  /**
   * Get full run details from session cache (including timeseries).
   */
  async getSessionRunDetail(sessionId: string, runId: string, modelType: string): Promise<Run> {
    return fetchJson<Run>(
      `${API_BASE_URL}/api/sessions/${sessionId}/runs/${runId}?model_type=${encodeURIComponent(modelType)}`
    );
  },

  /**
   * Get user's labels for all runs in a session.
   * Returns a map of run_id -> label (0/1/2) for resuming sessions.
   */
  async getSessionUserLabels(sessionId: string): Promise<Record<string, number>> {
    const response = await fetchJson<{ user_labels: Record<string, number> }>(
      `${API_BASE_URL}/api/sessions/${sessionId}/user-labels`
    );
    return response.user_labels;
  },

  /**
   * Get per-device progress for a session.
   * Returns device progress for hover details panel.
   */
  async getSessionDeviceProgress(sessionId: string): Promise<{
    device_id: string;
    total_runs: number;
    labeled_count: number;
    progress_percent: number;
  }[]> {
    const response = await fetchJson<{ devices: {
      device_id: string;
      total_runs: number;
      labeled_count: number;
      progress_percent: number;
    }[] }>(
      `${API_BASE_URL}/api/sessions/${sessionId}/device-progress`
    );
    return response.devices;
  },
};
