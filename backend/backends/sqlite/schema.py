"""SQLite database schema initialization."""
from backends.sqlite.connection import get_db_connection


def init_database() -> None:
    """Initialize the SQLite database schema."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Table: devices
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                first_seen REAL NOT NULL,
                last_seen REAL NOT NULL,
                run_count INTEGER DEFAULT 0
            )
        """)

        # Table: rle_runs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rle_runs (
                run_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                start_ts REAL NOT NULL,
                end_ts REAL NOT NULL,
                run_length INTEGER NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(device_id, start_ts)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_device_ts
            ON rle_runs(device_id, start_ts)
        """)

        # Table: timeseries_data
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS timeseries_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                ts REAL NOT NULL,
                value REAL NOT NULL,
                FOREIGN KEY (run_id) REFERENCES rle_runs(run_id)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_ts_run
            ON timeseries_data(run_id, ts)
        """)

        # Table: labels_votes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS labels_votes (
                run_id TEXT NOT NULL,
                model_type TEXT NOT NULL,
                labeler TEXT NOT NULL,
                label INTEGER NOT NULL,
                labeled_at TEXT DEFAULT CURRENT_TIMESTAMP,
                notes TEXT,
                PRIMARY KEY (run_id, model_type, labeler),
                FOREIGN KEY (run_id) REFERENCES rle_runs(run_id)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_labels_run_model
            ON labels_votes(run_id, model_type)
        """)

        # Table: sync_metadata (for tracking sync state)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: Add synced_at column to labels_votes if missing
        cursor.execute("PRAGMA table_info(labels_votes)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'synced_at' not in columns:
            cursor.execute("""
                ALTER TABLE labels_votes ADD COLUMN synced_at TEXT DEFAULT NULL
            """)
            print("  Migrated labels_votes: added synced_at column")

        # Table: sessions (save states, max 3)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                name TEXT,
                device_ids TEXT,
                date_range_start REAL,
                date_range_end REAL,
                model_type TEXT,
                labeler TEXT,
                total_runs INTEGER DEFAULT 0,
                labeled_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Table: session_runs (runs cached per session)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS session_runs (
                session_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                device_id TEXT,
                start_ts REAL,
                end_ts REAL,
                PRIMARY KEY (session_id, run_id),
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_session_runs_session
            ON session_runs(session_id)
        """)

        # Table: session_timeseries (timeseries cached per session)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS session_timeseries (
                session_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                ts REAL NOT NULL,
                value REAL NOT NULL,
                PRIMARY KEY (session_id, run_id, ts),
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_session_ts_run
            ON session_timeseries(session_id, run_id)
        """)

        # Table: users (labelers)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Table: models (model types)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS models (
                model_id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Insert default model if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO models (model_name) VALUES ('classification_v1')
        """)

        conn.commit()
        print("Database schema initialized (SQLite)")


if __name__ == "__main__":
    init_database()
