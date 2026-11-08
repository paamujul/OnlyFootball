"""Field Heatmap analytics: Offense & Defense tendencies and Matchup Overlays.

Visualizes passing (directions, depths, YAC) and rushing (gaps, yards gained, stop points)
for single teams (offense & defense) and overlays offense vs defense for matchups with
net favorability scoring.
"""
from __future__ import annotations

from typing import Any
from sqlalchemy import select, or_, and_, desc
from sqlalchemy.orm import Session

from app.db.models import Game, Play, Player, Team

PASS_ZONES = [
    ("left", "short", "Left Short"),
    ("middle", "short", "Middle Short"),
    ("right", "short", "Right Short"),
    ("left", "deep", "Left Deep"),
    ("middle", "deep", "Middle Deep"),
    ("right", "deep", "Right Deep"),
]

RUN_GAPS = [
    ("left end", "left", "end", "Left End"),
    ("left tackle", "left", "tackle", "Left Tackle"),
    ("left guard", "left", "guard", "Left Guard"),
    ("middle", "middle", None, "Middle"),
    ("right guard", "right", "guard", "Right Guard"),
    ("right tackle", "right", "tackle", "Right Tackle"),
    ("right end", "right", "end", "Right End"),
]

DEPTH_DEFAULT = {"short": 6.0, "deep": 22.0}


def normalize_run_gap(location: str | None, gap: str | None) -> str:
    """Map raw pbp location/gap to one of the 7 standard run gaps."""
    if location == "left":
        if gap == "end":
            return "left end"
        if gap == "tackle":
            return "left tackle"
        return "left guard"
    elif location == "right":
        if gap == "end":
            return "right end"
        if gap == "tackle":
            return "right tackle"
        return "right guard"
    elif location == "middle":
        return "middle"
    elif gap in ("guard", "tackle", "end"):
        return f"middle {gap}" if gap == "guard" else f"left {gap}"
    return "middle"


def get_recent_games(session: Session, team: str, season: int, phase: str, n: int = 4) -> list[Game]:
    """Return the last `n` completed games for a team in (season, phase)."""
    q = (
        select(Game)
        .where(
            Game.season == season,
            Game.phase == phase,
            Game.status == "final",
            or_(Game.home_team == team, Game.away_team == team),
        )
        .order_by(desc(Game.week), desc(Game.kickoff))
        .limit(n)
    )
    games = session.scalars(q).all()
    # Sort chronologically for sample progression
    return sorted(games, key=lambda g: g.week)


