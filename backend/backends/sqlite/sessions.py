"""SQLite implementation of SessionsRepository."""
import json
from datetime import datetime
from typing import List

from app.repositories.base import SessionsRepository
from backends.sqlite.connection import get_db_connection


class SQLiteSessionsRepository(SessionsRepository):
    """SQLite implementation of sessions repository."""

    MAX_SESSIONS = 3

    def list_sessions(self) -> List[dict]:
        """Get all sessions (max 3)."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT session_id, name, device_ids, date_range_start, date_range_end,
                       model_type, labeler, total_runs, labeled_count, created_at, updated_at
                FROM sessions
                ORDER BY updated_at DESC
            """)
            rows = cursor.fetchall()
            return [self._row_to_dict(row) for row in rows]

    def get_session(self, session_id: str) -> dict | None:
        """Get a session by ID."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT session_id, name, device_ids, date_range_start, date_range_end,
                       model_type, labeler, total_runs, labeled_count, created_at, updated_at
                FROM sessions
                WHERE session_id = ?
            """, (session_id,))
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(row)
            return None

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
        # Use SQLite-compatible format (matches CURRENT_TIMESTAMP)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        device_ids_json = json.dumps(device_ids)

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sessions (
                    session_id, name, device_ids, date_range_start, date_range_end,
                    model_type, labeler, total_runs, labeled_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
            """, (session_id, name, device_ids_json, date_range_start, date_range_end,
                  model_type, labeler, now, now))
            conn.commit()

        return self.get_session(session_id)

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its cached data, including labels.

        This completely removes the session as if it never happened,
        allowing the user to query those runs again in a future session.
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Get session info to know labeler and model_type
            cursor.execute("""
                SELECT model_type, labeler FROM sessions WHERE session_id = ?
            """, (session_id,))
            session_row = cursor.fetchone()

            if session_row:
                model_type, labeler = session_row

                # Delete labels for runs in this session (only for this user/model)
                # This allows the runs to be queried again in future sessions
                cursor.execute("""
                    DELETE FROM labels_votes
                    WHERE run_id IN (SELECT run_id FROM session_runs WHERE session_id = ?)
                      AND model_type = ?
                      AND labeler = ?
                """, (session_id, model_type, labeler))

            # Delete in order: timeseries, runs, then session
            cursor.execute("DELETE FROM session_timeseries WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM session_runs WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))

            conn.commit()
            return cursor.rowcount > 0

    def update_session_progress(self, session_id: str, labeled_count: int) -> None:
        """Update the labeled count for a session."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE sessions
                SET labeled_count = ?, updated_at = ?
                WHERE session_id = ?
            """, (labeled_count, now, session_id))
            conn.commit()

    def set_session_total_runs(self, session_id: str, total_runs: int) -> None:
        """Set the total runs count for a session."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE sessions
                SET total_runs = ?, updated_at = ?
                WHERE session_id = ?
            """, (total_runs, now, session_id))
            conn.commit()

    def add_session_runs(
        self,
        session_id: str,
        runs: List[dict],
    ) -> int:
        """Add runs to a session's cache. Returns count added."""
        if not runs:
            return 0

        with get_db_connection() as conn:
            cursor = conn.cursor()
            count = 0
            for run in runs:
                try:
                    cursor.execute("""
                        INSERT OR IGNORE INTO session_runs
                        (session_id, run_id, device_id, start_ts, end_ts)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        session_id,
                        run.get('run_id'),
                        run.get('device_id'),
                        run.get('start_ts'),
                        run.get('end_ts'),
                    ))
                    if cursor.rowcount > 0:
                        count += 1
                except Exception:
                    pass  # Skip duplicates
            conn.commit()

            # Update total runs count
            cursor.execute("""
                SELECT COUNT(*) FROM session_runs WHERE session_id = ?
            """, (session_id,))
            total = cursor.fetchone()[0]
            self.set_session_total_runs(session_id, total)

            return count

    def add_session_timeseries(
        self,
        session_id: str,
        run_id: str,
        timeseries: List[dict],
    ) -> int:
        """Add timeseries data for a run in a session. Returns count added."""
        if not timeseries:
            return 0

        with get_db_connection() as conn:
            cursor = conn.cursor()
            count = 0
            for point in timeseries:
                try:
                    cursor.execute("""
                        INSERT OR IGNORE INTO session_timeseries
                        (session_id, run_id, ts, value)
                        VALUES (?, ?, ?, ?)
                    """, (
                        session_id,
                        run_id,
                        point.get('ts'),
                        point.get('value'),
                    ))
                    if cursor.rowcount > 0:
                        count += 1
                except Exception:
                    pass  # Skip duplicates
            conn.commit()
            return count

    def get_session_runs(self, session_id: str) -> List[dict]:
        """Get all cached runs for a session."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT run_id, device_id, start_ts, end_ts
                FROM session_runs
                WHERE session_id = ?
                ORDER BY device_id, start_ts
            """, (session_id,))
            return [
                {
                    'run_id': row[0],
                    'device_id': row[1],
                    'start_ts': row[2],
                    'end_ts': row[3],
                }
                for row in cursor.fetchall()
            ]

    def get_session_timeseries(self, session_id: str, run_id: str) -> List[dict]:
        """Get cached timeseries for a run in a session."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ts, value
                FROM session_timeseries
                WHERE session_id = ? AND run_id = ?
                ORDER BY ts
            """, (session_id, run_id))
            return [
                {'ts': row[0], 'value': row[1]}
                for row in cursor.fetchall()
            ]

    def count_sessions(self) -> int:
        """Count total sessions."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM sessions")
            return cursor.fetchone()[0]

    def get_labeled_count_for_session(self, session_id: str, model_type: str, labeler: str) -> int:
        """Count how many runs in this session have been labeled during this session."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Only count labels made after the session was created
            cursor.execute("""
                SELECT COUNT(DISTINCT sr.run_id)
                FROM session_runs sr
                INNER JOIN labels_votes lv ON sr.run_id = lv.run_id
                INNER JOIN sessions s ON sr.session_id = s.session_id
                WHERE sr.session_id = ?
                  AND lv.model_type = ?
                  AND lv.labeler = ?
                  AND lv.labeled_at >= s.created_at
            """, (session_id, model_type, labeler))
            return cursor.fetchone()[0]

    def get_session_max_value(self, session_id: str) -> float | None:
        """Get the maximum Y value across all timeseries in a session."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT MAX(value)
                FROM session_timeseries
                WHERE session_id = ?
            """, (session_id,))
            result = cursor.fetchone()
            return result[0] if result and result[0] is not None else None

    def get_user_labels_for_session(
        self,
        session_id: str,
        model_type: str,
        labeler: str
    ) -> dict[str, int]:
        """Get the user's labels for all runs in a session.

        Returns a dict mapping run_id -> label for runs the user has labeled.
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT sr.run_id, lv.label
                FROM session_runs sr
                INNER JOIN labels_votes lv ON sr.run_id = lv.run_id
                WHERE sr.session_id = ?
                  AND lv.model_type = ?
                  AND lv.labeler = ?
            """, (session_id, model_type, labeler))

            return {row[0]: row[1] for row in cursor.fetchall()}

    def get_device_progress_for_session(
        self,
        session_id: str,
        model_type: str,
        labeler: str
    ) -> list[dict]:
        """Get per-device progress for a session.

        Returns a list of dicts with device_id, total_runs, labeled_count, progress_percent.
        """
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Get run counts per device
            cursor.execute("""
                SELECT sr.device_id, COUNT(*) as total_runs
                FROM session_runs sr
                WHERE sr.session_id = ?
                GROUP BY sr.device_id
                ORDER BY sr.device_id
            """, (session_id,))
            device_totals = {row[0]: row[1] for row in cursor.fetchall()}

            # Get labeled counts per device (only labels made during this session)
            cursor.execute("""
                SELECT sr.device_id, COUNT(DISTINCT sr.run_id) as labeled_count
                FROM session_runs sr
                INNER JOIN labels_votes lv ON sr.run_id = lv.run_id
                INNER JOIN sessions s ON sr.session_id = s.session_id
                WHERE sr.session_id = ?
                  AND lv.model_type = ?
                  AND lv.labeler = ?
                  AND lv.labeled_at >= s.created_at
                GROUP BY sr.device_id
            """, (session_id, model_type, labeler))
            device_labeled = {row[0]: row[1] for row in cursor.fetchall()}

            # Combine into result
            result = []
            for device_id, total in device_totals.items():
                labeled = device_labeled.get(device_id, 0)
                progress = (labeled / total * 100) if total > 0 else 0
                result.append({
                    'device_id': device_id,
                    'total_runs': total,
                    'labeled_count': labeled,
                    'progress_percent': round(progress, 1),
                })

            return result

    def _row_to_dict(self, row) -> dict:
        """Convert a database row to a session dict."""
        device_ids = json.loads(row[2]) if row[2] else []
        total_runs = row[7] or 0
        labeled_count = row[8] or 0

        # Calculate progress
        progress_percent = (labeled_count / total_runs * 100) if total_runs > 0 else 0

        # Determine progress color
        if progress_percent >= 90:
            progress_color = "green"
        elif progress_percent >= 70:
            progress_color = "yellow"
        else:
            progress_color = "red"

        return {
            'session_id': row[0],
            'name': row[1],
            'device_ids': device_ids,
            'date_range_start': row[3],
            'date_range_end': row[4],
            'model_type': row[5],
            'labeler': row[6],
            'total_runs': total_runs,
            'labeled_count': labeled_count,
            'progress_percent': round(progress_percent, 1),
            'progress_color': progress_color,
            'created_at': row[9],
            'updated_at': row[10],
        }
