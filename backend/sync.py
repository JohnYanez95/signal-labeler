#!/usr/bin/env python3
"""
Sync CLI for Delta <-> SQLite synchronization.

Usage:
    python sync.py seed [--devices N] [--days N] [--runs-per-day N]
    python sync.py pull [--full] [--device-id ID] [--start-ts TS] [--end-ts TS]
    python sync.py push
    python sync.py status
"""
import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


def cmd_pull(args):
    """Execute pull command."""
    from sync.pull import pull

    device_ids = None
    if args.device_id:
        device_ids = [args.device_id]
    elif args.device_ids_file:
        with open(args.device_ids_file) as f:
            device_ids = [line.strip() for line in f if line.strip()]

    print("Starting pull (Delta -> SQLite)...")
    if args.full:
        print("  Mode: Full refresh")
    else:
        print("  Mode: Incremental")

    if device_ids:
        print(f"  Devices: {len(device_ids)}")

    result = pull(
        device_ids=device_ids,
        start_ts=args.start_ts,
        end_ts=args.end_ts,
        full_refresh=args.full
    )

    print()
    print("Pull completed:")
    print(f"  Devices synced: {result.devices_synced:,}")
    print(f"  Runs synced:    {result.runs_synced:,}")
    print(f"  TS points:      {result.timeseries_points_synced:,}")
    print(f"  Duration:       {result.duration_seconds:.2f}s")


def cmd_push(args):
    """Execute push command."""
    from sync.push import push

    print("Starting push (SQLite -> Delta)...")

    result = push()

    print()
    print("Push completed:")
    print(f"  Labels pushed: {result.labels_pushed:,}")
    print(f"  Duration:      {result.duration_seconds:.2f}s")

    if result.labels_pushed == 0:
        print("  (No unpushed labels found)")


def cmd_status(args):
    """Execute status command."""
    from sync.status import print_status
    print_status()


def cmd_seed(args):
    """Execute seed command."""
    from sync.seed import seed

    print(f"Seeding Delta tables with {args.devices} devices, {args.days} days...")
    seed(
        num_devices=args.devices,
        num_days=args.days,
        runs_per_day=args.runs_per_day
    )


def main():
    parser = argparse.ArgumentParser(
        description="Sync Delta tables with SQLite working copy"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Seed subcommand
    seed_parser = subparsers.add_parser(
        "seed",
        help="Seed Delta tables with mock data"
    )
    seed_parser.add_argument(
        "--devices", "-d",
        type=int,
        default=10,
        help="Number of devices to create (default: 10)"
    )
    seed_parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Number of days of data per device (default: 30)"
    )
    seed_parser.add_argument(
        "--runs-per-day",
        type=int,
        default=10,
        help="Average runs per device per day (default: 10)"
    )
    seed_parser.set_defaults(func=cmd_seed)

    # Pull subcommand
    pull_parser = subparsers.add_parser(
        "pull",
        help="Pull runs/timeseries from Delta to SQLite"
    )
    pull_parser.add_argument(
        "--full", "-f",
        action="store_true",
        help="Full refresh (clear SQLite first)"
    )
    pull_parser.add_argument(
        "--device-id", "-d",
        help="Filter to a single device"
    )
    pull_parser.add_argument(
        "--device-ids-file",
        help="File containing device IDs (one per line)"
    )
    pull_parser.add_argument(
        "--start-ts",
        type=float,
        help="Start timestamp filter"
    )
    pull_parser.add_argument(
        "--end-ts",
        type=float,
        help="End timestamp filter"
    )
    pull_parser.set_defaults(func=cmd_pull)

    # Push subcommand
    push_parser = subparsers.add_parser(
        "push",
        help="Push labels from SQLite to Delta"
    )
    push_parser.set_defaults(func=cmd_push)

    # Status subcommand
    status_parser = subparsers.add_parser(
        "status",
        help="Show sync status"
    )
    status_parser.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