def team_field_heatmap(session: Session, team: str, season: int, phase: str, last_n_games: int = 4) -> dict[str, Any]:
    """Build field heatmap data for a single team's offense and defense."""
    team_obj = session.get(Team, team)
    recent = get_recent_games(session, team, season, phase, last_n_games)
    game_ids = [g.id for g in recent]

    sample_meta = []
    for g in recent:
        is_home = g.home_team == team
        opp = g.away_team if is_home else g.home_team
        my_score = g.home_score if is_home else g.away_score
        opp_score = g.away_score if is_home else g.home_score
        sample_meta.append({
            "game_id": g.id,
            "week": g.week,
            "opponent": opp,
            "is_home": is_home,
            "team_score": my_score,
            "opp_score": opp_score,
        })

    if not game_ids:
        return {
            "team": {"abbr": team, "name": team_obj.name if team_obj else team,
                     "color": team_obj.color if team_obj else "#2a78d6",
                     "color2": team_obj.color2 if team_obj else "#eb6834",
                     "logo": team_obj.logo if team_obj else None},
            "sample_games": [],
            "offense": {"passing": {"zones": [], "plays": []}, "rushing": {"gaps": [], "plays": []}},
            "defense": {"passing": {"zones": [], "plays": []}, "rushing": {"gaps": [], "plays": []}},
        }

    # Query offensive plays
    off_plays = session.scalars(
        select(Play)
        .where(Play.game_id.in_(game_ids), Play.posteam == team, Play.play_type.in_(["pass", "run"]))
        .order_by(Play.game_id, Play.play_id)
    ).all()

    # Query defensive plays (opponent plays when this team was on defense)
    def_plays = session.scalars(
        select(Play)
        .where(Play.game_id.in_(game_ids), Play.defteam == team, Play.play_type.in_(["pass", "run"]))
        .order_by(Play.game_id, Play.play_id)
    ).all()

    # Preload players for name resolution
    all_player_ids = set()
    for p in off_plays + def_plays:
        if p.passer_id:
            all_player_ids.add(p.passer_id)
        if p.receiver_id:
            all_player_ids.add(p.receiver_id)
        if p.rusher_id:
            all_player_ids.add(p.rusher_id)

    player_names = {}
    if all_player_ids:
        players = session.scalars(select(Player).where(Player.id.in_(list(all_player_ids)))).all()
        for pl in players:
            player_names[pl.id] = pl.name

    # Process Offense
    off_pass_zones = _aggregate_pass_zones(off_plays, is_defense=False, player_names=player_names)
    off_pass_vectors = _build_pass_vectors(off_plays, player_names)
    off_run_gaps = _aggregate_run_gaps(off_plays, is_defense=False)
    off_run_vectors = _build_run_vectors(off_plays, player_names)

    # Process Defense
    def_pass_zones = _aggregate_pass_zones(def_plays, is_defense=True, player_names=player_names)
    def_pass_vectors = _build_pass_vectors(def_plays, player_names)
    def_run_gaps = _aggregate_run_gaps(def_plays, is_defense=True)
    def_run_vectors = _build_run_vectors(def_plays, player_names)

    return {
        "team": {
            "abbr": team,
            "name": team_obj.name if team_obj else team,
            "color": team_obj.color if team_obj else "#2a78d6",
            "color2": team_obj.color2 if team_obj else "#eb6834",
            "logo": team_obj.logo if team_obj else None,
        },
        "sample_games": sample_meta,
        "offense": {
            "passing": {"zones": off_pass_zones, "plays": off_pass_vectors},
            "rushing": {"gaps": off_run_gaps, "plays": off_run_vectors},
        },
        "defense": {
            "passing": {"zones": def_pass_zones, "plays": def_pass_vectors},
            "rushing": {"gaps": def_run_gaps, "plays": def_run_vectors},
        },
    }


def _aggregate_pass_zones(plays: list[Play], is_defense: bool,
                           player_names: dict[str, str] | None = None) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[Play]] = {
        (loc, depth): [] for loc, depth, _ in PASS_ZONES
    }
    for p in plays:
        if p.play_type == "pass" and p.pass_location and p.pass_depth:
            key = (p.pass_location, p.pass_depth)
            if key in grouped:
                grouped[key].append(p)

    results = []
    for loc, depth, label in PASS_ZONES:
        plist = grouped[(loc, depth)]
        att = len(plist)
        cmps = sum(1 for p in plist if p.complete_pass)
        yds = sum(p.yards_gained or 0.0 for p in plist)
        tds = sum(1 for p in plist if p.touchdown)
        ints = sum(1 for p in plist if p.interception)
        epa_vals = [p.epa for p in plist if p.epa is not None]
        succ_vals = [
            p.success if p.success is not None else (bool(p.complete_pass) and (p.yards_gained or 0) > 0)
            for p in plist
        ]
        avg_epa = round(sum(epa_vals) / len(epa_vals), 3) if epa_vals else 0.0
        succ_rate = round(sum(1 for s in succ_vals if s) / len(succ_vals), 3) if succ_vals else 0.0
        comp_pct = round(cmps / att, 3) if att > 0 else 0.0

        # Per-receiver breakdown for this zone
        top_receivers = _zone_receiver_leaders(plist, player_names or {})

        results.append({
            "location": loc,
            "depth_band": depth,
            "label": label,
            "attempts": att,
            "completions": cmps,
            "comp_pct": comp_pct,
            "yards": round(yds, 1),
            "yards_per_att": round(yds / att, 1) if att > 0 else 0.0,
            "touchdowns": tds,
            "interceptions": ints,
            "epa_avg": avg_epa,
            "success_rate": succ_rate,
            "top_receivers": top_receivers,
        })
    return results


