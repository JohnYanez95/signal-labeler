"""Query sync status between SQLite and Delta."""
from datetime import datetime
from typing import Optional

from delta import DeltaTable

from sync.spark_session import get_spark_session
from sync.delta_schema import get_table_path
from backends.sqlite.connection import get_db_connection
from sync.models import SyncStatus


def get_status() -> SyncStatus:
    """
    Get current sync status.

    Returns:
        SyncStatus with counts and timestamps
    """
    spark = get_spark_session()

    # SQLite counts
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM rle_runs")
        sqlite_runs = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM labels_votes")
        sqlite_labels = cursor.fetchone()[0]

        cursor.execute("""
            SELECT COUNT(*) FROM labels_votes
            WHERE synced_at IS NULL OR labeled_at > synced_at
        """)
        unpushed_labels = cursor.fetchone()[0]

        cursor.execute("SELECT value FROM sync_metadata WHERE key = 'last_pull_at'")
        row = cursor.fetchone()
        last_pull = datetime.fromisoformat(row[0]) if row else None

        cursor.execute("SELECT value FROM sync_metadata WHERE key = 'last_push_at'")
        row = cursor.fetchone()
        last_push = datetime.fromisoformat(row[0]) if row else None

    # Delta counts
    try:
        runs_path = get_table_path("rle_runs")
        labels_path = get_table_path("labels_votes")

        if DeltaTable.isDeltaTable(spark, runs_path):
            delta_runs = spark.read.format("delta").load(runs_path).count()
        else:
            delta_runs = 0

        if DeltaTable.isDeltaTable(spark, labels_path):
            delta_labels = spark.read.format("delta").load(labels_path).count()
        else:
            delta_labels = 0
    except Exception:
        delta_runs = 0
        delta_labels = 0

    return SyncStatus(
        last_pull_at=last_pull,
        last_push_at=last_push,
        unpushed_labels_count=unpushed_labels,
        sqlite_runs_count=sqlite_runs,
        sqlite_labels_count=sqlite_labels,
        delta_runs_count=delta_runs,
        delta_labels_count=delta_labels
    )


def print_status():
    """Print human-readable status."""
    status = get_status()

    print("=" * 50)
    print("SYNC STATUS")
    print("=" * 50)
    print()
    print("Last Sync Times:")
    print(f"  Pull (Delta -> SQLite): {status.last_pull_at or 'Never'}")
    print(f"  Push (SQLite -> Delta): {status.last_push_at or 'Never'}")
    print()
    print("Record Counts:")
    print(f"  SQLite runs:   {status.sqlite_runs_count:,}")
    print(f"  Delta runs:    {status.delta_runs_count:,}")
    print(f"  SQLite labels: {status.sqlite_labels_count:,}")
    print(f"  Delta labels:  {status.delta_labels_count:,}")
    print()
    print("Pending:")
    print(f"  Unpushed labels: {status.unpushed_labels_count:,}")
    print("=" * 50)
