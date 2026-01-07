"""Models for sync operations."""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class SyncStatus:
    """Current sync status."""

    last_pull_at: Optional[datetime]
    last_push_at: Optional[datetime]
    unpushed_labels_count: int
    sqlite_runs_count: int
    sqlite_labels_count: int
    delta_runs_count: int
    delta_labels_count: int


@dataclass
class PullResult:
    """Result of a pull operation."""

    devices_synced: int
    runs_synced: int
    timeseries_points_synced: int
    duration_seconds: float
    is_incremental: bool


@dataclass
class PushResult:
    """Result of a push operation."""

    labels_pushed: int
    duration_seconds: float
    merge_conflicts: int