def _zone_receiver_leaders(plays: list[Play], player_names: dict[str, str],
                            top_n: int = 5) -> list[dict[str, Any]]:
    """Aggregate per-receiver stats for a single zone, sorted by targets desc.

    Uses player_id as the primary key but merges any duplicate entries that share
    the same resolved name (handles dual ESPN/GSIS IDs for the same player).
    """
    stats: dict[str, dict[str, Any]] = {}
    for p in plays:
        rid = p.receiver_id or ""
        if not rid:
            continue
        name = player_names.get(rid, rid)
        # Key on name so dual-ID players (espn:xxx and 00-xxx) merge cleanly
        key = name.lower().strip()
        if key not in stats:
            stats[key] = {
                "player_id": rid,
                "name": name,
                "targets": 0,
                "catches": 0,
                "yards": 0.0,
                "touchdowns": 0,
                "epa_sum": 0.0,
                "epa_count": 0,
                "success_count": 0,
            }
        s = stats[key]
        s["targets"] += 1
        if p.complete_pass:
            s["catches"] += 1
            s["yards"] += p.yards_gained or 0.0
        if p.touchdown:
            s["touchdowns"] += 1
        if p.epa is not None:
            s["epa_sum"] += p.epa
            s["epa_count"] += 1
        if p.success or (p.success is None and bool(p.complete_pass) and (p.yards_gained or 0) > 0):
            s["success_count"] += 1

    leaders = []
    for s in stats.values():
        tgt = s["targets"]
        avg_epa = round(s["epa_sum"] / s["epa_count"], 3) if s["epa_count"] else 0.0
        succ_rate = round(s["success_count"] / tgt, 3) if tgt else 0.0
        comp_pct = round(s["catches"] / tgt, 3) if tgt else 0.0
        leaders.append({
            "player_id": s["player_id"],
            "name": s["name"],
            "targets": tgt,
            "catches": s["catches"],
            "comp_pct": comp_pct,
            "yards": round(s["yards"], 1),
            "ypr": round(s["yards"] / s["catches"], 1) if s["catches"] else 0.0,
            "touchdowns": s["touchdowns"],
            "epa_avg": avg_epa,
            "success_rate": succ_rate,
        })

    # Sort: primarily by targets (more volume = more relevant), break ties by EPA
    leaders.sort(key=lambda r: (-r["targets"], -r["epa_avg"]))
    return leaders[:top_n]


def _build_pass_vectors(plays: list[Play], player_names: dict[str, str], max_plays: int = 150) -> list[dict[str, Any]]:
    vectors = []
    pass_plays = [p for p in plays if p.play_type == "pass"]
    # If too many plays, keep the most recent ones
    for p in pass_plays[-max_plays:]:
        loc = p.pass_location or "middle"
        depth_band = p.pass_depth or "short"
        depth = p.air_yards
        if depth is None:
            depth = DEPTH_DEFAULT.get(depth_band, 6.0)

        vectors.append({
            "play_id": p.play_id,
            "game_id": p.game_id,
            "quarter": p.quarter,
            "clock": p.clock,
            "passer": player_names.get(p.passer_id or "", p.passer_id or "QB"),
            "receiver": player_names.get(p.receiver_id or "", p.receiver_id or "Receiver"),
            "location": loc,
            "depth_band": depth_band,
            "depth": round(depth, 1),
            "complete": bool(p.complete_pass),
            "yards": p.yards_gained or 0.0,
            "yac": p.yac,
            "touchdown": bool(p.touchdown),
            "interception": bool(p.interception),
            "sack": bool(p.sack),
            "epa": round(p.epa, 2) if p.epa is not None else None,
            "desc": p.desc,
        })
    return vectors


