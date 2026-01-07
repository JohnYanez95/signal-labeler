"""
Delta table schema definitions and initialization.

Creates Delta tables if they don't exist.
"""
from delta import DeltaTable
from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    DoubleType,
    IntegerType,
    LongType,
    TimestampType,
)

from sync.config import sync_settings
from sync.spark_session import get_spark_session


def get_table_path(table_name: str) -> str:
    """Get the full path for a Delta table."""
    base_path = sync_settings.delta_table_path
    return f"{base_path}/{table_name}"


# Schema definitions
DEVICES_SCHEMA = StructType([
    StructField("device_id", StringType(), nullable=False),
    StructField("first_seen", DoubleType(), nullable=False),
    StructField("last_seen", DoubleType(), nullable=False),
    StructField("run_count", IntegerType(), nullable=True),
])

RLE_RUNS_SCHEMA = StructType([
    StructField("run_id", StringType(), nullable=False),
    StructField("device_id", StringType(), nullable=False),
    StructField("start_ts", DoubleType(), nullable=False),
    StructField("end_ts", DoubleType(), nullable=False),
    StructField("run_length", IntegerType(), nullable=False),
    StructField("created_at", TimestampType(), nullable=True),
])

TIMESERIES_DATA_SCHEMA = StructType([
    StructField("id", LongType(), nullable=False),
    StructField("run_id", StringType(), nullable=False),
    StructField("ts", DoubleType(), nullable=False),
    StructField("value", DoubleType(), nullable=False),
])

LABELS_VOTES_SCHEMA = StructType([
    StructField("run_id", StringType(), nullable=False),
    StructField("model_type", StringType(), nullable=False),
    StructField("labeler", StringType(), nullable=False),
    StructField("label", IntegerType(), nullable=False),
    StructField("labeled_at", TimestampType(), nullable=True),
    StructField("notes", StringType(), nullable=True),
])

USERS_SCHEMA = StructType([
    StructField("user_id", LongType(), nullable=False),
    StructField("user_name", StringType(), nullable=False),
    StructField("created_at", TimestampType(), nullable=True),
])

MODELS_SCHEMA = StructType([
    StructField("model_id", LongType(), nullable=False),
    StructField("model_name", StringType(), nullable=False),
    StructField("created_at", TimestampType(), nullable=True),
])


def _create_table_if_not_exists(
    table_name: str,
    schema: StructType,
    partition_cols: list[str] | None = None
) -> None:
    """Create a Delta table if it doesn't exist."""
    spark = get_spark_session()
    path = get_table_path(table_name)

    if not DeltaTable.isDeltaTable(spark, path):
        df = spark.createDataFrame([], schema)
        writer = df.write.format("delta")
        if partition_cols:
            writer = writer.partitionBy(*partition_cols)
        writer.save(path)
        print(f"Created Delta table: {table_name}")
    else:
        print(f"Delta table exists: {table_name}")


def init_tables() -> None:
    """Initialize all Delta tables."""
    print("Initializing Delta tables...")

    _create_table_if_not_exists("devices", DEVICES_SCHEMA)
    _create_table_if_not_exists("rle_runs", RLE_RUNS_SCHEMA, partition_cols=["device_id"])
    _create_table_if_not_exists("timeseries_data", TIMESERIES_DATA_SCHEMA, partition_cols=["run_id"])
    _create_table_if_not_exists("labels_votes", LABELS_VOTES_SCHEMA, partition_cols=["model_type"])
    _create_table_if_not_exists("users", USERS_SCHEMA)
    _create_table_if_not_exists("models", MODELS_SCHEMA)

    # Insert default model if not exists
    spark = get_spark_session()
    models_path = get_table_path("models")
    models_df = spark.read.format("delta").load(models_path)

    if models_df.filter(models_df.model_name == "classification_v1").count() == 0:
        from datetime import datetime
        new_model = spark.createDataFrame([
            (1, "classification_v1", datetime.now())
        ], schema=MODELS_SCHEMA)
        new_model.write.format("delta").mode("append").save(models_path)
        print("Inserted default model: classification_v1")

    print("Delta tables initialized")


if __name__ == "__main__":
    init_tables()
