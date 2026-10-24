# NFL Analytics — Frontend

The web user interface for NFL Analytics, built with **React 19**, **TypeScript**, and **Vite**, with charts powered by **Recharts** and custom SVG field visualizations.

---

## Getting Started

### Prerequisites

- **Node.js**: v18.0+ or v20+ (Node 22 pinned in `.nvmrc`)
- **npm**: v9+ (or corepack pnpm / yarn)
- **NFL Analytics Backend**: Running locally on `http://localhost:8600` (see root [README](../README.md))

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Run the Development Server

```bash
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.

Vite is configured (`vite.config.ts`) to automatically proxy any request starting with `/api` to the local backend at `http://localhost:8600`.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the local dev server with Hot Module Replacement (HMR) at `http://localhost:5173` |
| `npm run build` | Type-checks with `tsc -b` and bundles production assets into `dist/` |
| `npm run preview` | Previews the production build locally |
| `npm run lint` | Runs `oxlint` across TypeScript and React code |

---

## Project Structure

```
frontend/
├── src/
│   ├── api.ts              # Typed API client interfacing with FastAPI backend (/api/*)
│   ├── App.tsx             # Root component with routing, season/phase state, and layout
│   ├── main.tsx            # React application entry point
│   ├── index.css           # Global typography, color variables, and layout styles
│   ├── components/         # Shared UI components
│   │   ├── Header.tsx      # Top navigation and phase/season switcher
│   │   ├── LiveBanner.tsx  # Ingestion status and live gameday banner
│   │   └── ...
│   └── pages/              # Application views
│       ├── TeamsPage.tsx       # League & team yardage, rushing/passing splits
│       ├── TeamDetailPage.tsx  # Single team roster, game schedule, trends
│       ├── PlayerPage.tsx      # Player quarter-by-quarter splits & route charts
│       ├── ComparePage.tsx     # Head-to-head team metrics with league percentiles
│       ├── DefenseLabPage.tsx  # Defensive profile, blitz rates, combo impact
│       └── CoachPage.tsx       # Coaching tendencies, play-calling model predictions
├── public/                 # Static public assets
├── vite.config.ts          # Vite configuration with /api proxy to localhost:8600
└── package.json
```

---

## Connecting to Backend

All data requests use relative paths starting with `/api` (configured in [`src/api.ts`](src/api.ts)).
- In development: Vite proxies `/api` to `http://localhost:8600`.
- In single-origin production mode: FastAPI serves `frontend/dist` directly, so `/api` calls resolve same-origin with zero CORS configuration.
