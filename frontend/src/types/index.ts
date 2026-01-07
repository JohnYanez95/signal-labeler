/**
 * TypeScript type definitions matching the backend API models.
 */

export interface TimeSeriesPoint {
  ts: number;  // Unix timestamp
  value: number;  // Sensor reading
}

export interface RunMetadata {
  run_id: string;
  device_id: string;
  start_ts: number;
  end_ts: number;
  run_length: number;
  is_labeled: boolean;
}

export interface LabelStatus {
  is_labeled: boolean;
  n_votes: number;
  counts: Record<number, number>;
}

export interface Run {
  run_id: string;
  device_id: string;
  start_ts: number;
  end_ts: number;
  label_status: LabelStatus;
  timeseries: TimeSeriesPoint[];
}

export interface LabelVote {
  run_id: string;
  model_type: string;
  labeler: string;
  label: number;  // 0: class_a, 1: class_b, 2: invalid
  notes?: string;
}

export interface SampleRunsRequest {
  device_id: string;
  start_ts: number;
  end_ts: number;
  model_type: string;
  sample_size: number;
  labeler?: string;  // If provided, only excludes runs labeled by this labeler
  unlabeled_only: boolean;
}

export interface SampleRunsResponse {
  runs: RunMetadata[];
  global_y_max: number | null;  // Max Y value across all sampled runs' timeseries
}

export interface RunsByIdsRequest {
  run_ids: string[];
}

export interface RunsByIdsResponse {
  runs: RunMetadata[];
  global_y_max: number | null;
}

export interface DevicesResponse {
  devices: string[];
}

export interface DeviceMetadata {
  device_id: string;
  run_count: number;
  run_ids: string[];
}

export interface DeltaDevicesResponse {
  devices: DeviceMetadata[];
  total_devices: number;
  total_runs: number;
  query_date_start: number;
  query_date_end: number;
}

export interface LabelSubmitResponse {
  success: boolean;
  already_labeled: boolean;
  message?: string;
}

export interface User {
  user_id: number;
  user_name: string;
}

export interface UsersResponse {
  users: User[];
}

export interface ModelType {
  model_id: number;
  model_name: string;
}

export interface ModelsResponse {
  models: ModelType[];
}

export type LabelType = 0 | 1 | 2;

export const LABEL_NAMES: Record<LabelType, string> = {
  0: 'Class A',
  1: 'Class B',
  2: 'Invalid'
};

export const LABEL_COLORS: Record<LabelType, string> = {
  0: '#ef4444',  // Red for class_a
  1: '#3b82f6',  // Blue for class_b
  2: '#f59e0b'   // Amber for error
};

// Cluster/Session types

export type ClusterStatus = 'off' | 'starting' | 'on';

export interface ClusterStatusResponse {
  status: ClusterStatus;
  seconds_until_timeout: number | null;
}

export interface SessionInfo {
  session_id: string;
  name: string;
  device_ids: string[];
  date_range_start: number;
  date_range_end: number;
  model_type: string;
  labeler: string;
  total_runs: number;
  labeled_count: number;
  progress_percent: number;
  progress_color: 'red' | 'yellow' | 'green';
  created_at: string;
  updated_at: string;
}

export interface SessionsListResponse {
  sessions: SessionInfo[];
  max_sessions: number;
}

export interface NewSessionRequest {
  device_ids: string[];
  date_range_start: number;
  date_range_end: number;
  model_type: string;
  labeler: string;
  sample_size: number;
}

export interface NewSessionResponse {
  success: boolean;
  session_id: string | null;
  message: string | null;
  runs_loaded: number;
}

export interface SessionProgressResponse {
  session_id: string;
  total_runs: number;
  labeled_count: number;
  progress_percent: number;
  progress_color: 'red' | 'yellow' | 'green';
  at_80_percent: boolean;
}

export interface PushSessionResponse {
  success: boolean;
  labels_pushed: number;
  message: string | null;
}
