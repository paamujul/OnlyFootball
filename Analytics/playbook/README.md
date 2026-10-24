# NFL Analytics

A live NFL analytics web application: team yardage dashboards, player quarter-by-quarter breakdowns, route charts, team comparison, defensive identity profiles, and on-field player-combination impact analysis.

Designed to run **100% locally** with a **React + Vite** frontend and a **FastAPI + SQLite** backend. All data is served directly from a zero-configuration local SQLite database with WAL mode enabled.

---

## Features

- **Teams Dashboard** — View total passing, rushing, and receiving yards for any season and phase (preseason, regular season, postseason), per-game trends, and comprehensive player stat tables.
- **Player Pages & Splits** — Quarter-by-quarter performance breakdowns (yards, EPA/play, success rate, and "best quarter" callout) across full seasons or individual games.
- **Route & Target Charts** — Every target overlaid on an interactive field graphic with frequent and successful zones highlighted, air yards, and YAC (yards after catch) tails.
- **Team Comparison** — Side-by-side offense and defense comparison across all key metrics mapped to league-wide percentiles.
- **Defense Lab** — Defensive identity profiles (blitz tendencies, run defense efficiency, passing vulnerability) calculated from EPA allowed, pressure/sack rates, and FTN charting data.
- **Lineup Impact** — Evaluate how opponent play selection and efficiency shifts when specific defensive or offensive player groupings are on the field.
- **Live Gameday Ingestion** — Background polling service that queries ESPN scores and play-by-play, idempotently updates local storage, and displays a live gameday banner in the UI.

---

## Architecture & Stack

- **Frontend**: React 19, TypeScript, Vite, Recharts, and custom SVG field charts.
  - Proxies `/api` requests to `http://localhost:8600` during development.
- **Backend**: FastAPI, SQLAlchemy, SQLite (stored locally at `backend/storage/nfl.db` with WAL mode enabled), polars, nflreadpy, and httpx.
- **Data Feeds**:
  - [nflverse](https://github.com/nflverse) via `nflreadpy`: Play-by-play (EPA, success rates, air yards, directions), rosters, schedules, and participation data.
  - ESPN API (public): Preseason and live gameday box scores and play sequences.

---

## Prerequisites

Before running the application locally, ensure you have the following installed:

- **Python 3.11+** or **3.12+**
- **Node.js 18.0+** or **20+** (Node 22 is recommended and pinned in `frontend/.nvmrc`)
- **Git**

---

## Quick Start (Run Locally)

Running the application requires two terminal windows: one for the backend API and one for the frontend UI.

### Step 1: Set Up and Run the Backend

In your first terminal:

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows use: .venv\Scripts\activate

# 3. Install backend dependencies
pip install -r requirements.txt

# 4. Ingest baseline validation data (2025 season + 2026 preseason)
python -m app.cli backfill-nflverse 2025
python -m app.cli backfill-espn 2026 pre

# 5. Start the FastAPI backend server
python -m uvicorn app.main:app --port 8600 --reload
```

The backend is now live at **`http://localhost:8600`**.
You can verify the API is running by visiting `http://localhost:8600/docs` in your browser.

> [!TIP]
> All data is persisted to `backend/storage/nfl.db`. You only need to run the `backfill-*` commands once. Subsequent runs will immediately start using your existing local database.

---

### Step 2: Set Up and Run the Frontend

In your second terminal:

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install Node dependencies
npm install

# 3. Start the Vite development server
npm run dev
```

Open your browser and navigate to:
👉 **`http://localhost:5173`**

The frontend will automatically proxy all `/api` requests to your local backend at port 8600.

---

## Optional: Run Everything on a Single Port

If you prefer to serve the application from a single process instead of running two separate dev servers, you can build the frontend into static assets:

```bash
# In frontend/:
npm run build

# In backend/:
# FastAPI automatically detects and serves the built bundle from frontend/dist
python -m uvicorn app.main:app --port 8600
```

Now open **`http://localhost:8600`** in your browser to access both the frontend SPA and backend API together on a single port.

---

## Testing & Validation

### Backend Tests

Run the full pytest suite (138 tests covering schema migrations, API routes, data normalizers, and statistical accuracy):

```bash
cd backend
.venv/bin/pytest tests -q
```

### Frontend Typecheck & Lint

Verify frontend TypeScript types and run the linter:

```bash
cd frontend
npm run lint
npm run build
```

---

## Data Backfill Options

The backend CLI provides commands to ingest additional seasons or refresh live feeds:

```bash
cd backend
source .venv/bin/activate

# Backfill complete historical seasons (2021-2025)
python -m app.cli backfill-nflverse 2024

# Backfill ESPN preseason / regular season for a given year
python -m app.cli backfill-espn 2026 reg

# Check coaching staff data coverage
python -m app.cli coaches-review
```

---

## Notes & Limitations

- **Route Charts**: Reconstructed from play outcome vectors (direction, air yards, catch point, and YAC), as proprietary NFL tracking sensor data is not publicly distributed.
- **Preseason EPA**: Preseason plays do not feature public Expected Points Added (EPA) model outputs, so preseason metrics display raw yardage and success rates.
