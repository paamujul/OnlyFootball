# Plan: "Red-Zone" tab (heat map restricted to the red zone)

## Context
The Heat map tab (`/heatmap`, `frontend/src/pages/HeatmapPage.tsx`) shows, per upcoming matchup, where each offense attacks each defense (pass zones, run gaps, trails, hover tables). Add a second tab, **Red-Zone**, that works the same way but only uses plays inside the opponent 20-yard line. All paths are relative to `Analytics/playbook/`. Git root is two levels up.

## Global Constraints
- **Scope:** matchup page only (A vs B, two maps). Do NOT change the Coaching tab or `SingleTeamHeatmap`.
- **Red zone** = `Play.yardline_100 IS NOT NULL AND Play.yardline_100 <= 20` (matches `_field_zone` in `backend/app/analytics/playbook.py:80`).
- **Default sample window 16 games**; the select offers 8, 16 and Full season.
- **Separate endpoint** `GET /heatmap/redzone/matchup?teamA&teamB&season&phase&games=16`, same `Cache-Control: public, max-age=300` as the other heatmap routes. Reuse `/heatmap/upcoming`. Do not add a flag to the existing routes.
- **No behaviour change to `/heatmap`**: default arguments must keep today's output byte-for-byte.
- Reuse existing code; do not duplicate aggregation. No new dependencies. No commit trailers mentioning Claude/AI (commits are authored by the user alone).
- Backend tests: `cd backend && ./playbook_venv/bin/python -m pytest` (the venv lives in the main checkout at `/Users/sainathagoudpaamujula/Desktop/OnlyFootball/Analytics/playbook/backend/playbook_venv`; use it by absolute path from the worktree's `backend/`). Frontend: symlink `frontend/node_modules` to the main checkout's, then `npm run lint && npm run build` must stay at 0 errors (existing warnings are fine).

### Task 1: Backend red-zone filter, endpoint and tests
Files: `backend/app/analytics/heatmap.py`, `backend/app/api/routes.py`, `backend/tests/test_heatmap.py`.
- `team_field_heatmap` (~line 76): add `red_zone: bool = False`. When true, add `Play.yardline_100.is_not(None)` and `Play.yardline_100 <= 20` to both the offense and defense `.where()` clauses (~lines 109-120).
- `matchup_heatmap` (~line 489): add `red_zone: bool = False`, passed to both `team_field_heatmap` calls.
- Add `yardline_100` to the dicts built by `_build_pass_vectors` (~283) and `_build_run_vectors` (~398) (always included; extra key is harmless).
- Routes (`routes.py` ~125-149): add `GET /heatmap/redzone/matchup` calling `matchup_heatmap(..., red_zone=True)`, default `games=16`, same cache header and error handling as `/heatmap/matchup`.
- Tests (add to `test_heatmap.py`, extend the fixture as needed without breaking existing tests): plays with `yardline_100` = 8, 20, 21 and `None`; assert `red_zone=True` keeps only 8 and 20 on both offense and defense, `red_zone=False` still returns all; a `matchup_heatmap(..., red_zone=True)` test; a route test for `/heatmap/redzone/matchup` (use the FastAPI test client pattern from `backend/tests/test_api.py`).
- Do not touch `calculate_favorability`.

### Task 2: Frontend API client and zoomed field scale
Files: `frontend/src/api.ts`, `frontend/src/components/FieldHeatmap.tsx`.
- `api.ts` (~line 557): add `redzoneMatchup(teamA, teamB, season, phase, games = 16)` returning `MatchupHeatmap`, mirroring `heatmapMatchup`; add optional `yardline_100?: number | null` to the pass and run vector types (~line 379).
- `FieldHeatmap.tsx`: add optional prop `redZone?: boolean` to `MatchupFieldHeatmap` (~line 212). When set, use a zoomed field scale: depth clamped to 0-20 (instead of -10-45), `PX_PER_YD` about 16 (instead of 7.6), yard lines at 0, 5, 10, 15, 20 with the top line labelled "GOAL", `ZONE_BOXES` (~33-44) and `GAP_BAND_Y` (~61) re-spaced for the zoomed depth, and pass/run trails capped at the goal line using `yardline_100` when present. Implement as one `fieldScale` object chosen from the prop and used by `depthY` and the yard-line/hash arrays so the default (full-field) rendering is unchanged. Keep Both/Pass/Run views, hover tables, locked inspector, TD markers and linked hover working. Show an "N red-zone plays" count on each map and an empty state when a side has fewer than 5 plays.
- Do not edit `SingleTeamHeatmap` (~line 1158).

### Task 3: Red-Zone page, route and nav
Files: `frontend/src/pages/HeatmapPage.tsx`, new `frontend/src/pages/RedZonePage.tsx` (plus a shared shell component under `frontend/src/components/` if extracted), `frontend/src/main.tsx`, `frontend/src/App.tsx`.
- Extract the shared page shell from `HeatmapPage.tsx` (upcoming bar, team selects, swap, sample-window select, legend, the two `MatchupFieldHeatmap`s) into a component taking `{ fetchMatchup, redZone, title, defaultWindow }`; `HeatmapPage` and `RedZonePage` become thin wrappers (Heat map keeps default window 4 and `api.heatmapMatchup`; Red-Zone uses 16, `api.redzoneMatchup`, `redZone`). Heat map behaviour must be unchanged.
- `main.tsx` (~line 28): add `{ path: 'red-zone', element: <RedZonePage /> }`.
- `App.tsx` (~line 67): add `<NavLink to="/red-zone" ...>Red-Zone</NavLink>` after "Heat map", same `className` pattern.

### Task 4: Verification (no code unless a defect is found)
- Run backend tests, `npm run lint`, `npm run build`.
- Start backend and Vite locally against a seeded local DB if one exists; check `/api/heatmap/redzone/matchup?teamA=MIA&teamB=DET&season=2025&phase=reg` returns plays with `yardline_100 <= 20` only and fewer plays than `/heatmap/matchup`, and `/heatmap/matchup` output is unchanged.
- Report anything that cannot be verified (no browser available means UI is unverified: say so).
