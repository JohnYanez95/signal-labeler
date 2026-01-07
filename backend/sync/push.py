"""Push labels from SQLite to Delta tables."""
import time
from datetime import datetime
from typing import List, Optional

from delta import DeltaTable

from sync.cluster import cluster_manager
from sync.delta_schema import get_table_path, LABELS_VOTES_SCHEMA
from backends.sqlite.connection import get_db_connection
from sync.models import PushResult


def push(session_run_ids: Optional[List[str]] = None) -> PushResult:
    """
    Push unpushed labels from SQLite to Delta.

    Uses Delta MERGE for upsert with composite key (run_id, model_type, labeler).

    Args:
        session_run_ids: If provided, only push labels for these run IDs (session-aware push)

    Returns:
        PushResult with sync statistics
    """
    start_time = time.time()
    spark = cluster_manager.ensure_running()

    # Get unpushed labels from SQLite (optionally filtered by session)
    unpushed_labels = _get_unpushed_labels(session_run_ids)

    if not unpushed_labels:
        return PushResult(
            labels_pushed=0,
            duration_seconds=time.time() - start_time,
            merge_conflicts=0
        )

    # Convert to Spark DataFrame
    # Tuple order: run_id, model_type, labeler, label, labeled_at, notes
    labels_data = [
        (
            row['run_id'],
            row['model_type'],
            row['labeler'],
            row['label'],
            datetime.fromisoformat(row['labeled_at']) if row['labeled_at'] else datetime.now(),
            row['notes']
        )
        for row in unpushed_labels
    ]

    labels_df = spark.createDataFrame(labels_data, schema=LABELS_VOTES_SCHEMA)

    # MERGE into Delta table
    table_path = get_table_path("labels_votes")

    merge_condition = """
        t.run_id = s.run_id AND
        t.model_type = s.model_type AND
        t.labeler = s.labeler
    """

    if DeltaTable.isDeltaTable(spark, table_path):
        target = DeltaTable.forPath(spark, table_path)

        # Perform merge
        (
            target.alias("t")
            .merge(labels_df.alias("s"), merge_condition)
            .whenMatchedUpdate(set={
                "label": "s.label",
                "labeled_at": "s.labeled_at",
                "notes": "s.notes"
            })
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        # Table doesn't exist yet, just write
        labels_df.write.format("delta").mode("append").save(table_path)

    # Mark as synced in SQLite
    synced_keys = [(row['run_id'], row['model_type'], row['labeler']) for row in unpushed_labels]
    _mark_labels_synced(synced_keys)

    # Update sync metadata
    _set_sync_metadata("last_push_at", datetime.now().isoformat())

    duration = time.time() - start_time
    return PushResult(
        labels_pushed=len(unpushed_labels),
        duration_seconds=duration,
        merge_conflicts=0
    )


def _get_unpushed_labels(run_ids: Optional[List[str]] = None) -> List[dict]:
    """Get labels that haven't been pushed to Delta yet.

    Args:
        run_ids: If provided, only get labels for these run IDs
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        if run_ids:
            placeholders = ','.join('?' * len(run_ids))
            cursor.execute(f"""
                SELECT run_id, model_type, labeler, label, labeled_at, notes
                FROM labels_votes
                WHERE (synced_at IS NULL OR labeled_at > synced_at)
                  AND run_id IN ({placeholders})
            """, run_ids)  # nosec B608 - placeholders are ? chars, params passed separately
        else:
            cursor.execute("""
                SELECT run_id, model_type, labeler, label, labeled_at, notes
                FROM labels_votes
                WHERE synced_at IS NULL
                   OR labeled_at > synced_at
            """)

        columns = ['run_id', 'model_type', 'labeler', 'label', 'labeled_at', 'notes']
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _mark_labels_synced(keys: List[tuple]):
    """Mark labels as synced after successful push."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        for run_id, model_type, labeler in keys:
            cursor.execute("""
                UPDATE labels_votes
                SET synced_at = CURRENT_TIMESTAMP
                WHERE run_id = ? AND model_type = ? AND labeler = ?
            """, (run_id, model_type, labeler))
        conn.commit()


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
