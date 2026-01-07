"""SQLite implementation of LabelsRepository."""
from typing import List
from app.models import LabelVote, LabelStatus
from app.repositories.base import LabelsRepository
from backends.sqlite.connection import get_db_connection


class SQLiteLabelsRepository(LabelsRepository):
    """SQLite implementation of labels repository."""

    def is_labeled(self, run_id: str, model_type: str) -> bool:
        """Check if a run has been labeled by anyone."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM labels_votes
                WHERE run_id = ? AND model_type = ?
            """, (run_id, model_type))

            count = cursor.fetchone()[0]
            return count > 0

    def upsert_vote(self, vote: LabelVote) -> None:
        """Insert or update a label vote."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO labels_votes (run_id, model_type, labeler, label, notes)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id, model_type, labeler)
                DO UPDATE SET
                    label = excluded.label,
                    labeled_at = CURRENT_TIMESTAMP,
                    notes = excluded.notes
            """, (vote.run_id, vote.model_type, vote.labeler, vote.label, vote.notes))

            conn.commit()

    def get_status(self, run_id: str, model_type: str) -> LabelStatus:
        """Get label status (vote counts, etc.) for a run."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT label, COUNT(*) as count
                FROM labels_votes
                WHERE run_id = ? AND model_type = ?
                GROUP BY label
            """, (run_id, model_type))

            rows = cursor.fetchall()

            counts = {}
            n_votes = 0
            for row in rows:
                label = row[0]
                count = row[1]
                counts[label] = count
                n_votes += count

            return LabelStatus(
                is_labeled=(n_votes > 0),
                n_votes=n_votes,
                counts=counts
            )

    def get_labeled_run_ids(self, model_type: str, labeler: str) -> List[str]:
        """Get all run IDs that have been labeled by this labeler for this model type."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT run_id FROM labels_votes
                WHERE model_type = ? AND labeler = ?
            """, (model_type, labeler))
            return [row[0] for row in cursor.fetchall()]
