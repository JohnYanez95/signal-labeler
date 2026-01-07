"""SQLite implementation of UsersRepository."""
from typing import List

from app.models import User
from app.repositories.base import UsersRepository
from backends.sqlite.connection import get_db_connection


class SQLiteUsersRepository(UsersRepository):
    """SQLite implementation of users repository."""

    def list_users(self) -> List[User]:
        """Get all users."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_id, user_name
                FROM users
                ORDER BY user_name
            """)
            return [User(user_id=row[0], user_name=row[1]) for row in cursor.fetchall()]

    def get_user_by_name(self, user_name: str) -> User | None:
        """Get a user by name."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT user_id, user_name
                FROM users
                WHERE user_name = ?
            """, (user_name,))
            row = cursor.fetchone()
            if row:
                return User(user_id=row[0], user_name=row[1])
            return None

    def create_user(self, user_name: str) -> User:
        """Create a new user."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO users (user_name) VALUES (?)
            """, (user_name,))
            conn.commit()
            return User(user_id=cursor.lastrowid, user_name=user_name)

    def get_or_create_user(self, user_name: str) -> User:
        """Get existing user or create if not exists."""
        user = self.get_user_by_name(user_name)
        if user:
            return user
        return self.create_user(user_name)
