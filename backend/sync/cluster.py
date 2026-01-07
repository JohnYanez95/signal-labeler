"""
Spark cluster lifecycle manager.

Manages Spark session with lazy startup and timeout-based shutdown.
"""
import threading
import time
from datetime import datetime
from enum import Enum
from typing import Optional

from pyspark.sql import SparkSession


class ClusterStatus(str, Enum):
    OFF = "off"
    STARTING = "starting"
    ON = "on"


class SparkClusterManager:
    """
    Singleton manager for Spark session lifecycle.

    Features:
    - Lazy startup (only when needed)
    - Automatic timeout shutdown (3 minutes idle)
    - Thread-safe status tracking
    """

    _instance: Optional["SparkClusterManager"] = None
    _lock = threading.Lock()

    TIMEOUT_SECONDS = 180  # 3 minutes

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._spark: Optional[SparkSession] = None
        self._status = ClusterStatus.OFF
        self._last_activity: Optional[datetime] = None
        self._timeout_thread: Optional[threading.Thread] = None
        self._shutdown_event = threading.Event()
        self._initialized = True

    @property
    def status(self) -> ClusterStatus:
        """Get current cluster status."""
        return self._status

    @property
    def last_activity(self) -> Optional[datetime]:
        """Get last activity timestamp."""
        return self._last_activity

    @property
    def seconds_until_timeout(self) -> Optional[int]:
        """Get seconds until auto-shutdown, or None if off."""
        if self._status != ClusterStatus.ON or not self._last_activity:
            return None
        elapsed = (datetime.now() - self._last_activity).total_seconds()
        remaining = max(0, int(self.TIMEOUT_SECONDS - elapsed))
        return remaining

    def start(self) -> bool:
        """
        Start the Spark cluster.

        Returns:
            True if started successfully, False if already starting/on
        """
        with self._lock:
            if self._status == ClusterStatus.ON:
                self._touch()
                return True

            if self._status == ClusterStatus.STARTING:
                return False

            self._status = ClusterStatus.STARTING

        try:
            # Import here to avoid loading Spark until needed
            from sync.spark_session import get_spark_session

            self._spark = get_spark_session()

            with self._lock:
                self._status = ClusterStatus.ON
                self._touch()

            # Start timeout monitor thread
            self._start_timeout_monitor()

            return True

        except Exception as e:
            with self._lock:
                self._status = ClusterStatus.OFF
                self._spark = None
            raise e

    def stop(self) -> None:
        """Stop the Spark cluster."""
        with self._lock:
            if self._status == ClusterStatus.OFF:
                return

            # Signal timeout thread to stop
            self._shutdown_event.set()

            if self._spark:
                try:
                    self._spark.stop()
                except Exception:
                    pass

                # Clear the cached session
                from sync.spark_session import get_spark_session
                get_spark_session.cache_clear()

            self._spark = None
            self._status = ClusterStatus.OFF
            self._last_activity = None

    def ensure_running(self) -> SparkSession:
        """
        Ensure cluster is running and return session.

        Raises:
            RuntimeError: If cluster fails to start
        """
        if self._status == ClusterStatus.ON and self._spark:
            self._touch()
            return self._spark

        if not self.start():
            # Wait for startup to complete
            for _ in range(60):  # Wait up to 60 seconds
                time.sleep(1)
                if self._status == ClusterStatus.ON and self._spark:
                    self._touch()
                    return self._spark
            raise RuntimeError("Spark cluster failed to start")

        if not self._spark:
            raise RuntimeError("Spark cluster started but session is None")

        return self._spark

    def touch(self) -> None:
        """Update last activity timestamp (public method)."""
        self._touch()

    def _touch(self) -> None:
        """Update last activity timestamp."""
        self._last_activity = datetime.now()

    def _start_timeout_monitor(self) -> None:
        """Start background thread to monitor for timeout."""
        self._shutdown_event.clear()

        def monitor():
            while not self._shutdown_event.is_set():
                time.sleep(10)  # Check every 10 seconds

                if self._status != ClusterStatus.ON:
                    break

                if self._last_activity:
                    elapsed = (datetime.now() - self._last_activity).total_seconds()
                    if elapsed >= self.TIMEOUT_SECONDS:
                        print(f"Spark cluster idle for {self.TIMEOUT_SECONDS}s, shutting down...")
                        self.stop()
                        break

        self._timeout_thread = threading.Thread(target=monitor, daemon=True)
        self._timeout_thread.start()


# Global instance
cluster_manager = SparkClusterManager()