def _aggregate_run_gaps(plays: list[Play], is_defense: bool) -> list[dict[str, Any]]:
    grouped: dict[str, list[Play]] = {gap_key: [] for gap_key, _, _, _ in RUN_GAPS}
    for p in plays:
        if p.play_type == "run":
            gk = normalize_run_gap(p.run_location, p.run_gap)
            if gk in grouped:
                grouped[gk].append(p)
            else:
                grouped["middle"].append(p)

    results = []
    for gap_key, loc, gap, label in RUN_GAPS:
        plist = grouped[gap_key]
        carries = len(plist)
        yds = sum(p.yards_gained or 0.0 for p in plist)
        tds = sum(1 for p in plist if p.touchdown)
        tfls = sum(1 for p in plist if (p.yards_gained or 0) < 0)
        epa_vals = [p.epa for p in plist if p.epa is not None]
        succ_vals = [
            p.success if p.success is not None else ((p.yards_gained or 0) >= 4)
            for p in plist
        ]
        avg_epa = round(sum(epa_vals) / len(epa_vals), 3) if epa_vals else 0.0
        succ_rate = round(sum(1 for s in succ_vals if s) / len(succ_vals), 3) if succ_vals else 0.0
        ypc = round(yds / carries, 1) if carries > 0 else 0.0

        results.append({
            "gap_key": gap_key,
            "location": loc,
            "gap": gap,
            "label": label,
            "carries": carries,
            "yards": round(yds, 1),
            "ypc": ypc,
            "touchdowns": tds,
            "tfls": tfls,
            "epa_avg": avg_epa,
            "success_rate": succ_rate,
        })
    return results


def _build_run_vectors(plays: list[Play], player_names: dict[str, str], max_plays: int = 150) -> list[dict[str, Any]]:
    vectors = []
    run_plays = [p for p in plays if p.play_type == "run"]
    for p in run_plays[-max_plays:]:
        gk = normalize_run_gap(p.run_location, p.run_gap)
        vectors.append({
            "play_id": p.play_id,
            "game_id": p.game_id,
            "quarter": p.quarter,
            "clock": p.clock,
            "rusher": player_names.get(p.rusher_id or "", p.rusher_id or "Rusher"),
            "gap_key": gk,
            "location": p.run_location,
            "gap": p.run_gap,
            "yards": p.yards_gained or 0.0,
            "touchdown": bool(p.touchdown),
            "epa": round(p.epa, 2) if p.epa is not None else None,
            "desc": p.desc,
        })
    return vectors


