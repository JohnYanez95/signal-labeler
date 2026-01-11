"""SQLite implementation of ModelsRepository."""
from typing import List

from app.models import Model
from app.repositories.base import ModelsRepository
from backends.sqlite.connection import get_db_connection


class SQLiteModelsRepository(ModelsRepository):
    """SQLite implementation of models repository."""

    def list_models(self) -> List[Model]:
        """Get all models."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT model_id, model_name
                FROM models
                ORDER BY model_name
            """)
            return [Model(model_id=row[0], model_name=row[1]) for row in cursor.fetchall()]

    def get_model_by_name(self, model_name: str) -> Model | None:
        """Get a model by name."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT model_id, model_name
                FROM models
                WHERE model_name = ?
            """, (model_name,))
            row = cursor.fetchone()
            if row:
                return Model(model_id=row[0], model_name=row[1])
            return None

    def create_model(self, model_name: str) -> Model:
        """Create a new model."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO models (model_name) VALUES (?)
            """, (model_name,))
            conn.commit()
            return Model(model_id=cursor.lastrowid, model_name=model_name)
