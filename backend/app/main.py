"""FastAPI application entry point."""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from app.config import settings
from app.models import (
    DevicesResponse,
    DeviceMetadata,
    DeltaDevicesResponse,
    SampleRunsRequest,
    SampleRunsResponse,
    RunsByIdsRequest,
    RunsByIdsResponse,
    RunMetadata,
    Run,
    TimeSeriesPoint,
    LabelVote,
    LabelSubmitResponse,
    LabelStatus,
    User,
    UsersResponse,
    CreateUserRequest,
    Model,
    ModelsResponse,
    CreateModelRequest,
    ClusterStatusResponse,
    SessionInfo,
    SessionsListResponse,
    NewSessionRequest,
    NewSessionResponse,
    SessionProgressResponse,
    PushSessionRequest,
    PushSessionResponse,
    DeleteSessionRequest,
)
from backends.sqlite import (
    SQLiteRunsRepository,
    SQLiteLabelsRepository,
    SQLiteUsersRepository,
    SQLiteModelsRepository,
    SQLiteSessionsRepository,
    init_database,
)
from sync.cluster import cluster_manager, ClusterStatus


# Initialize database on startup
init_database()

# Create repository instances
runs_repo = SQLiteRunsRepository()
labels_repo = SQLiteLabelsRepository()
users_repo = SQLiteUsersRepository()
models_repo = SQLiteModelsRepository()
sessions_repo = SQLiteSessionsRepository()

# Create FastAPI app
app = FastAPI(
    title="Time Series Labeler API",
    description="API for labeling time-series classification data",
    version="1.0.0"
)

# Configure CORS
origins = settings.cors_origins.split(",") if settings.cors_origins != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True if settings.cors_origins != "*" else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Time Series Labeler API"}


@app.get("/api/system/username")
def get_system_username():
    """
    Get the current system username for autofill.
    Priority: LABELER_NAME env var > USERNAME (Windows) > USER (Unix) > getpass

    For Docker, pass your name via: docker run -e LABELER_NAME=YourName ...
    """
    import os
    import getpass
    try:
        # Check for explicit labeler name first (useful for Docker)
        username = (
            os.environ.get('LABELER_NAME') or  # Explicit override for Docker
            os.environ.get('USERNAME') or       # Windows
            os.environ.get('USER') or           # Unix/Linux/Mac
            getpass.getuser()                   # Fallback
        )
        # Skip generic container usernames
        if username in ('root', 'app', 'nobody', 'www-data'):
            return {"username": None}
        return {"username": username}
    except Exception:
        return {"username": None}


@app.get("/api/devices", response_model=DevicesResponse)
def get_devices(
    start_ts: float = Query(..., description="Start timestamp (unix)"),
    end_ts: float = Query(..., description="End timestamp (unix)"),
    model_type: str = Query(None, description="Model type (optional, for filtering by unlabeled)"),
    labeler: str = Query(None, description="Labeler name (optional, for filtering by unlabeled)")
):
    """
    Get list of device IDs in the specified time range from SQLite (local cache).
    If model_type and labeler are provided, only returns devices with unlabeled runs for that labeler.
    """
    try:
        devices = runs_repo.list_devices(start_ts, end_ts, model_type, labeler)
        return DevicesResponse(devices=devices)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/delta/devices", response_model=DeltaDevicesResponse)
