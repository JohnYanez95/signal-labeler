# Signal Labeler

## Quick Start

### Docker (recommended)
```bash
# 1. Start containers
docker compose up -d --build

# 2. Seed demo data (first time only)
docker compose exec backend python sync.py seed

# 3. Open http://localhost
```

### Manual
```bash
# Backend
cd backend && source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm run dev   # http://localhost:5173
```

## Seeding Demo Data

Generate synthetic time-series data for demonstration:

```bash
# Default: 5 devices, 7 days, 10 runs/day
python sync.py seed

# Custom: more devices and data
python sync.py seed --devices 20 --days 30 --runs-per-day 20

# SQLite-only mode (no Spark required)
python seed.py
```

### Sync CLI Commands
```bash
python sync.py seed     # Generate demo data in Delta Lake
python sync.py pull     # Pull data from Delta → SQLite
python sync.py push     # Push labels from SQLite → Delta
python sync.py status   # Show sync status
```

## Architecture Overview

The labeler uses a **hybrid architecture** for fast local labeling with cloud persistence:

- **SQLite**: Local cache for fast UI operations and session state
- **Spark/Delta Lake**: Query engine for device discovery and label persistence
- **Lazy Cluster**: Spark starts on-demand, auto-shuts down after 3 minutes idle

### Session Flow

```
1. Launch Page → Select date range, query devices from Delta Lake
2. Create Session → Spark pulls runs/timeseries to SQLite cache, then stops
3. Labeling → Fast local queries (SQLite only), labels stored locally
4. Push → Spark starts, MERGEs labels to Delta Lake, session auto-clears
```

## Project Structure
```
backend/
├── app/
│   ├── main.py                    # FastAPI endpoints (labels, sessions, cluster)
│   ├── config.py                  # Environment settings
│   ├── models.py                  # Pydantic models
│   └── repositories/
│       ├── base.py                # Abstract interfaces
│       ├── sqlite_runs.py
│       ├── sqlite_labels.py
│       ├── sqlite_users_models.py
│       └── sqlite_sessions.py     # Session management
├── backends/sqlite/
│   ├── connection.py              # DB connection management
│   ├── schema.py                  # Schema initialization
│   ├── runs.py, labels.py         # Core repositories
│   └── sessions.py                # Session cache repository
├── sync/
│   ├── cluster.py                 # SparkClusterManager (lazy startup/timeout)
│   ├── pull.py                    # Delta → SQLite sync
│   ├── push.py                    # SQLite → Delta sync
│   └── delta_schema.py            # Delta table schemas
└── data/delta/                    # Delta Lake tables

frontend/src/
├── App.tsx                        # Main app with session management
├── components/
│   ├── SessionLaunchPage.tsx      # Session create/resume UI
│   ├── DeviceNavigator.tsx        # Multi-device session navigation
│   ├── ClusterIndicator.tsx       # Spark status indicator
│   ├── SessionBanner.tsx          # Active session status bar
│   ├── DeviceSelector.tsx         # Device filtering + Delta query
│   ├── TimeSeriesChart.tsx        # ECharts visualization
│   ├── LabelButtons.tsx           # Label selection
│   ├── RunNavigator.tsx           # Run navigation
│   └── StatusIndicator.tsx        # Label status display
├── hooks/
│   ├── useKeyboardNav.ts
│   └── useRunsData.ts
├── services/api.ts                # API client (cluster, sessions, labels)
└── types/index.ts
```

## API Endpoints

### Core
- `GET /api/devices?start_ts=&end_ts=` - List devices from SQLite
- `POST /api/runs/sample` - Sample unlabeled runs
- `GET /api/runs/{run_id}?model_type=` - Get run with timeseries
- `POST /api/labels` - Submit label vote
- `GET /api/labels/status/{run_id}?model_type=` - Get label status

### Cluster
- `GET /api/cluster/status` - Spark cluster status (off/starting/on)
- `POST /api/cluster/start` - Start Spark cluster manually
- `POST /api/cluster/touch` - Reset timeout (keep alive)

### Sessions
- `GET /api/sessions` - List saved sessions (max 3)
- `GET /api/sessions/{id}` - Get session details
- `POST /api/sessions/new` - Create new session (queries Delta)
- `DELETE /api/sessions/{id}` - Delete session and its labels
- `GET /api/sessions/{id}/progress` - Get session progress
- `POST /api/sessions/{id}/push` - Push labels to Delta Lake
- `GET /api/sessions/{id}/resume` - Resume session from cache

### Delta Query
- `GET /api/delta/devices?start_ts=&end_ts=` - Query devices from Delta Lake directly

## Database Schema

### Core Tables (SQLite)
- `rle_runs` - RLE segments to label
- `timeseries_data` - Time-series points
- `labels_votes` - Multi-labeler votes (with synced_at tracking)
- `devices` - Device cache
- `users` - Labeler names
- `model_types` - Model type definitions

### Session Tables (SQLite)
- `sessions` - Save states (max 3), tracks device_ids, date range, progress
- `session_runs` - Cached RLE runs per session
- `session_timeseries` - Cached timeseries per session

### Delta Lake Tables
- `rle_runs` - Partitioned by device_id
- `timeseries_data` - Partitioned by device_id
- `labels_votes` - Partitioned by model_type

## Keyboard Shortcuts

### Navigation & Labeling
- `←` / `→` or `T` / `G` - Navigate runs
- `N` - Jump to last run
- `1` / `2` / `3` - Label (Class A / Class B / Error)
- `Ctrl+Enter` - Load runs (when devices found in filter)

### Chart Controls
- `Q` / `E` - Slide time window
- `A` - Auto Scale (Y-axis follows visible data)
- `S` - Full Scale (Y-axis covers entire series)
- `C` - Colorblind mode (amber/blue palette)
- `R` - Reset view
- `Ctrl+Z` - Undo zoom

### Session
- `Space` / `Esc` - Early exit confirmation
- `Y` - Push to Delta (in modal)
- `N` - Save for later (in modal)
- `?` - Hotkey guide

## Session Management

### Save States (Max 3)
- Sessions persist across browser refreshes
- Each session tracks: devices, date range, progress, labels
- Progress colors: red (<70%), yellow (70-89%), green (90-100%)

### Multi-Device Sessions
- Load multiple devices in one session
- DeviceNavigator shows Available/Finished dropdowns
- Per-device progress tracking

### Push Workflow
1. User clicks "Push to Delta Lake"
2. Label verification polls until all labels synced
3. Spark starts if not running
4. MERGE into Delta labels_votes table
5. Session auto-clears on success

## Configuration

### Environment Variables

```bash
# Docker
LABELER_NAME=YourName      # Autofill labeler name (optional)
CORS_ORIGINS=*             # CORS configuration

# Spark (auto-configured)
DELTA_TABLE_PATH=./data/delta
SPARK_LOCAL_THREADS=4
SPARK_DRIVER_MEMORY=4g
```

### Cluster Timeout
- Spark auto-shuts down after 3 minutes idle
- Touch cluster endpoint resets timeout
- Status indicator shows countdown

## Development Notes
- **Docker**: nginx serves frontend on :80, proxies `/api/*` to backend:8000
- **Manual**: Vite dev server proxies `/api/*` to localhost:8000
- **WSL2**: Enable `networkingMode=mirrored` in `.wslconfig` for localhost access
- **API URLs**: Frontend uses relative paths (`/api/...`) - works in both modes
- **UTC**: All timestamps stored and displayed in UTC (pill shows local offset)