def calculate_favorability(
    off_epa: float,
    off_succ: float,
    def_allowed_epa: float,
    def_allowed_succ: float,
    off_vol: int,
    def_vol: int,
) -> dict[str, Any]:
    """Calculate overlay matchup favorability score (-1.0 = deep red to +1.0 = deep green).

    Positive score favors Offense (green: offense success meets weak defense).
    Negative score favors Defense (red: defense stop strength meets low offense efficiency).
    """
    if off_vol == 0 and def_vol == 0:
        return {
            "score": 0.0,
            "tier": "neutral",
            "tier_label": "Neutral",
            "description": "No recent sample",
            "color": "var(--muted)",
        }

    # Blended expected EPA: offensive output plus defense vulnerability
    # High off_epa (+) and high def_allowed_epa (+) both indicate favorable offensive environment
    blended_epa = (off_epa + def_allowed_epa) / 2.0

    # Success rate baseline in NFL is ~0.45
    blended_succ = ((off_succ + def_allowed_succ) / 2.0) - 0.45

    # Combined composite score: EPA has ~0.6 weight, Success Rate edge has ~0.4 weight
    # Typical blended EPA ranges from -0.40 to +0.40, scale to roughly [-1.0, +1.0]
    raw_score = (blended_epa * 1.5) + (blended_succ * 2.0)
    score = max(-1.0, min(1.0, round(raw_score, 3)))

    if score >= 0.35:
        tier = "strong_offense"
        tier_label = "Strong Offense Advantage"
        description = f"Offense heavily favored (+{score:.2f} edge, {blended_epa:+.2f} exp EPA)"
        color = "#10b981"  # Vibrant Emerald Green
    elif score >= 0.12:
        tier = "lean_offense"
        tier_label = "Favorable to Offense"
        description = f"Offense holds advantage (+{score:.2f} edge)"
        color = "#34d399"  # Medium Green
    elif score <= -0.35:
        tier = "strong_defense"
        tier_label = "Strong Defense Advantage"
        description = f"Defense heavily favored ({score:.2f} edge, lockdown zone)"
        color = "#eab308"  # Yellow
    elif score <= -0.12:
        tier = "lean_defense"
        tier_label = "Favorable to Defense"
        description = f"Defense holds advantage ({score:.2f} edge)"
        color = "#fde047"  # Soft Yellow
    else:
        tier = "neutral"
        tier_label = "Evenly Matched"
        description = "Balanced matchup (neither unit has dominant edge)"
        color = "var(--muted)"

    return {
        "score": score,
        "tier": tier,
        "tier_label": tier_label,
        "description": description,
        "color": color,
    }


def matchup_heatmap(
    session: Session,
    team_a: str,
    team_b: str,
    season: int,
    phase: str,
    last_n_games: int = 4,
) -> dict[str, Any]:
    """Generate both matchup overlay maps:
    1. Team A Offense vs Team B Defense
    2. Team B Offense vs Team A Defense
    """
    data_a = team_field_heatmap(session, team_a, season, phase, last_n_games)
    data_b = team_field_heatmap(session, team_b, season, phase, last_n_games)

    map_a_vs_b = _build_overlay_map(
        offense_team=data_a["team"],
        defense_team=data_b["team"],
        off_data=data_a["offense"],
        def_data=data_b["defense"],
        off_samples=data_a["sample_games"],
        def_samples=data_b["sample_games"],
    )

    map_b_vs_a = _build_overlay_map(
        offense_team=data_b["team"],
        defense_team=data_a["team"],
        off_data=data_b["offense"],
        def_data=data_a["defense"],
        off_samples=data_b["sample_games"],
        def_samples=data_a["sample_games"],
    )

    return {
        "season": season,
        "phase": phase,
        "sample_games_window": last_n_games,
        "team_a": data_a["team"],
        "team_b": data_b["team"],
        "map_a_vs_b": map_a_vs_b,
        "map_b_vs_a": map_b_vs_a,
    }


