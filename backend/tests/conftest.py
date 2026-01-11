"""Pytest fixtures for backend tests."""
import os
import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import patch, MagicMock

import pytest

# Set test database path BEFORE importing app modules
_test_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_PATH"] = _test_db.name


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Initialize test database once per session."""
    # Import after setting DATABASE_PATH
    from backends.sqlite.schema import init_database
    init_database()
    yield
    # Cleanup after all tests
    Path(_test_db.name).unlink(missing_ok=True)


@pytest.fixture
def client() -> Generator:
    """FastAPI test client with mocked cluster manager."""
    from starlette.testclient import TestClient

    # Mock the cluster manager to avoid Spark initialization
    with patch('app.main.cluster_manager') as mock_cluster:
        mock_cluster.status = MagicMock()
        mock_cluster.status.value = 'off'
        mock_cluster.seconds_until_timeout = MagicMock(return_value=None)

        from app.main import app
        # Use TestClient without context manager for newer versions
        c = TestClient(app, raise_server_exceptions=True)
        yield c


@pytest.fixture
def clean_db():
    """Clean database tables between tests."""
    from backends.sqlite.connection import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Clear in dependency order
        cursor.execute("DELETE FROM session_timeseries")
        cursor.execute("DELETE FROM session_runs")
        cursor.execute("DELETE FROM sessions")
        cursor.execute("DELETE FROM labels_votes")
        cursor.execute("DELETE FROM timeseries_data")
        cursor.execute("DELETE FROM rle_runs")
        cursor.execute("DELETE FROM devices")
        conn.commit()
    yield


@pytest.fixture
def sample_device(clean_db) -> str:
    """Create a sample device and return its ID."""
    from backends.sqlite.connection import get_db_connection

    device_id = "test_device_001"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO devices (device_id, first_seen, last_seen, run_count)
            VALUES (?, 1704067200.0, 1704153600.0, 1)
        """, (device_id,))
        conn.commit()
    return device_id


@pytest.fixture
def sample_run(sample_device) -> str:
    """Create a sample run and return its ID."""
    from backends.sqlite.connection import get_db_connection

    run_id = "test_run_001"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO rle_runs (run_id, device_id, start_ts, end_ts, run_length)
            VALUES (?, ?, 1704067200.0, 1704067260.0, 60)
        """, (run_id, sample_device))

        # Add some timeseries data
        for i in range(10):
            ts = 1704067200.0 + i * 6
            value = 50.0 + i * 2
            cursor.execute("""
                INSERT INTO timeseries_data (run_id, ts, value)
                VALUES (?, ?, ?)
            """, (run_id, ts, value))

        conn.commit()
    return run_id


@pytest.fixture
def sample_user() -> str:
    """Create a sample user and return their name."""
    from backends.sqlite.connection import get_db_connection

    user_name = "test_labeler"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO users (user_name) VALUES (?)
        """, (user_name,))
        conn.commit()
    return user_name


@pytest.fixture
def sample_model() -> str:
    """Return the default model type."""
    return "classification_v1"
