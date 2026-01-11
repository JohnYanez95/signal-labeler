"""Tests for SQLite repository implementations."""
import uuid
import pytest

from app.models import LabelVote
from backends.sqlite import (
    SQLiteRunsRepository,
    SQLiteLabelsRepository,
    SQLiteUsersRepository,
    SQLiteModelsRepository,
    SQLiteSessionsRepository,
)
from backends.sqlite.connection import get_db_connection


class TestSQLiteLabelsRepository:
    """Test label repository operations."""

    @pytest.fixture
    def repo(self):
        return SQLiteLabelsRepository()

    def test_is_labeled_false_initially(self, repo, sample_run, sample_model):
        """is_labeled returns False for unlabeled run."""
        result = repo.is_labeled(sample_run, sample_model)
        assert result is False

    def test_upsert_vote_creates_label(self, repo, sample_run, sample_model, sample_user):
        """upsert_vote creates a new label."""
        vote = LabelVote(
            run_id=sample_run,
            model_type=sample_model,
            labeler=sample_user,
            label=0,
        )
        repo.upsert_vote(vote)

        result = repo.is_labeled(sample_run, sample_model)
        assert result is True

    def test_upsert_vote_updates_existing(self, repo, sample_run, sample_model, sample_user):
        """upsert_vote updates existing label."""
        vote1 = LabelVote(run_id=sample_run, model_type=sample_model, labeler=sample_user, label=0)
        vote2 = LabelVote(run_id=sample_run, model_type=sample_model, labeler=sample_user, label=1)

        repo.upsert_vote(vote1)
        repo.upsert_vote(vote2)

        status = repo.get_status(sample_run, sample_model)
        assert status.n_votes == 1
        assert status.counts.get(1) == 1
        assert status.counts.get(0, 0) == 0

    def test_get_status_counts_votes(self, repo, sample_run, sample_model):
        """get_status returns correct vote counts."""
        # Add multiple labelers
        for labeler, label in [("user_a", 0), ("user_b", 0), ("user_c", 1)]:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT OR IGNORE INTO users (user_name) VALUES (?)", (labeler,))
                conn.commit()

            vote = LabelVote(run_id=sample_run, model_type=sample_model, labeler=labeler, label=label)
            repo.upsert_vote(vote)

        status = repo.get_status(sample_run, sample_model)
        assert status.is_labeled is True
        assert status.n_votes == 3
        assert status.counts[0] == 2
        assert status.counts[1] == 1

    def test_get_labeled_run_ids(self, repo, sample_run, sample_model, sample_user):
        """get_labeled_run_ids returns labeled run IDs."""
        # Initially empty
        result = repo.get_labeled_run_ids(sample_model, sample_user)
        assert sample_run not in result

        # After labeling
        vote = LabelVote(run_id=sample_run, model_type=sample_model, labeler=sample_user, label=0)
        repo.upsert_vote(vote)
        result = repo.get_labeled_run_ids(sample_model, sample_user)
        assert sample_run in result


class TestSQLiteRunsRepository:
    """Test runs repository operations."""

    @pytest.fixture
    def repo(self):
        return SQLiteRunsRepository()

    def test_list_devices(self, repo, sample_run, sample_device):
        """list_devices returns devices with runs in time range."""
        # list_devices queries rle_runs table, so we need a run to exist
        devices = repo.list_devices(
            start_ts=0,
            end_ts=9999999999,
        )
        assert sample_device in devices

    def test_get_run(self, repo, sample_run):
        """get_run returns run metadata."""
        run = repo.get_run(sample_run)
        assert run is not None
        assert run.run_id == sample_run
        assert run.run_length == 60

    def test_get_run_not_found(self, repo, clean_db):
        """get_run raises ValueError for missing run."""
        with pytest.raises(ValueError, match="Run not found"):
            repo.get_run("nonexistent")

    def test_get_timeseries(self, repo, sample_run):
        """get_timeseries returns timeseries data."""
        timeseries = repo.get_timeseries(sample_run)
        assert len(timeseries) == 10
        assert all(hasattr(p, 'ts') and hasattr(p, 'value') for p in timeseries)

    def test_get_runs_by_ids(self, repo, sample_run):
        """get_runs_by_ids returns runs in order."""
        runs = repo.get_runs_by_ids([sample_run])
        assert len(runs) == 1
        assert runs[0].run_id == sample_run

    def test_get_runs_by_ids_preserves_order(self, repo, sample_device):
        """get_runs_by_ids preserves requested order."""
        # Create multiple runs
        run_ids = ["run_z", "run_a", "run_m"]
        with get_db_connection() as conn:
            cursor = conn.cursor()
            for i, run_id in enumerate(run_ids):
                cursor.execute("""
                    INSERT INTO rle_runs (run_id, device_id, start_ts, end_ts, run_length)
                    VALUES (?, ?, ?, ?, 10)
                """, (run_id, sample_device, 1704067200.0 + i * 100, 1704067210.0 + i * 100))
            conn.commit()

        # Request in specific order
        requested = ["run_m", "run_z", "run_a"]
        runs = repo.get_runs_by_ids(requested)
        result_ids = [r.run_id for r in runs]
        assert result_ids == requested