def query_delta_devices(
    start_ts: float = Query(..., description="Start timestamp (unix)"),
    end_ts: float = Query(..., description="End timestamp (unix)"),
    model_type: str = Query(None, description="Model type (optional, for filtering by unlabeled)"),
    labeler: str = Query(None, description="Labeler name (optional, for filtering by unlabeled)")
):
    """
    Query Delta Lake for devices and their runs in the specified time range.
    This starts Spark if not running and queries Delta directly.
    Returns metadata only - does NOT pull timeseries to SQLite.
    """
    from pyspark.sql import functions as F
    from sync.delta_schema import get_table_path

    try:
        spark = cluster_manager.ensure_running()

        # Query Delta for runs in date range
        runs_df = spark.read.format("delta").load(get_table_path("rle_runs"))
        runs_df = runs_df.filter(
            (F.col("start_ts") >= start_ts) & (F.col("end_ts") <= end_ts)
        )

        # If filtering by labeler, exclude runs already labeled by them
        if model_type and labeler:
            labels_df = spark.read.format("delta").load(get_table_path("labels_votes"))
            labeled_runs = labels_df.filter(
                (F.col("model_type") == model_type) & (F.col("labeler") == labeler)
            ).select("run_id").distinct()
            runs_df = runs_df.join(labeled_runs, "run_id", "left_anti")

        # Group by device to get run counts and IDs
        device_runs = runs_df.groupBy("device_id").agg(
            F.count("run_id").alias("run_count"),
            F.collect_list("run_id").alias("run_ids")
        ).orderBy("device_id")

        # Collect results
        results = device_runs.collect()

        devices = []
        total_runs = 0
        for row in results:
            devices.append(DeviceMetadata(
                device_id=row.device_id,
                run_count=row.run_count,
                run_ids=row.run_ids
            ))
            total_runs += row.run_count

        return DeltaDevicesResponse(
            devices=devices,
            total_devices=len(devices),
            total_runs=total_runs,
            query_date_start=start_ts,
            query_date_end=end_ts
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/runs/sample", response_model=SampleRunsResponse)
def sample_runs(request: SampleRunsRequest):
    """
    Sample unlabeled runs for a device and time range.
    If labeler is provided, only excludes runs labeled by that specific labeler.
    """
    try:
        runs = runs_repo.sample_runs(
            device_id=request.device_id,
            start_ts=request.start_ts,
            end_ts=request.end_ts,
            model_type=request.model_type,
            sample_size=request.sample_size,
            labeler=request.labeler,
            unlabeled_only=request.unlabeled_only
        )

        # Calculate global max Y value across sampled runs (device-specific)
        run_ids = [run.run_id for run in runs]
        global_y_max = runs_repo.get_max_value_for_runs(run_ids)

        return SampleRunsResponse(runs=runs, global_y_max=global_y_max)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/runs/by-ids", response_model=RunsByIdsResponse)
def get_runs_by_ids(request: RunsByIdsRequest):
    """
    Get run metadata for a list of run IDs (for restoring cached sessions).
    """
    try:
        runs = runs_repo.get_runs_by_ids(request.run_ids)
        global_y_max = runs_repo.get_max_value_for_runs(request.run_ids)
        return RunsByIdsResponse(runs=runs, global_y_max=global_y_max)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}", response_model=Run)
