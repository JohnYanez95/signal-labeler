"""
PySpark session management with Delta Lake support.

Based on patterns from kanji_cards/utils/spark.py
"""
import os
from functools import lru_cache
from pyspark.sql import SparkSession


@lru_cache(maxsize=1)
def get_spark_session(app_name: str = "TimeSeriesLabeler") -> SparkSession:
    """
    Construct a SparkSession with Delta Lake extensions (cached singleton).

    Configuration can be overridden via environment variables:
    - SPARK_LOCAL_THREADS: Number of local threads (default: 4)
    - SPARK_DRIVER_MEMORY: Driver memory (default: 4g)
    - SPARK_EXECUTOR_MEMORY: Executor memory (default: 4g)
    - SPARK_SHUFFLE_PARTITIONS: Shuffle partitions (default: 8)
    - SPARK_LOCAL_IP: Local IP for WSL2/VPN environments
    - SPARK_LOG_LEVEL: Log level (default: WARN)

    Returns:
        SparkSession configured for Delta Lake
    """
    local_threads = int(os.getenv("SPARK_LOCAL_THREADS", "4"))
    driver_memory = os.getenv("SPARK_DRIVER_MEMORY", "4g")
    executor_memory = os.getenv("SPARK_EXECUTOR_MEMORY", "4g")
    shuffle_partitions = int(os.getenv("SPARK_SHUFFLE_PARTITIONS", "8"))
    log_level = os.getenv("SPARK_LOG_LEVEL", "WARN")
    spark_local_ip = os.getenv("SPARK_LOCAL_IP")

    builder = (
        SparkSession.builder.appName(app_name)
        .master(f"local[{local_threads}]")
        .config("spark.jars.packages", "io.delta:delta-spark_2.12:3.2.0")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
        .config("spark.executor.memory", executor_memory)
        .config("spark.driver.memory", driver_memory)
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.sql.shuffle.partitions", str(shuffle_partitions))
        .config("spark.sql.execution.arrow.pyspark.enabled", "false")
    )

    # Set SPARK_LOCAL_IP if provided (for WSL2/VPN environments)
    if spark_local_ip:
        builder = builder.config("spark.driver.host", spark_local_ip)

    spark = builder.getOrCreate()
    spark.sparkContext.setLogLevel(log_level)
    return spark


def stop_spark_session() -> None:
    """Stop the cached Spark session if it exists."""
    try:
        spark = get_spark_session.__wrapped__()
        if spark:
            spark.stop()
    except Exception:
        pass
    get_spark_session.cache_clear()
