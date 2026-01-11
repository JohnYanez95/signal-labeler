"""
Pydantic models for API request/response.
"""
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class TimeSeriesPoint(BaseModel):
    """A single time-series data point."""
    ts: float = Field(..., description="Unix timestamp")
    value: float = Field(..., description="Sensor reading")


class RunMetadata(BaseModel):
    """Metadata for an RLE run."""
    run_id: str
    device_id: str
    start_ts: float
    end_ts: float
    run_length: int
    is_labeled: bool = False


class LabelStatus(BaseModel):
    """Label status for a run."""
    is_labeled: bool
    n_votes: int = 0
    counts: Dict[int, int] = Field(default_factory=dict)


class Run(BaseModel):
    """Full run details including timeseries and label status."""
    run_id: str
    device_id: str
    start_ts: float
    end_ts: float
    label_status: LabelStatus
    timeseries: List[TimeSeriesPoint]


class LabelVote(BaseModel):
    """A label vote submission."""
    run_id: str
    model_type: str
    labeler: str
    label: int = Field(..., ge=0, le=2, description="0: class_a, 1: class_b, 2: invalid")
    notes: Optional[str] = None


class SampleRunsRequest(BaseModel):
    """Request to sample unlabeled runs."""
    device_id: str
    start_ts: float
    end_ts: float
    model_type: str
    sample_size: int = Field(default=50, ge=1, le=500)
    labeler: Optional[str] = Field(None, description="Labeler name - if provided, only excludes runs labeled by this labeler")
    unlabeled_only: bool = True


class SampleRunsResponse(BaseModel):
    """Response containing sampled runs."""
    runs: List[RunMetadata]
    global_y_max: Optional[float] = Field(None, description="Max Y value across all sampled runs' timeseries")


class DevicesResponse(BaseModel):
    """Response containing device list."""
    devices: List[str]


class DeviceMetadata(BaseModel):
    """Metadata for a device from Delta query."""
    device_id: str
    run_count: int
    run_ids: List[str]


class DeltaDevicesResponse(BaseModel):
    """Response from Delta device query."""
    devices: List[DeviceMetadata]
    total_devices: int
    total_runs: int
    query_date_start: float
    query_date_end: float


class LabelSubmitResponse(BaseModel):
    """Response after submitting a label."""
    success: bool
    already_labeled: bool = False
    message: Optional[str] = None


class RunsByIdsRequest(BaseModel):
    """Request to get runs by their IDs."""
    run_ids: List[str] = Field(..., description="List of run IDs to fetch")


class RunsByIdsResponse(BaseModel):
    """Response containing runs fetched by IDs."""
    runs: List[RunMetadata]
    global_y_max: Optional[float] = Field(None, description="Max Y value across fetched runs")


class User(BaseModel):
    """A labeler user."""
    user_id: int
    user_name: str


class UsersResponse(BaseModel):
    """Response containing list of users."""
    users: List[User]


class CreateUserRequest(BaseModel):
    """Request to create a new user."""
    user_name: str = Field(..., min_length=1, max_length=100)


class Model(BaseModel):
    """A model type."""
    model_id: int
    model_name: str


class ModelsResponse(BaseModel):
    """Response containing list of models."""
    models: List[Model]


class CreateModelRequest(BaseModel):
    """Request to create a new model."""
    model_name: str = Field(..., min_length=1, max_length=100)


# ============ Cluster/Session Models ============

class ClusterStatusResponse(BaseModel):
    """Spark cluster status."""
    status: str = Field(..., description="off, starting, or on")
    seconds_until_timeout: Optional[int] = Field(None, description="Seconds until auto-shutdown")


class SessionInfo(BaseModel):
    """Session save state info."""
    session_id: str
    name: str
    device_ids: List[str]
    date_range_start: float
    date_range_end: float
    model_type: str
    labeler: str
    total_runs: int
    labeled_count: int
    progress_percent: float = Field(..., description="0-100")
    progress_color: str = Field(..., description="red, yellow, or green")
    created_at: str
    updated_at: str


class SessionsListResponse(BaseModel):
    """List of saved sessions."""
    sessions: List[SessionInfo]
    max_sessions: int = 3


class NewSessionRequest(BaseModel):
    """Request to create a new labeling session."""
    device_ids: List[str] = Field(..., max_length=50)
    date_range_start: float
    date_range_end: float
    model_type: str
    labeler: str
    sample_size: int = Field(default=100, ge=1, le=100, description="Runs per device")


class NewSessionResponse(BaseModel):
    """Response after creating a session."""
    success: bool
    session_id: Optional[str] = None
    message: Optional[str] = None
    runs_loaded: int = 0


class SessionProgressResponse(BaseModel):
    """Current session progress."""
    session_id: str
    total_runs: int
    labeled_count: int
    progress_percent: float
    progress_color: str
    at_80_percent: bool = Field(..., description="True if at or above 80% - trigger cluster start")


class PushSessionResponse(BaseModel):
    """Response after pushing session labels."""
    success: bool
    labels_pushed: int = 0
    message: Optional[str] = None


