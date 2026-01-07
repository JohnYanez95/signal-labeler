"""Application configuration."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # SQLite settings
    database_url: str = "sqlite:///./labeler.db"
    data_backend: str = "sqlite"

    # Application settings
    model_type_default: str = "classification_v1"
    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields in .env


settings = Settings()
