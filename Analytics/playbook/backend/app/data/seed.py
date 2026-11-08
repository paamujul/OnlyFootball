"""First-boot seeding and the daily nflverse refresh.

A fresh deploy starts with an empty volume. Rather than requiring a manual
backfill over SSH, the app seeds itself in a background thread: nflverse for
the completed validation season, ESPN for the live season's phases. Progress
lands in sync_log, so /api/status shows what's happening.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.config import SEED_SEASONS
from app.db.models import Game, SyncLog
from app.db.session import db_session

log = logging.getLogger("seed")

_lock = threading.Lock()
_running = False


def database_is_empty() -> bool:
    with db_session() as s:
        return not s.scalar(select(func.count(Game.id)))


def _log(scope: str, status: str, message: str | None = None, rows: int | None = None):
    with db_session() as s:
        s.add(SyncLog(source="seed", scope=scope, status=status, message=message, rows=rows))


def _seed() -> None:
    """Blocking full backfill — always run this on a worker thread."""
    global _running
    from app.data.ingest import backfill_phase
    from app.data.nflverse_source import backfill_season

    try:
        _log("startup", "ok", message="seeding started")

        # live season first: ESPN preseason is small and makes the app useful fast
        live_season = max(SEED_SEASONS)
        for phase, weeks in (("pre", range(1, 5)), ("reg", range(1, 19)), ("post", range(1, 5))):
            try:
                out = asyncio.run(backfill_phase(live_season, phase, weeks))
                _log(f"espn {live_season} {phase}", "ok", rows=out["games_ingested"])
            except Exception as e:
                log.warning("seed espn %s %s failed: %s", live_season, phase, e)
                _log(f"espn {live_season} {phase}", "error", message=str(e))

        # then the deep nflverse history (large download, several minutes)
        for season in SEED_SEASONS:
            try:
                out = backfill_season(season)
                _log(f"nflverse {season}", "ok", rows=out.get("plays"))
            except Exception as e:
                log.warning("seed nflverse %s failed: %s", season, e)
                _log(f"nflverse {season}", "error", message=str(e))

        _log("startup", "ok", message="seeding complete")
    finally:
        with _lock:
            _running = False


def sync_snap_counts_if_behind(season: int | None = None) -> bool:
    """Sync snap counts if they are behind completed regular season games."""
    from app.data.nflverse_source import sync_snap_counts
    from app.db.models import SnapCount

    if season is None:
        season = max(SEED_SEASONS)

    with db_session() as s:
        max_game_week = s.scalar(
            select(func.max(Game.week)).where(Game.season == season, Game.phase == "reg", Game.status == "final")
        )
        max_snap_week = s.scalar(
            select(func.max(SnapCount.week)).where(SnapCount.season == season)
        )

    if max_game_week and (max_snap_week is None or max_snap_week < max_game_week):
        log.info("snap_counts for %s is at week %s, behind played games (week %s) - syncing",
                 season, max_snap_week, max_game_week)
        try:
            sync_snap_counts(season)
            return True
        except Exception as e:
            log.warning("failed to sync snap counts for %s: %s", season, e)
            return False
    return False


def start_seed_if_needed() -> bool:
    """Kick off seeding on a daemon thread when the DB has no games yet."""
    global _running
    with _lock:
        if _running:
            return False
        if not database_is_empty():
            # If the DB is already seeded, check if live snap counts need a catch-up
            threading.Thread(target=sync_snap_counts_if_behind, name="snap-catchup", daemon=True).start()
            return False
        _running = True
    threading.Thread(target=_seed, name="seed", daemon=True).start()
    log.info("database empty — seeding in background")
    return True


def refresh_nflverse(season: int) -> int:
    """Refresh the live season's nflverse data. Returns the number of failed steps.

    Runs synchronously -- deployment invokes this as its own scheduled job
    (`python -m app.cli refresh-nflverse`), which replaced the fire-and-forget
    daemon thread the live poller used to spawn. A one-shot job would have
    exited out from under that thread mid-download.
    """
    from app.data.nflverse_source import backfill_season
    try:
        out = backfill_season(season)
        failed = out.get("failed", 0)
        _log(f"nflverse refresh {season}", "error" if failed else "ok",
             rows=out.get("plays"),
             message=f"{failed} step(s) failed" if failed else None)
        return failed
    except Exception as e:
        log.warning("nflverse refresh %s failed: %s", season, e)
        _log(f"nflverse refresh {season}", "error", message=str(e)[:300])
        return 1


def prune_sync_log(keep_days: int = 30) -> int:
    """Drop sync_log rows older than keep_days, returning how many went.

    The poller writes a handful of rows per cycle and nothing ever cleaned up,
    so this table grew without bound -- roughly 5,700 rows a day during games.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_days)).isoformat()
    with db_session() as s:
        return s.execute(delete(SyncLog).where(SyncLog.created_at < cutoff)).rowcount