class TestSQLiteUsersRepository:
    """Test users repository operations."""

    @pytest.fixture
    def repo(self):
        return SQLiteUsersRepository()

    def test_list_users(self, repo, sample_user):
        """list_users returns all users."""
        users = repo.list_users()
        user_names = [u.user_name for u in users]
        assert sample_user in user_names

    def test_create_user(self, repo, clean_db):
        """create_user creates new user."""
        user = repo.create_user("new_user")
        assert user.user_name == "new_user"
        assert user.user_id is not None

    def test_get_user_by_name(self, repo, sample_user):
        """get_user_by_name returns user."""
        user = repo.get_user_by_name(sample_user)
        assert user is not None
        assert user.user_name == sample_user

    def test_get_user_by_name_not_found(self, repo, clean_db):
        """get_user_by_name returns None for missing user."""
        user = repo.get_user_by_name("nonexistent")
        assert user is None


class TestSQLiteModelsRepository:
    """Test models repository operations."""

    @pytest.fixture
    def repo(self):
        return SQLiteModelsRepository()

    def test_list_models_includes_default(self, repo):
        """list_models includes default model."""
        models = repo.list_models()
        model_names = [m.model_name for m in models]
        assert "classification_v1" in model_names

    def test_create_model(self, repo, clean_db):
        """create_model creates new model."""
        model = repo.create_model("test_model_v1")
        assert model.model_name == "test_model_v1"
        assert model.model_id is not None

    def test_get_model_by_name(self, repo):
        """get_model_by_name returns model."""
        model = repo.get_model_by_name("classification_v1")
        assert model is not None
        assert model.model_name == "classification_v1"


class TestSQLiteSessionsRepository:
    """Test sessions repository operations."""

    @pytest.fixture
    def repo(self):
        return SQLiteSessionsRepository()

    def test_list_sessions_empty(self, repo, clean_db):
        """list_sessions returns empty list initially."""
        sessions = repo.list_sessions()
        assert sessions == []

    def test_create_session(self, repo, clean_db):
        """create_session creates new session."""
        session_id = str(uuid.uuid4())
        repo.create_session(
            session_id=session_id,
            name="Test Session",
            device_ids=["device_1", "device_2"],
            date_range_start=1704067200.0,
            date_range_end=1704153600.0,
            model_type="classification_v1",
            labeler="test_user",
        )

        sessions = repo.list_sessions()
        assert len(sessions) == 1
        assert sessions[0]["session_id"] == session_id

    def test_get_session(self, repo, clean_db):
        """get_session returns session details."""
        session_id = str(uuid.uuid4())
        repo.create_session(
            session_id=session_id,
            name="Test Session",
            device_ids=["device_1"],
            date_range_start=1704067200.0,
            date_range_end=1704153600.0,
            model_type="classification_v1",
            labeler="test_user",
        )

        session = repo.get_session(session_id)
        assert session is not None
        assert session["session_id"] == session_id
        assert "device_1" in session["device_ids"]

    def test_delete_session(self, repo, clean_db):
        """delete_session removes session."""
        session_id = str(uuid.uuid4())
        repo.create_session(
            session_id=session_id,
            name="Test Session",
            device_ids=["device_1"],
            date_range_start=1704067200.0,
            date_range_end=1704153600.0,
            model_type="classification_v1",
            labeler="test_user",
        )

        result = repo.delete_session(session_id)
        assert result is True

        session = repo.get_session(session_id)
        assert session is None
