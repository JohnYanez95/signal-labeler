"""
Generate mock time-series data for Delta tables.

Usage:
    python sync.py seed [--devices N] [--days N] [--runs-per-day N]
"""
import math
import random
from datetime import datetime, timedelta
from typing import List, Tuple

from pyspark.sql import SparkSession
from delta import DeltaTable

from sync.spark_session import get_spark_session
from sync.delta_schema import (
    get_table_path,
    init_tables,
    DEVICES_SCHEMA,
    RLE_RUNS_SCHEMA,
    TIMESERIES_DATA_SCHEMA,
)


def generate_timeseries(start_ts: float, end_ts: float, interval: int = 5) -> List[Tuple[float, float]]:
    """
    Generate synthetic time-series data.

    Args:
        start_ts: Start timestamp (unix)
        end_ts: End timestamp (unix)
        interval: Sampling interval in seconds

    Returns:
        List of (timestamp, value) tuples
    """
    data = []
    current_ts = start_ts

    # Base parameters for sine wave + noise
    base_value = random.uniform(65, 75)
    amplitude = random.uniform(5, 10)
    period = random.uniform(300, 600)
    trend = random.uniform(-0.001, 0.001)

    while current_ts <= end_ts:
        phase = (current_ts - start_ts) / period * 2 * math.pi
        sine_component = amplitude * math.sin(phase)
        trend_component = trend * (current_ts - start_ts)
        noise = random.gauss(0, 1.5)
        value = base_value + sine_component + trend_component + noise

        data.append((current_ts, value))
        current_ts += interval

    return data


def generate_device_data(
    device_id: str,
    start_date: datetime,
    num_days: int = 30,
    runs_per_day: int = 10
) -> Tuple[List[tuple], List[tuple]]:
    """
    Generate runs and timeseries data for a single device.

    Returns:
        Tuple of (runs_tuples, timeseries_tuples)
        Tuples match schema order: RLE_RUNS_SCHEMA, TIMESERIES_DATA_SCHEMA
    """
    runs_rows = []
    ts_rows = []
    run_count = 0
    ts_id = 0

    for day in range(num_days):
        current_datetime = start_date + timedelta(days=day)
        day_start_ts = current_datetime.timestamp()

        num_runs = random.randint(runs_per_day - 2, runs_per_day + 2)
        current_ts = day_start_ts

        for _ in range(num_runs):
            run_length = random.randint(300, 3600)
            start_ts = current_ts
            end_ts = start_ts + run_length
            run_id = f"{device_id}_run_{run_count:05d}"

            # Tuple order: run_id, device_id, start_ts, end_ts, run_length, created_at
            runs_rows.append((
                run_id,
                device_id,
                float(start_ts),
                float(end_ts),
                run_length,
                datetime.now()
            ))

            # Generate timeseries
            timeseries = generate_timeseries(start_ts, end_ts, interval=5)
            for ts, value in timeseries:
                # Tuple order: id, run_id, ts, value
                ts_rows.append((
                    ts_id,
                    run_id,
                    float(ts),
                    float(value)
                ))
                ts_id += 1

            run_count += 1
            current_ts = end_ts + random.randint(60, 300)

    return runs_rows, ts_rows


def clear_tables(spark: SparkSession):
    """Clear all existing data from Delta tables."""
    tables = ["devices", "rle_runs", "timeseries_data", "labels_votes"]

    for table in tables:
        path = get_table_path(table)
        if DeltaTable.isDeltaTable(spark, path):
            # Overwrite with empty DataFrame
            df = spark.read.format("delta").load(path)
            empty_df = spark.createDataFrame([], df.schema)
            empty_df.write.format("delta").mode("overwrite").save(path)
            print(f"  Cleared {table}")


def seed(
    num_devices: int = 10,
    num_days: int = 30,
    runs_per_day: int = 10
):
    """
    Seed the Delta tables with mock data.

    Args:
        num_devices: Number of devices to create
        num_days: Number of days of data per device
        runs_per_day: Average runs per device per day
    """
    print("=" * 60)
    print("SEEDING DELTA TABLES WITH MOCK DATA")
    print("=" * 60)

    spark = get_spark_session()

    # Initialize tables
    print("\nInitializing Delta tables...")
    init_tables()

    # Clear existing data
    print("\nClearing existing data...")
    clear_tables(spark)

    # Generate data
    device_ids = [f"device_{i:03d}" for i in range(1, num_devices + 1)]
    start_date = datetime(2026, 1, 1)

    all_devices = []
    total_runs = 0
    total_ts_points = 0

    print(f"\nGenerating data for {num_devices} devices...")
    for i, device_id in enumerate(device_ids, 1):
        print(f"  [{i}/{num_devices}] {device_id}...", end=" ", flush=True)

        runs_rows, ts_rows = generate_device_data(
            device_id, start_date, num_days, runs_per_day
        )

        # Write runs for this device immediately
        if runs_rows:
            runs_df = spark.createDataFrame(runs_rows, schema=RLE_RUNS_SCHEMA)
            runs_df.write.format("delta").mode("append").save(get_table_path("rle_runs"))
            total_runs += len(runs_rows)

        # Write timeseries for this device immediately (frees memory)
        if ts_rows:
            ts_df = spark.createDataFrame(ts_rows, schema=TIMESERIES_DATA_SCHEMA)
            ts_df.write.format("delta").mode("append").save(get_table_path("timeseries_data"))
            total_ts_points += len(ts_rows)

        # Create device tuple (order: device_id, first_seen, last_seen, run_count)
        if runs_rows:
            first_seen = min(r[2] for r in runs_rows)  # start_ts
            last_seen = max(r[3] for r in runs_rows)   # end_ts
        else:
            first_seen = last_seen = 0.0

        all_devices.append((
            device_id,
            first_seen,
            last_seen,
            len(runs_rows)
        ))

        print(f"{len(runs_rows)} runs, {len(ts_rows):,} points")

    # Write devices (small, do at end)
    print("\n  Writing devices...")
    devices_df = spark.createDataFrame(all_devices, schema=DEVICES_SCHEMA)
    devices_df.write.format("delta").mode("append").save(get_table_path("devices"))

    # Summary
    end_date = start_date + timedelta(days=num_days)

    print("\n" + "=" * 60)
    print("SUCCESS! Delta tables seeded:")
    print(f"  - {num_devices} devices")
    print(f"  - {total_runs:,} runs")
    print(f"  - {total_ts_points:,} timeseries points")
    print(f"  - Date range: {start_date.date()} to {end_date.date()}")
    print("=" * 60)


if __name__ == "__main__":
    seed(num_devices=10, num_days=30, runs_per_day=10)
