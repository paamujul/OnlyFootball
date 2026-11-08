"""Who gets the ball, how often, and whether that changed over the season.

A season-total target share hides the thing a coach actually wants to know.
A receiver at 22% for the year could have been the WR1 all season, or a WR3 who
took over in week 10 when someone tore an ACL, and those are opposite reports.
So every share here is produced weekly first and the season total is a
by-product, and `trajectory` -- the weekly series plus a first-half/second-half
split -- is a first-class field rather than a drill-down.

Four denominators, deliberately not interchangeable:

  targets   plays where this player is the charted receiver / team pass plays
  carries   plays where this player is the charted rusher / team run plays
  snaps     snap_counts.offense_snaps / the team's offensive snaps that week
  routes    see the warning on `route_mix` below

The route caveat is the important one. `Play.route` is the route run by the
*targeted* receiver on that play -- there is one route per play, not one per
eligible receiver. It therefore cannot produce a route *share* (what fraction
of a team's routes a player ran); the participation data needed for that is not
in this database. What it can produce is a route *mix*: given that a player was
targeted, what was he running. That is a genuinely useful scouting number and a
completely different statistic, so it is named differently and carries its own
sample count.

snap_counts keys on `player_name`, not a gsis id, and ~6% of its names do not
match `players.name` exactly (suffixes, "George Karlaftis III"). Rather than
fuzzy-matching, unresolved rows keep their name and report player_id: null.

Unlike the other three modules in this package this one has no entry in
app/cache.py, because it has no league-wide reduction to cache. Every query
below is already scoped to one team and pushed into a GROUP BY, so a cold call
is ~130ms against the full backfill -- caching would add a stale-data window in
exchange for nothing.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import re

from sqlalchemy import Row, func, select
from sqlalchemy.orm import Session, aliased

from app.analytics.personnel import rate_table
from app.db.models import Game, Play, Player, SnapCount, Team

# A player must clear this to be named a "primary" receiver or the lead back.
# Below it the label is noise -- a 4%-share back on a committee is not a lead
# back and calling him one is worse than saying nothing.
PRIMARY_TARGET_SHARE = 0.15
LEAD_BACK_CARRY_SHARE = 0.40


def _play_usage(session: Session, team: str, season: int, phase: str) -> dict:
    """Weekly target / carry / route counts from the plays table.

    Aggregated in SQL: this is a pure GROUP BY over (week, player) and pulling
    ~1000 raw rows per team to count them in Python would be pointless work
    against a 250k-row table. Three passes rather than one because the grouping
    column differs (receiver / rusher) and a single query would need a UNION
    that reads no better than this.
    """
    def counts(id_col, play_type):
        return session.execute(
            select(Game.week, id_col, func.count().label("n"))
            .select_from(Play)
            .join(Game, Game.id == Play.game_id)
            .where(Game.season == season, Game.phase == phase,
                   Play.posteam == team, Play.play_type == play_type,
                   id_col.isnot(None))
            .group_by(Game.week, id_col)
        ).all()

    def team_totals(play_type):
        return dict(session.execute(
            select(Game.week, func.count())
            .select_from(Play)
            .join(Game, Game.id == Play.game_id)
            .where(Game.season == season, Game.phase == phase,
                   Play.posteam == team, Play.play_type == play_type)
            .group_by(Game.week)
        ).all())

    # play_type == "pass" here is load-bearing, not decoration: it has to match
    # the targets_by_player filter below or the ratio of the two exceeds 1.
    # nflverse charts a route on penalty-nullified plays, which carry
    # play_type "no_play" and are correctly absent from the target count. Five
    # such rows league-wide in 2023 were enough to report Andrew Beck's route
    # mix as 107.7% covered (14 routed plays over 13 targets).
    routes = session.execute(
        select(Play.receiver_id, Play.route, func.count())
        .join(Game, Game.id == Play.game_id)
        .where(Game.season == season, Game.phase == phase,
               Play.posteam == team, Play.play_type == "pass",
               Play.receiver_id.isnot(None), Play.route.isnot(None))
        .group_by(Play.receiver_id, Play.route)
    ).all()

    # Targets that were charted with a route at all, per player -- the
    # denominator that makes route_mix legible.
    targets_by_player = dict(session.execute(
        select(Play.receiver_id, func.count())
        .join(Game, Game.id == Play.game_id)
        .where(Game.season == season, Game.phase == phase,
               Play.posteam == team, Play.play_type == "pass",
               Play.receiver_id.isnot(None))
        .group_by(Play.receiver_id)
    ).all())

    route_mix: dict[str, Counter] = defaultdict(Counter)
    for pid, route, n in routes:
        route_mix[pid][route] += n

    return {
        "targets": counts(Play.receiver_id, "pass"),
        "carries": counts(Play.rusher_id, "run"),
        "team_pass": team_totals("pass"),
        "team_run": team_totals("run"),
        "route_mix": route_mix,
        "targets_by_player": targets_by_player,
    }


def _snap_usage(session: Session, team: str, season: int, phase: str) -> dict:
    """Weekly snap counts. Regular season only -- snap_counts has no phase column.

    The table is keyed (game_id, player_name, team) and carries its own
    `season`/`week`, so it is queried on those rather than joined to games.
    For a non-reg phase this simply returns nothing, which is honest: PFR does
    not publish preseason snap counts.
    """
    if phase != "reg":
        return {"rows": [], "team_off": {}, "team_def": {}, "available": False}

    rows = session.execute(
        select(SnapCount.week, SnapCount.player_name, SnapCount.position,
               SnapCount.offense_snaps, SnapCount.offense_pct,
               SnapCount.defense_snaps, SnapCount.defense_pct)
        .where(SnapCount.season == season, SnapCount.team == team)
    ).all()

    # A team's offensive snaps in a week is the max over its players, not the
    # sum: eleven players are on the field for each one.
    team_off: dict[int, int] = defaultdict(int)
    team_def: dict[int, int] = defaultdict(int)
    for r in rows:
        team_off[r.week] = max(team_off[r.week], r.offense_snaps or 0)
        team_def[r.week] = max(team_def[r.week], r.defense_snaps or 0)
    return {"rows": rows, "team_off": dict(team_off), "team_def": dict(team_def),
            "available": True}


def _series(weekly: dict[int, tuple[int, int]]) -> dict:
    """Weekly (hits, denominator) -> a share series plus a half-season split."""
    weeks = sorted(weekly)
    points = [{"week": w,
               "n": weekly[w][0],
               "of": weekly[w][1],
               "share": round(weekly[w][0] / weekly[w][1], 3) if weekly[w][1] else None}
              for w in weeks]
    # A single week has no halves. Splitting it anyway would report the same
    # number as both, and a trend of exactly 0.0 for a player with one game --
    # which reads as "stable" and is the opposite of what the data says.
    if len(weeks) < 2:
        return {"weeks": points, "first_half": None, "second_half": None,
                "trend": None}
    mid = len(weeks) // 2

    def half(ws):
        hits = sum(weekly[w][0] for w in ws)
        of = sum(weekly[w][1] for w in ws)
        return round(hits / of, 3) if of else None

    first, second = half(weeks[:mid]), half(weeks[mid:])
    trend = (round(second - first, 3)
             if first is not None and second is not None else None)
    return {"weeks": points, "first_half": first, "second_half": second,
            "trend": trend}


_NICKNAMES = {
    "matt": "matthew", "matthew": "matthew",
    "josh": "joshua", "joshua": "joshua",
    "dan": "daniel", "danny": "daniel", "daniel": "daniel",
    "mitch": "mitchell", "mitchell": "mitchell",
    "mike": "michael", "michael": "michael",
    "chris": "christopher", "christopher": "christopher",
    "zach": "zachary", "zack": "zachary", "zachary": "zachary",
    "alex": "alexander", "alexander": "alexander",
    "sam": "samuel", "samuel": "samuel",
    "will": "william", "william": "william",
    "rob": "robert", "bob": "robert", "robert": "robert",
    "tom": "thomas", "tommy": "thomas", "thomas": "thomas",
    "dave": "david", "david": "david",
    "ken": "kenneth", "kenneth": "kenneth",
    "tim": "timothy", "timothy": "timothy",
    "gabe": "gabriel", "gabriel": "gabriel",
    "jeff": "jeffrey", "jeffrey": "jeffrey",
    "jake": "jacob", "jacob": "jacob",
    "nick": "nicholas", "nicholas": "nicholas",
    "tony": "anthony", "anthony": "anthony",
    "pat": "patrick", "patrick": "patrick",
    "drew": "andrew", "andrew": "andrew",
    "joe": "joseph", "joseph": "joseph",
    "bryan": "brian", "brian": "brian",
}


def _norm_name(name: str) -> str:
    """Normalize player name by stripping suffixes, punctuation, and aligning common nicknames."""
    s = name.lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    s = re.sub(r"['\.\-]", "", s)
    parts = s.split()
    if not parts:
        return ""
    first = _NICKNAMES.get(parts[0], parts[0])
    return " ".join([first] + parts[1:])


def _espn_to_gsis(session: Session, ids: set[str]) -> dict[str, str]:
    """Map ESPN-style player ids (``espn:XXXXX``) to their canonical gsis id.

    Players ingested from ESPN land in the ``players`` table with
    ``id = 'espn:{espn_id}'``.  Separately, the nflverse backfill inserts the
    same person with a gsis id (``00-XXXXXXX``).  Plays from each source carry
    the respective id in ``receiver_id`` / ``rusher_id``, so a single person
    ends up looking like two unless we map one form to the other.

    Matches exact name and team first, then falls back to normalized name
    (handling suffixes like Jr./III, punctuation, and common nickname variants).
    Returns a dict **only** for ESPN ids that have a gsis counterpart.
    """
    espn_ids = {pid for pid in ids if pid.startswith("espn:")}
    if not espn_ids:
        return {}

    EspnPlayer = aliased(Player)
    GsisPlayer = aliased(Player)

    # 1. Exact name match on same team (or where one team is null)
    rows = session.execute(
        select(EspnPlayer.id, GsisPlayer.id)
        .where(
            EspnPlayer.id.in_(espn_ids),
            GsisPlayer.name == EspnPlayer.name,
            (GsisPlayer.team == EspnPlayer.team) | GsisPlayer.team.is_(None) | EspnPlayer.team.is_(None),
            ~GsisPlayer.id.startswith("espn:"),
        )
    ).all()
    mapping: dict[str, str] = {espn_id: gsis_id for espn_id, gsis_id in rows}

    # 2. For any remaining ESPN ids, attempt normalized name matching
    unresolved = espn_ids - set(mapping)
    if unresolved:
        unresolved_players = session.execute(
            select(Player.id, Player.name, Player.team)
            .where(Player.id.in_(unresolved))
        ).all()
        teams = {p.team for p in unresolved_players if p.team}
        gsis_query = select(Player.id, Player.name, Player.team).where(~Player.id.startswith("espn:"))
        if teams:
            gsis_query = gsis_query.where((Player.team.in_(teams)) | Player.team.is_(None))
        gsis_cands = session.execute(gsis_query).all()

        norm_to_gsis: dict[tuple[str, str | None], str] = {}
        for g in gsis_cands:
            norm_to_gsis[(_norm_name(g.name), g.team)] = g.id
            if g.team:
                norm_to_gsis[(_norm_name(g.name), None)] = g.id

        for ep in unresolved_players:
            nname = _norm_name(ep.name)
            gid = norm_to_gsis.get((nname, ep.team)) or norm_to_gsis.get((nname, None))
            if gid:
                mapping[ep.id] = gid

    return mapping


def _resolve_names(session: Session, ids: set[str]) -> dict[str, Row]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {p.id: p for p in session.execute(
        select(Player.id, Player.name, Player.position, Player.headshot)
        .where(Player.id.in_(ids))
    ).all()}


def _name_to_id(session: Session, team: str, names: set[str]) -> dict[str, str]:
    """Best-effort snap_counts name -> gsis id. Unmatched names stay unmatched.

    When a name resolves to both a gsis id and an ``espn:`` id, the gsis id is
    preferred so that snap data joins cleanly against the canonicalised play
    ids. Supports normalized name matching for suffixes (e.g. 'Jr.', 'III').
    """
    if not names:
        return {}
    all_team_players = session.execute(
        select(Player.name, Player.id)
        .where(Player.team == team)
    ).all()

    exact_map: dict[str, str] = {}
    norm_map: dict[str, str] = {}
    for name, pid in all_team_players:
        if name not in exact_map or exact_map[name].startswith("espn:"):
            exact_map[name] = pid
        n = _norm_name(name)
        if n not in norm_map or norm_map[n].startswith("espn:"):
            norm_map[n] = pid

    out: dict[str, str] = {}
    for name in names:
        if name in exact_map:
            out[name] = exact_map[name]
        else:
            n = _norm_name(name)
            if n in norm_map:
                out[name] = norm_map[n]
    return out


def team_usage(session: Session, team: str, season: int, phase: str) -> dict:
    plays = _play_usage(session, team, season, phase)
    snaps = _snap_usage(session, team, season, phase)

    # Build an espn:XXXXX → gsis-id map so the same physical player is counted
    # once regardless of which source the play came from.
    raw_ids: set[str] = set()
    for _, pid, _ in plays["targets"]:
        raw_ids.add(pid)
    for _, pid, _ in plays["carries"]:
        raw_ids.add(pid)
    canon = _espn_to_gsis(session, raw_ids)   # only ESPN ids that resolved
    def _c(pid: str) -> str:
        """Return the canonical (gsis) id for *pid*."""
        return canon.get(pid, pid)

    tgt: dict[str, dict[int, tuple[int, int]]] = defaultdict(dict)
    for week, pid, n in plays["targets"]:
        cpid = _c(pid)
        prev = tgt[cpid].get(week, (0, 0))
        # Counts from both source ids are additive; the denominator (team pass
        # plays) is the same for the week so take the max rather than summing.
        tgt[cpid][week] = (prev[0] + n, max(prev[1], plays["team_pass"].get(week, 0)))
    car: dict[str, dict[int, tuple[int, int]]] = defaultdict(dict)
    for week, pid, n in plays["carries"]:
        cpid = _c(pid)
        prev = car[cpid].get(week, (0, 0))
        car[cpid][week] = (prev[0] + n, max(prev[1], plays["team_run"].get(week, 0)))

    snap_weekly: dict[str, dict[int, tuple[int, int]]] = defaultdict(dict)
    snap_meta: dict[str, dict] = {}
    for r in snaps["rows"]:
        if not r.offense_snaps:
            continue
        snap_weekly[r.player_name][r.week] = (r.offense_snaps,
                                              snaps["team_off"].get(r.week, 0))
        snap_meta.setdefault(r.player_name, {"position": r.position})

    ids = set(tgt) | set(car)
    people = _resolve_names(session, ids)
    by_name = _name_to_id(session, team, set(snap_weekly))
    id_to_snapname = {v: k for k, v in by_name.items()}

    season_pass = sum(plays["team_pass"].values())
    season_run = sum(plays["team_run"].values())

    # Merge route_mix and targets_by_player through the same canonical mapping.
    merged_route_mix: dict[str, Counter] = defaultdict(Counter)
    for pid, ctr in plays["route_mix"].items():
        merged_route_mix[_c(pid)] += ctr
    merged_targets_by_player: dict[str, int] = defaultdict(int)
    for pid, n in plays["targets_by_player"].items():
        merged_targets_by_player[_c(pid)] += n

    players = []
    for pid in ids:
        p = people.get(pid)
        t_total = sum(v[0] for v in tgt.get(pid, {}).values())
        c_total = sum(v[0] for v in car.get(pid, {}).values())
        snap_name = id_to_snapname.get(pid)
        mix = merged_route_mix.get(pid, Counter())
        tbp = merged_targets_by_player.get(pid, 0)
        players.append({
            "player_id": pid,
            "name": p.name if p else pid,
            "position": p.position if p else None,
            "headshot": p.headshot if p else None,
            "targets": t_total,
            "target_share": round(t_total / season_pass, 3) if season_pass else None,
            "carries": c_total,
            "carry_share": round(c_total / season_run, 3) if season_run else None,
            "target_trajectory": _series(tgt.get(pid, {})),
            "carry_trajectory": _series(car.get(pid, {})),
            "snap_trajectory": (_series(snap_weekly[snap_name])
                                if snap_name in snap_weekly else None),
            "snap_share": (round(
                sum(v[0] for v in snap_weekly[snap_name].values())
                / max(1, sum(v[1] for v in snap_weekly[snap_name].values())), 3)
                if snap_name in snap_weekly else None),
            # Route MIX, not route share -- Play.route is the targeted
            # receiver's route, so the denominator is this player's charted
            # targets, not the team's routes. See the module docstring.
            "route_mix": {
                "mix": rate_table(mix)[:10],
                "n": sum(mix.values()),
                "coverage": (round(sum(mix.values()) / max(1, tbp), 3)
                             if tbp else None),
            },
        })

    players.sort(key=lambda r: (-(r["targets"] + r["carries"]), r["name"]))

    primary = [r for r in players
               if (r["target_share"] or 0) >= PRIMARY_TARGET_SHARE]
    backs = [r for r in players if (r["carry_share"] or 0) >= LEAD_BACK_CARRY_SHARE]

    # Players who took snaps but never touched the ball -- linemen, blocking
    # tight ends. Reported separately so the main list stays about usage.
    unresolved = sorted(n for n in snap_weekly if n not in by_name)

    t = session.get(Team, team)
    return {
        "team": {"abbr": team, "name": t.name if t else team,
                 "color": t.color if t else None, "logo": t.logo if t else None},
        "season": season, "phase": phase,
        "team_pass_plays": season_pass,
        "team_run_plays": season_run,
        "snap_counts_available": snaps["available"],
        "players": players,
        "primary_receivers": [
            {"player_id": r["player_id"], "name": r["name"],
             "target_share": r["target_share"], "trend": r["target_trajectory"]["trend"]}
            for r in sorted(primary, key=lambda r: -(r["target_share"] or 0))[:3]
        ],
        "lead_back": (
            {"player_id": backs[0]["player_id"], "name": backs[0]["name"],
             "carry_share": backs[0]["carry_share"],
             "trend": backs[0]["carry_trajectory"]["trend"]}
            if backs else None
        ),
        "backfield_is_committee": not backs and season_run > 0,
        "snap_names_unresolved": unresolved,
    }