def get_run(
    run_id: str,
    model_type: str = Query(default=settings.model_type_default)
):
    """
    Get full run details including timeseries and label status.
    """
    try:
        # Get run metadata
        run_metadata = runs_repo.get_run(run_id)

        # Get timeseries data
        timeseries = runs_repo.get_timeseries(run_id)

        # Get label status
        label_status = labels_repo.get_status(run_id, model_type)

        return Run(
            run_id=run_metadata.run_id,
            device_id=run_metadata.device_id,
            start_ts=run_metadata.start_ts,
            end_ts=run_metadata.end_ts,
            label_status=label_status,
            timeseries=timeseries
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/labels", response_model=LabelSubmitResponse)
def submit_label(vote: LabelVote):
    """
    Submit a label vote for a run.
    """
    try:
        # Check if already labeled (for "unlabeled by anyone" enforcement)
        already_labeled = labels_repo.is_labeled(vote.run_id, vote.model_type)

        # Upsert the vote
        labels_repo.upsert_vote(vote)

        return LabelSubmitResponse(
            success=True,
            already_labeled=already_labeled,
            message="Label submitted successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/labels/status/{run_id}", response_model=LabelStatus)
def get_label_status(
    run_id: str,
    model_type: str = Query(default=settings.model_type_default)
):
    """
    Get label status for a specific run.
    """
    try:
        return labels_repo.get_status(run_id, model_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Users API ============

@app.get("/api/users", response_model=UsersResponse)
def get_users():
    """Get all users."""
    try:
        users = users_repo.list_users()
        return UsersResponse(users=users)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/users", response_model=User)
def create_user(request: CreateUserRequest):
    """Create a new user."""
    try:
        # Check if user already exists
        existing = users_repo.get_user_by_name(request.user_name)
        if existing:
            return existing
        return users_repo.create_user(request.user_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Models API ============

@app.get("/api/models", response_model=ModelsResponse)
def get_models():
    """Get all model types."""
    try:
        models = models_repo.list_models()
        return ModelsResponse(models=models)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/models", response_model=Model)
def create_model(request: CreateModelRequest):
    """Create a new model type."""
    try:
        # Check if model already exists
        existing = models_repo.get_model_by_name(request.model_name)
        if existing:
            return existing
        return models_repo.create_model(request.model_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ Cluster API ============

@app.get("/api/cluster/status", response_model=ClusterStatusResponse)
def get_cluster_status():
    """Get Spark cluster status."""
    return ClusterStatusResponse(
        status=cluster_manager.status.value,
        seconds_until_timeout=cluster_manager.seconds_until_timeout
    )


@app.post("/api/cluster/start", response_model=ClusterStatusResponse)
def start_cluster():
    """Start the Spark cluster manually."""
    try:
        cluster_manager.start()
        return ClusterStatusResponse(
            status=cluster_manager.status.value,
            seconds_until_timeout=cluster_manager.seconds_until_timeout
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cluster/touch", response_model=ClusterStatusResponse)
def touch_cluster():
    """Reset cluster timeout (keep alive)."""
    cluster_manager.touch()
    return ClusterStatusResponse(
        status=cluster_manager.status.value,
        seconds_until_timeout=cluster_manager.seconds_until_timeout
    )


# ============ Sessions API ============

@app.get("/api/sessions", response_model=SessionsListResponse)
def list_sessions():
    """Get all saved sessions (max 3)."""
    try:
        sessions_data = sessions_repo.list_sessions()
        sessions = [
            SessionInfo(
                session_id=s['session_id'],
                name=s['name'],
                device_ids=s['device_ids'],
                date_range_start=s['date_range_start'],
                date_range_end=s['date_range_end'],
                model_type=s['model_type'],
                labeler=s['labeler'],
                total_runs=s['total_runs'],
                labeled_count=s['labeled_count'],
                progress_percent=s['progress_percent'],
                progress_color=s['progress_color'],
                created_at=s['created_at'],
                updated_at=s['updated_at'],
            )
            for s in sessions_data
        ]
        return SessionsListResponse(sessions=sessions, max_sessions=3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sessions", response_model=NewSessionResponse)
def create_session(request: NewSessionRequest):
    """
    Create a new labeling session.
    This pulls run data and timeseries FROM DELTA LAKE (not SQLite),
    then caches them in SQLite session tables for offline labeling.
    """
    import uuid
    from pyspark.sql import functions as F
    from sync.delta_schema import get_table_path

    try:
        # Check session limit
        count = sessions_repo.count_sessions()
        if count >= 3:
            return NewSessionResponse(
                success=False,
                message="Maximum sessions reached (3). Please push or delete an existing session."
            )

        # Generate session ID and name
        session_id = str(uuid.uuid4())[:8]
        name = f"Session {session_id}: {len(request.device_ids)} Devices"

        # Start Spark to pull data from Delta
        spark = cluster_manager.ensure_running()

        # Query Delta for runs matching device_ids and date range
        runs_df = spark.read.format("delta").load(get_table_path("rle_runs"))
        runs_df = runs_df.filter(
            (F.col("device_id").isin(request.device_ids)) &
            (F.col("start_ts") >= request.date_range_start) &
            (F.col("end_ts") <= request.date_range_end)
        )

        # Exclude runs already labeled by this labeler for this model (in Delta)
        labels_df = spark.read.format("delta").load(get_table_path("labels_votes"))
        labeled_runs = labels_df.filter(
            (F.col("model_type") == request.model_type) & (F.col("labeler") == request.labeler)
        ).select("run_id").distinct()
        runs_df = runs_df.join(labeled_runs, "run_id", "left_anti")

        # Also exclude runs labeled locally in SQLite (not yet pushed to Delta)
        local_labeled_run_ids = labels_repo.get_labeled_run_ids(request.model_type, request.labeler)
        if local_labeled_run_ids:
            runs_df = runs_df.filter(~F.col("run_id").isin(local_labeled_run_ids))

        # Sample runs per device (limit to sample_size per device)
        from pyspark.sql.window import Window
        window = Window.partitionBy("device_id").orderBy(F.rand())
        runs_df = runs_df.withColumn("row_num", F.row_number().over(window))
        runs_df = runs_df.filter(F.col("row_num") <= request.sample_size).drop("row_num")

        # Collect run data
        run_rows = runs_df.collect()

        if not run_rows:
            return NewSessionResponse(
                success=False,
                message="No unlabeled runs found for selected devices in date range."
            )

        # Create session record first
        sessions_repo.create_session(
            session_id=session_id,
            name=name,
            device_ids=request.device_ids,
            date_range_start=request.date_range_start,
            date_range_end=request.date_range_end,
            model_type=request.model_type,
            labeler=request.labeler,
        )

        # Cache runs to session tables
        run_ids = []
        run_dicts = []
        for row in run_rows:
            run_ids.append(row.run_id)
            run_dicts.append({
                'run_id': row.run_id,
                'device_id': row.device_id,
                'start_ts': float(row.start_ts),
                'end_ts': float(row.end_ts),
            })
        sessions_repo.add_session_runs(session_id, run_dicts)

        # Pull timeseries from Delta for these runs
        timeseries_df = spark.read.format("delta").load(get_table_path("timeseries_data"))
        timeseries_df = timeseries_df.filter(F.col("run_id").isin(run_ids))
        ts_rows = timeseries_df.collect()

        # Group timeseries by run_id and cache
        from collections import defaultdict
        ts_by_run = defaultdict(list)
        for row in ts_rows:
            ts_by_run[row.run_id].append({'ts': float(row.ts), 'value': float(row.value)})

        for run_id, ts_data in ts_by_run.items():
            sessions_repo.add_session_timeseries(session_id, run_id, ts_data)

        total_runs = len(run_dicts)
        return NewSessionResponse(
            success=True,
            session_id=session_id,
            runs_loaded=total_runs,
            message=f"Session created with {total_runs} runs pulled from Delta Lake"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}", response_model=SessionInfo)
def get_session(session_id: str):
    """Get a specific session by ID."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Update labeled count from actual labels
        labeled_count = sessions_repo.get_labeled_count_for_session(
            session_id, session['model_type'], session['labeler']
        )
        if labeled_count != session['labeled_count']:
            sessions_repo.update_session_progress(session_id, labeled_count)
            session['labeled_count'] = labeled_count
            # Recalculate progress
            total = session['total_runs'] or 1
            session['progress_percent'] = round(labeled_count / total * 100, 1)
            if session['progress_percent'] >= 90:
                session['progress_color'] = "green"
            elif session['progress_percent'] >= 70:
                session['progress_color'] = "yellow"
            else:
                session['progress_color'] = "red"

        return SessionInfo(**session)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/progress", response_model=SessionProgressResponse)
def get_session_progress(session_id: str):
    """Get current session progress."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get real-time labeled count
        labeled_count = sessions_repo.get_labeled_count_for_session(
            session_id, session['model_type'], session['labeler']
        )

        total = session['total_runs'] or 1
        progress_percent = round(labeled_count / total * 100, 1)

        # Update stored count if changed
        if labeled_count != session['labeled_count']:
            sessions_repo.update_session_progress(session_id, labeled_count)

        # Determine color
        if progress_percent >= 90:
            progress_color = "green"
        elif progress_percent >= 70:
            progress_color = "yellow"
        else:
            progress_color = "red"

        return SessionProgressResponse(
            session_id=session_id,
            total_runs=session['total_runs'],
            labeled_count=labeled_count,
            progress_percent=progress_percent,
            progress_color=progress_color,
            at_80_percent=progress_percent >= 80
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/user-labels")
def get_session_user_labels(session_id: str):
    """Get the user's labels for all runs in a session.

    Returns a dict mapping run_id -> label (0/1/2) for runs the user has labeled.
    Used to restore userLabels state when resuming a session.
    """
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        user_labels = sessions_repo.get_user_labels_for_session(
            session_id, session['model_type'], session['labeler']
        )

        return {"user_labels": user_labels}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/device-progress")
def get_session_device_progress(session_id: str):
    """Get per-device progress for a session.

    Returns a list of devices with their progress (for hover details panel).
    """
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        device_progress = sessions_repo.get_device_progress_for_session(
            session_id, session['model_type'], session['labeler']
        )

        return {"devices": device_progress}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sessions/{session_id}/push", response_model=PushSessionResponse)
def push_session(session_id: str):
    """Push session labels to Delta Lake and clear session cache."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get run IDs for this session
        cached_runs = sessions_repo.get_session_runs(session_id)
        run_ids = [r['run_id'] for r in cached_runs]

        if not run_ids:
            return PushSessionResponse(
                success=False,
                labels_pushed=0,
                message="No runs in session"
            )

        # Check if there are labels to push
        labeled_count = sessions_repo.get_labeled_count_for_session(
            session_id, session['model_type'], session['labeler']
        )

        if labeled_count == 0:
            return PushSessionResponse(
                success=False,
                labels_pushed=0,
                message="No labels to push"
            )

        # Push labels to Delta (uses cluster manager internally)
        from sync.push import push as sync_push
        result = sync_push(session_run_ids=run_ids)

        # Delete session on successful push (auto-clear)
        sessions_repo.delete_session(session_id)

        return PushSessionResponse(
            success=True,
            labels_pushed=result.labels_pushed,
            message=f"Pushed {result.labels_pushed} labels and cleared session cache"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Delete a session (discard cached data without pushing)."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        sessions_repo.delete_session(session_id)
        return {"success": True, "message": "Session deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/runs", response_model=RunsByIdsResponse)
def get_session_runs(session_id: str):
    """Get all runs cached in a session (from session cache, not main tables)."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get runs directly from session cache (NOT from main rle_runs table)
        cached_runs = sessions_repo.get_session_runs(session_id)

        # Convert cached runs to RunMetadata format
        runs = [
            RunMetadata(
                run_id=r['run_id'],
                device_id=r['device_id'],
                start_ts=r['start_ts'],
                end_ts=r['end_ts'],
                run_length=int(r['end_ts'] - r['start_ts']),
                is_labeled=False,  # Will be updated by frontend based on label status
            )
            for r in cached_runs
        ]

        # Get max Y value from session timeseries cache
        global_y_max = sessions_repo.get_session_max_value(session_id)

        return RunsByIdsResponse(runs=runs, global_y_max=global_y_max)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_id}/runs/{run_id}", response_model=Run)
def get_session_run_detail(session_id: str, run_id: str, model_type: str = Query(...)):
    """Get full run details from session cache (including timeseries)."""
    try:
        session = sessions_repo.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Get run metadata from session cache
        cached_runs = sessions_repo.get_session_runs(session_id)
        run_data = next((r for r in cached_runs if r['run_id'] == run_id), None)
        if not run_data:
            raise HTTPException(status_code=404, detail=f"Run not found in session: {run_id}")

        # Get timeseries from session cache
        timeseries = sessions_repo.get_session_timeseries(session_id, run_id)

        # Get label status
        label_status = labels_repo.get_status(run_id, model_type)

        return Run(
            run_id=run_data['run_id'],
            device_id=run_data['device_id'],
            start_ts=run_data['start_ts'],
            end_ts=run_data['end_ts'],
            label_status=label_status,
            timeseries=[TimeSeriesPoint(ts=p['ts'], value=p['value']) for p in timeseries],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)  # nosec B104 - intentional for Docker
