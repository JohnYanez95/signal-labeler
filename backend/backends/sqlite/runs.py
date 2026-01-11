"""SQLite implementation of RunsRepository."""
from typing import List

from app.models import RunMetadata, TimeSeriesPoint
from app.repositories.base import RunsRepository
from backends.sqlite.connection import get_db_connection


class SQLiteRunsRepository(RunsRepository):
    """SQLite implementation of runs repository."""

    def list_devices(
        self,
        start_ts: float,
        end_ts: float,
        model_type: str | None = None,
        labeler: str | None = None
    ) -> List[str]:
        """Get list of device IDs in the specified time range."""
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if model_type and labeler:
                cursor.execute("""
                    SELECT DISTINCT r.device_id
                    FROM rle_runs r
                    LEFT JOIN (
                        SELECT DISTINCT run_id
                        FROM labels_votes
                        WHERE model_type = ? AND labeler = ?
                    ) lv ON r.run_id = lv.run_id
                    WHERE r.start_ts >= ? AND r.end_ts <= ?
                      AND lv.run_id IS NULL
                    ORDER BY r.device_id
                """, (model_type, labeler, start_ts, end_ts))
            else:
                cursor.execute("""
                    SELECT DISTINCT device_id
                    FROM rle_runs
                    WHERE start_ts >= ? AND end_ts <= ?
                    ORDER BY device_id
                """, (start_ts, end_ts))

            return [row[0] for row in cursor.fetchall()]

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
        """Sample RLE runs for labeling."""
        with get_db_connection() as conn:
            cursor = conn.cursor()

            if unlabeled_only:
                if labeler:
                    query = """
                        SELECT r.run_id, r.device_id, r.start_ts, r.end_ts, r.run_length
                        FROM rle_runs r
                        LEFT JOIN (
                            SELECT DISTINCT run_id
                            FROM labels_votes
                            WHERE model_type = ? AND labeler = ?
                        ) lv ON r.run_id = lv.run_id
                        WHERE r.device_id = ?
                          AND r.start_ts >= ?
                          AND r.end_ts <= ?
                          AND lv.run_id IS NULL
                        ORDER BY r.start_ts
                        LIMIT ?
                    """
                    params = (model_type, labeler, device_id, start_ts, end_ts, sample_size)
                else:
                    query = """
                        SELECT r.run_id, r.device_id, r.start_ts, r.end_ts, r.run_length
                        FROM rle_runs r
                        LEFT JOIN (
                            SELECT DISTINCT run_id
                            FROM labels_votes
                            WHERE model_type = ?
                        ) lv ON r.run_id = lv.run_id
                        WHERE r.device_id = ?
                          AND r.start_ts >= ?
                          AND r.end_ts <= ?
                          AND lv.run_id IS NULL
                        ORDER BY r.start_ts
                        LIMIT ?
                    """
                    params = (model_type, device_id, start_ts, end_ts, sample_size)
            else:
                query = """
                    SELECT run_id, device_id, start_ts, end_ts, run_length
                    FROM rle_runs
                    WHERE device_id = ?
                      AND start_ts >= ?
                      AND end_ts <= ?
                    ORDER BY start_ts
                    LIMIT ?
                """
                params = (device_id, start_ts, end_ts, sample_size)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [
                RunMetadata(
                    run_id=row[0],
                    device_id=row[1],
                    start_ts=row[2],
                    end_ts=row[3],
                    run_length=row[4],
                    is_labeled=False
                )
                for row in rows
            ]

    def get_run(self, run_id: str) -> RunMetadata:
        """Get metadata for a specific run."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT run_id, device_id, start_ts, end_ts, run_length
                FROM rle_runs
                WHERE run_id = ?
            """, (run_id,))

            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Run not found: {run_id}")

            return RunMetadata(
                run_id=row[0],
                device_id=row[1],
                start_ts=row[2],
                end_ts=row[3],
                run_length=row[4]
            )

    def get_timeseries(self, run_id: str) -> List[TimeSeriesPoint]:
        """Get time-series data points for a run."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ts, value
                FROM timeseries_data
                WHERE run_id = ?
                ORDER BY ts
            """, (run_id,))

            return [
                TimeSeriesPoint(ts=row[0], value=row[1])
                for row in cursor.fetchall()
            ]

    def get_max_value_for_runs(self, run_ids: List[str]) -> float | None:
        """Get the maximum timeseries value across all specified runs."""
        if not run_ids:
            return None

        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(run_ids))
            cursor.execute(f"""
                SELECT MAX(value)
                FROM timeseries_data
                WHERE run_id IN ({placeholders})
            """, run_ids)  # nosec B608 - placeholders are ? chars, params passed separately

            row = cursor.fetchone()
            return row[0] if row and row[0] is not None else None

    def get_runs_by_ids(self, run_ids: List[str]) -> List[RunMetadata]:
        """Get metadata for multiple runs by their IDs, preserving order."""
        if not run_ids:
            return []

        with get_db_connection() as conn:
            cursor = conn.cursor()
            placeholders = ','.join('?' * len(run_ids))
            cursor.execute(f"""
                SELECT run_id, device_id, start_ts, end_ts, run_length
                FROM rle_runs
                WHERE run_id IN ({placeholders})
            """, run_ids)  # nosec B608 - placeholders are ? chars, params passed separately

            rows_dict = {row[0]: row for row in cursor.fetchall()}

            return [
                RunMetadata(
                    run_id=rows_dict[run_id][0],
                    device_id=rows_dict[run_id][1],
                    start_ts=rows_dict[run_id][2],
                    end_ts=rows_dict[run_id][3],
                    run_length=rows_dict[run_id][4]
                )
                for run_id in run_ids
                if run_id in rows_dict
            ]
