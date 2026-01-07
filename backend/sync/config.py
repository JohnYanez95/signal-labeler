"""Sync configuration settings."""
from pydantic_settings import BaseSettings


class SyncSettings(BaseSettings):
    """Settings for Delta <-> SQLite synchronization."""

    # Delta table paths (source of truth)
    delta_table_path: str = "./data/delta"

    # SQLite path (working copy)
    sqlite_db_path: str = "./labeler.db"

    # Batch sizes for sync operations
    pull_batch_size: int = 10000
    push_batch_size: int = 1000

    # Future Databricks settings
    databricks_host: str = ""
    databricks_token: str = ""
    databricks_catalog: str = ""
    databricks_schema: str = ""

    class Config:
        env_file = ".env"
        env_prefix = "SYNC_"


sync_settings = SyncSettings()
