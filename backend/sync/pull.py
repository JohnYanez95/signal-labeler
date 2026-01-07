"""Pull data from Delta tables to SQLite."""
import time
from datetime import datetime
from typing import List, Optional

from pyspark.sql import functions as F

from sync.cluster import cluster_manager
from sync.delta_schema import get_table_path
from backends.sqlite.connection import get_db_connection
from backends.sqlite.schema import init_database
from sync.models import PullResult
from sync.config import sync_settings


def pull(
    device_ids: Optional[List[str]] = None,
    start_ts: Optional[float] = None,
    end_ts: Optional[float] = None,
    full_refresh: bool = False
) -> PullResult:
    """
    Pull runs and timeseries from Delta to SQLite.

    Args:
        device_ids: Filter to specific devices (None = all)
        start_ts: Start timestamp filter
        end_ts: End timestamp filter
        full_refresh: If True, clear SQLite before pulling

    Returns:
        PullResult with sync statistics
    """
    start_time = time.time()
    spark = cluster_manager.ensure_running()

    # Initialize SQLite if needed
    init_database()

    # Get last pull timestamp for incremental sync
    last_pull_ts = None if full_refresh else _get_last_pull_timestamp()

    if full_refresh:
        _clear_sqlite_data()

    # Read Delta tables
    runs_df = spark.read.format("delta").load(get_table_path("rle_runs"))
    ts_df = spark.read.format("delta").load(get_table_path("timeseries_data"))
    devices_df = spark.read.format("delta").load(get_table_path("devices"))

    # Apply filters
    if device_ids:
        runs_df = runs_df.filter(F.col("device_id").isin(device_ids))
        devices_df = devices_df.filter(F.col("device_id").isin(device_ids))

    if start_ts:
        runs_df = runs_df.filter(F.col("start_ts") >= start_ts)

    if end_ts:
        runs_df = runs_df.filter(F.col("end_ts") <= end_ts)

    if last_pull_ts and not full_refresh:
        # Incremental: only runs created after last pull
        runs_df = runs_df.filter(F.col("created_at") > last_pull_ts)

    # Get run_ids for timeseries filtering
    run_ids_df = runs_df.select("run_id")
    ts_df = ts_df.join(run_ids_df, "run_id")

    # Collect to driver
    devices_rows = devices_df.collect()
    runs_rows = runs_df.collect()

    # Insert into SQLite in batches
    devices_synced = _upsert_devices(devices_rows)
    runs_synced = _upsert_runs(runs_rows)
    ts_synced = _insert_timeseries_batched(ts_df)

    # Update sync metadata
    _set_sync_metadata("last_pull_at", datetime.now().isoformat())

    duration = time.time() - start_time
    return PullResult(
        devices_synced=devices_synced,
        runs_synced=runs_synced,
        timeseries_points_synced=ts_synced,
        duration_seconds=duration,
        is_incremental=not full_refresh
    )


def _upsert_devices(rows) -> int:
    """Upsert devices into SQLite."""
    if not rows:
        return 0

    with get_db_connection() as conn:
        cursor = conn.cursor()
        for row in rows:
            cursor.execute("""
                INSERT INTO devices (device_id, first_seen, last_seen, run_count)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    first_seen = MIN(devices.first_seen, excluded.first_seen),
                    last_seen = MAX(devices.last_seen, excluded.last_seen),
                    run_count = excluded.run_count
            """, (row.device_id, row.first_seen, row.last_seen, row.run_count))
        conn.commit()
    return len(rows)


def _upsert_runs(rows) -> int:
    """Upsert runs into SQLite."""
    if not rows:
        return 0

    with get_db_connection() as conn:
        cursor = conn.cursor()
        for row in rows:
            cursor.execute("""
                INSERT INTO rle_runs (run_id, device_id, start_ts, end_ts, run_length, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    device_id = excluded.device_id,
                    start_ts = excluded.start_ts,
                    end_ts = excluded.end_ts,
                    run_length = excluded.run_length
            """, (row.run_id, row.device_id, row.start_ts, row.end_ts,
                  row.run_length, str(row.created_at) if row.created_at else None))
        conn.commit()
    return len(rows)


def _insert_timeseries_batched(ts_df) -> int:
    """Insert timeseries in batches to handle large datasets."""
    batch_size = sync_settings.pull_batch_size
    rows = ts_df.collect()

    if not rows:
        return 0

    total = 0
    with get_db_connection() as conn:
        cursor = conn.cursor()

        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            cursor.executemany("""
                INSERT OR REPLACE INTO timeseries_data (id, run_id, ts, value)
                VALUES (?, ?, ?, ?)
            """, [(r.id, r.run_id, r.ts, r.value) for r in batch])
            total += len(batch)

            if (i + batch_size) % 50000 == 0:
                print(f"    Inserted {total:,} timeseries points...")

        conn.commit()

    return total


def _clear_sqlite_data():
    """Clear run-related data from SQLite (preserve labels)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM timeseries_data")
        cursor.execute("DELETE FROM rle_runs")
        cursor.execute("DELETE FROM devices")
        conn.commit()
        print("  Cleared existing data from SQLite")


def _get_last_pull_timestamp() -> Optional[datetime]:
    """Get the last pull timestamp from metadata."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM sync_metadata WHERE key = 'last_pull_at'")
        row = cursor.fetchone()
        if row:
            return datetime.fromisoformat(row[0])
        return None


def _set_sync_metadata(key: str, value: str):
    """Set a sync metadata value."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sync_metadata (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        """, (key, value))
        conn.commit()
