"""SQLite database connection management."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

# Use DATABASE_PATH env var if set, otherwise default to project root
_default_path = Path(__file__).parent.parent.parent / "labeler.db"
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", str(_default_path)))

# Ensure parent directory exists
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_db_path() -> Path:
    """Get the database file path."""
    return DATABASE_PATH


@contextmanager
def get_db_connection() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections."""
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