def _build_overlay_map(
    offense_team: dict[str, Any],
    defense_team: dict[str, Any],
    off_data: dict[str, Any],
    def_data: dict[str, Any],
    off_samples: list[dict],
    def_samples: list[dict],
) -> dict[str, Any]:
    # Pass zone overlays
    off_zones_by_key = {
        (z["location"], z["depth_band"]): z for z in off_data["passing"]["zones"]
    }
    def_zones_by_key = {
        (z["location"], z["depth_band"]): z for z in def_data["passing"]["zones"]
    }

    passing_overlay = []
    for loc, depth, label in PASS_ZONES:
        oz = off_zones_by_key.get((loc, depth), {})
        dz = def_zones_by_key.get((loc, depth), {})

        off_att = oz.get("attempts", 0)
        off_epa = oz.get("epa_avg", 0.0)
        off_succ = oz.get("success_rate", 0.0)

        def_att = dz.get("attempts", 0)
        def_epa = dz.get("epa_avg", 0.0)
        def_succ = dz.get("success_rate", 0.0)

        favorability = calculate_favorability(
            off_epa=off_epa,
            off_succ=off_succ,
            def_allowed_epa=def_epa,
            def_allowed_succ=def_succ,
            off_vol=off_att,
            def_vol=def_att,
        )

        passing_overlay.append({
            "location": loc,
            "depth_band": depth,
            "label": label,
            "offense": oz,
            "defense": dz,
            "advantage": favorability,
        })

    # Run gap overlays
    off_gaps_by_key = {g["gap_key"]: g for g in off_data["rushing"]["gaps"]}
    def_gaps_by_key = {g["gap_key"]: g for g in def_data["rushing"]["gaps"]}

    rushing_overlay = []
    for gap_key, loc, gap, label in RUN_GAPS:
        og = off_gaps_by_key.get(gap_key, {})
        dg = def_gaps_by_key.get(gap_key, {})

        off_car = og.get("carries", 0)
        off_epa = og.get("epa_avg", 0.0)
        off_succ = og.get("success_rate", 0.0)

        def_car = dg.get("carries", 0)
        def_epa = dg.get("epa_avg", 0.0)
        def_succ = dg.get("success_rate", 0.0)

        favorability = calculate_favorability(
            off_epa=off_epa,
            off_succ=off_succ,
            def_allowed_epa=def_epa,
            def_allowed_succ=def_succ,
            off_vol=off_car,
            def_vol=def_car,
        )

        rushing_overlay.append({
            "gap_key": gap_key,
            "location": loc,
            "gap": gap,
            "label": label,
            "offense": og,
            "defense": dg,
            "advantage": favorability,
        })

    return {
        "title": f"{offense_team['abbr']} Offense vs {defense_team['abbr']} Defense",
        "offense_team": offense_team,
        "defense_team": defense_team,
        "offense_sample_games": off_samples,
        "defense_sample_games": def_samples,
        "passing_zones": passing_overlay,
        "passing_plays": off_data["passing"]["plays"],
        "rushing_gaps": rushing_overlay,
        "rushing_plays": off_data["rushing"]["plays"],
    }


def upcoming_matchups(session: Session, season: int, phase: str) -> dict[str, Any]:
    """Retrieve scheduled matchups for the upcoming week, plus full teams list for custom matchups."""
    # Find active/upcoming week
    scheduled_games = session.scalars(
        select(Game)
        .where(Game.season == season, Game.phase == phase, Game.status == "scheduled")
        .order_by(Game.week, Game.kickoff)
    ).all()

    all_teams = session.scalars(select(Team).order_by(Team.name)).all()
    teams_list = [
        {
            "abbr": t.abbr,
            "name": t.name,
            "conference": t.conference,
            "division": t.division,
            "color": t.color or "#2a78d6",
            "color2": t.color2 or "#eb6834",
            "logo": t.logo,
        }
        for t in all_teams
    ]
    teams_map = {t["abbr"]: t for t in teams_list}

    if scheduled_games:
        # Get target week (minimum week with scheduled games)
        target_week = min(g.week for g in scheduled_games)
        week_games = [g for g in scheduled_games if g.week == target_week]
    else:
        # Fallback to latest games from the season
        latest_games = session.scalars(
            select(Game)
            .where(Game.season == season, Game.phase == phase)
            .order_by(desc(Game.week), desc(Game.kickoff))
            .limit(16)
        ).all()
        if latest_games:
            target_week = latest_games[0].week
            week_games = [g for g in latest_games if g.week == target_week]
        else:
            target_week = 1
            week_games = []

    matchup_cards = []
    for g in week_games:
        home_t = teams_map.get(g.home_team, {"abbr": g.home_team, "name": g.home_team, "color": "#2a78d6"})
        away_t = teams_map.get(g.away_team, {"abbr": g.away_team, "name": g.away_team, "color": "#eb6834"})
        matchup_cards.append({
            "game_id": g.id,
            "week": g.week,
            "kickoff": g.kickoff,
            "status": g.status,
            "home": home_t,
            "away": away_t,
        })

    return {
        "season": season,
        "phase": phase,
        "active_week": target_week,
        "matchups": matchup_cards,
        "teams": teams_list,
    }

