"""
Abstract repository interfaces for data access.
These interfaces allow easy swapping between SQLite and Spark backends.
"""
from abc import ABC, abstractmethod
from typing import List

from app.models import RunMetadata, LabelVote, LabelStatus, TimeSeriesPoint, User, Model


class RunsRepository(ABC):
    """Interface for accessing RLE runs and timeseries data."""

    @abstractmethod
    def list_devices(
        self,
        start_ts: float,
        end_ts: float,
        model_type: str | None = None,
        labeler: str | None = None
    ) -> List[str]:
        """
        Get list of device IDs in the specified time range.

        Args:
            start_ts: Start timestamp (unix)
            end_ts: End timestamp (unix)
            model_type: Model type for filtering (optional)
            labeler: Labeler name for filtering (optional)

        Returns:
            List of device IDs
        """
        pass

    @abstractmethod
    def sample_runs(
        self,
        device_id: str,
        start_ts: float,
        end_ts: float,
        model_type: str,
        sample_size: int,
        labeler: str | None = None,
        unlabeled_only: bool = True
    ) -> List[RunMetadata]:
        """
        Sample RLE runs for labeling.

        Args:
            device_id: Device to filter by
            start_ts: Start timestamp
            end_ts: End timestamp
            model_type: Model type for label filtering
            sample_size: Maximum number of runs to return
            labeler: Labeler name for filtering (optional)
            unlabeled_only: If True, only return runs with no labels

        Returns:
            List of run metadata
        """
        pass

    @abstractmethod
    def get_run(self, run_id: str) -> RunMetadata:
        """
        Get metadata for a specific run.

        Args:
            run_id: Run identifier

        Returns:
            Run metadata
        """
        pass

    @abstractmethod
    def get_timeseries(self, run_id: str) -> List[TimeSeriesPoint]:
        """
        Get time-series data points for a run.

        Args:
            run_id: Run identifier

        Returns:
            List of time-series points
        """
        pass

    @abstractmethod
    def get_max_value_for_runs(self, run_ids: List[str]) -> float | None:
        """
        Get the maximum timeseries value across all specified runs.

        Args:
            run_ids: List of run identifiers

        Returns:
            Maximum value or None if no runs
        """
        pass

    @abstractmethod
    def get_runs_by_ids(self, run_ids: List[str]) -> List[RunMetadata]:
        """
        Get metadata for multiple runs by their IDs, preserving order.

        Args:
            run_ids: List of run identifiers

        Returns:
            List of run metadata in same order as input
        """
        pass


class LabelsRepository(ABC):
    """Interface for accessing and managing labels."""

    @abstractmethod
    def is_labeled(self, run_id: str, model_type: str) -> bool:
        """
        Check if a run has been labeled by anyone for the given model type.

        Args:
            run_id: Run identifier
            model_type: Model type

        Returns:
            True if labeled by anyone, False otherwise
        """
        pass

    @abstractmethod
    def upsert_vote(self, vote: LabelVote) -> None:
        """
        Insert or update a label vote.

        Args:
            vote: Label vote to insert/update
        """
        pass

    @abstractmethod
    def get_status(self, run_id: str, model_type: str) -> LabelStatus:
        """
        Get label status (vote counts, etc.) for a run.

        Args:
            run_id: Run identifier
            model_type: Model type

        Returns:
            Label status with vote counts
        """
        pass

    @abstractmethod
    def get_labeled_run_ids(self, model_type: str, labeler: str) -> List[str]:
        """
        Get all run IDs that have been labeled by this labeler for this model type.

        Args:
            model_type: Model type
            labeler: Labeler username

        Returns:
            List of run IDs
        """
        pass


class UsersRepository(ABC):
    """Interface for managing users/labelers."""

    @abstractmethod
    def list_users(self) -> List[User]:
        """Get all users."""
        pass

    @abstractmethod
    def get_user_by_name(self, user_name: str) -> User | None:
        """Get a user by name."""
        pass

    @abstractmethod
    def create_user(self, user_name: str) -> User:
        """Create a new user."""
        pass

    @abstractmethod
    def get_or_create_user(self, user_name: str) -> User:
        """Get existing user or create if not exists."""
        pass


class ModelsRepository(ABC):
    """Interface for managing model types."""

    @abstractmethod
    def list_models(self) -> List[Model]:
        """Get all models."""
        pass

    @abstractmethod
    def get_model_by_name(self, model_name: str) -> Model | None:
        """Get a model by name."""
        pass

    @abstractmethod
    def create_model(self, model_name: str) -> Model:
        """Create a new model."""
        pass

    @abstractmethod
    def get_or_create_model(self, model_name: str) -> Model:
        """Get existing model or create if not exists."""
        pass


class SessionsRepository(ABC):
    """Interface for managing labeling sessions."""

    @abstractmethod
    def list_sessions(self) -> List[dict]:
        """Get all sessions (max 3)."""
        pass

    @abstractmethod
    def get_session(self, session_id: str) -> dict | None:
        """Get a session by ID."""
        pass

    @abstractmethod
    def create_session(
        self,
        session_id: str,
        name: str,
        device_ids: List[str],
        date_range_start: float,
        date_range_end: float,
        model_type: str,
        labeler: str,
    ) -> dict:
        """Create a new session."""
        pass

    @abstractmethod
    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its cached data."""
        pass

    @abstractmethod
    def update_session_progress(self, session_id: str, labeled_count: int) -> None:
        """Update the labeled count for a session."""
        pass

    @abstractmethod
    def add_session_runs(
        self,
        session_id: str,
        runs: List[dict],
    ) -> int:
        """Add runs to a session's cache. Returns count added."""
        pass

    @abstractmethod
    def add_session_timeseries(
        self,
        session_id: str,
        run_id: str,
        timeseries: List[dict],
    ) -> int:
        """Add timeseries data for a run in a session. Returns count added."""
        pass

    @abstractmethod
    def get_session_runs(self, session_id: str) -> List[dict]:
        """Get all cached runs for a session."""
        pass

    @abstractmethod
    def get_session_timeseries(self, session_id: str, run_id: str) -> List[dict]:
        """Get cached timeseries for a run in a session."""
        pass

    @abstractmethod
    def count_sessions(self) -> int:
        """Count total sessions."""
        pass

    @abstractmethod
    def get_session_max_value(self, session_id: str) -> float | None:
        """Get the maximum Y value across all timeseries in a session."""
        pass
