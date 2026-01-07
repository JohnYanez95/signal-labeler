# Signal Labeler - Frontend

React + TypeScript + Vite frontend for the signal labeling application.

## Architecture

### State Management Flow

```mermaid
flowchart TB
    subgraph UserActions["User Actions"]
        Label["Press 1/2/3"]
        Nav["Press ←/→"]
        Refresh["Page Refresh"]
        Resume["Click Resume"]
    end

    subgraph LocalState["React State (App.tsx)"]
        runs["runs[]"]
        userLabels["userLabels Map"]
        currentIndex["currentIndex"]
    end

    subgraph Persist["Persistence"]
        LS["localStorage"]
        API["Backend API"]
    end

    Label --> userLabels
    userLabels -->|"POST /api/labels"| API
    userLabels -->|"Auto-save"| LS

    Nav --> currentIndex
    currentIndex -->|"Auto-save"| LS

    Refresh -->|"Read"| LS
    LS -->|"Restore"| LocalState

    Resume -->|"GET /sessions/resume"| API
    API -->|"Rebuild"| LocalState
```

### Component Hierarchy

```mermaid
flowchart TB
    App["App.tsx<br/>(Main State)"]

    App --> SL["SessionLaunchPage<br/>(Session picker)"]
    App --> SB["SessionBanner<br/>(Progress bar)"]
    App --> DN["DeviceNavigator<br/>(Device switcher)"]
    App --> RN["RunNavigator<br/>(Run pagination)"]
    App --> TSC["TimeSeriesChart<br/>(ECharts)"]
    App --> LB["LabelButtons<br/>(1/2/3)"]
    App --> SI["StatusIndicator<br/>(Label status)"]

    subgraph State["Shared State"]
        runs["runs[]"]
        userLabels["userLabels"]
        currentIndex["currentIndex"]
    end

    App -.->|"props"| DN
    App -.->|"props"| RN
    App -.->|"props"| TSC
    App -.->|"props"| LB
```

### Label Flow

```mermaid
sequenceDiagram
    participant U as User
    participant LB as LabelButtons
    participant App as App.tsx
    participant API as Backend
    participant LS as localStorage

    U->>LB: Press "1" (Class A)
    LB->>App: handleLabel(0)
    App->>App: userLabels.set(run_id, 0)
    App->>API: POST /api/labels
    App->>LS: Save session state
    App->>App: Auto-advance to next run
    API-->>App: {success: true}
```

## Setup

Install dependencies:
```bash
npm install
```

## Development

Start dev server:
```bash
npm run dev
```

Runs at `http://localhost:5173`

## Build

Production build:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Environment Variables

Create a `.env` file:
```
VITE_API_BASE_URL=http://localhost:8000
```

## Components

- **DeviceSelector**: Device and session configuration
- **RunNavigator**: Navigation and progress tracking
- **TimeSeriesChart**: ECharts visualization
- **LabelButtons**: Label selection UI
- **StatusIndicator**: Shows label status

## Hooks

- **useKeyboardNav**: Keyboard shortcuts handler
- **useRunsData**: Data fetching and state management

## Keyboard Shortcuts

- **← (Left)**: Previous run
- **→ (Right)**: Next run
- **0**: Class A label
- **1**: Class B label
- **2**: Invalid label
