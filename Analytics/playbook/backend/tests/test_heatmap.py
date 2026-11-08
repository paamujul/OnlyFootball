"""Tests for field heatmap analytics and endpoints."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.analytics.heatmap import (
    calculate_favorability,
    matchup_heatmap,
    normalize_run_gap,
    team_field_heatmap,
    upcoming_matchups,
)
from app.db.models import Base, Game, Play, Team


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        # Seed test teams
        mia = Team(abbr="MIA", name="Miami Dolphins", color="#008E97", color2="#FC4C02")
        det = Team(abbr="DET", name="Detroit Lions", color="#0076B6", color2="#B0B7BC")
        session.add_all([mia, det])

        # Seed completed games
        g1 = Game(id="2026_01_MIA_DET", season=2026, phase="reg", week=1,
                  home_team="DET", away_team="MIA", home_score=24, away_score=21, status="final")
        g2 = Game(id="2026_02_BUF_MIA", season=2026, phase="reg", week=2,
                  home_team="MIA", away_team="BUF", home_score=28, away_score=20, status="final")
        g_sched = Game(id="2026_09_DET_MIA", season=2026, phase="reg", week=9,
                       home_team="MIA", away_team="DET", status="scheduled")
        session.add_all([g1, g2, g_sched])

        # Seed sample plays for MIA posteam (offense) and DET defteam (defense)
        p1 = Play(game_id="2026_01_MIA_DET", play_id=1, posteam="MIA", defteam="DET",
                  play_type="pass", pass_location="left", pass_depth="short",
                  air_yards=5.0, yac=12.0, yards_gained=17.0, complete_pass=True,
                  touchdown=False, epa=0.85, success=True)
        p2 = Play(game_id="2026_01_MIA_DET", play_id=2, posteam="MIA", defteam="DET",
                  play_type="pass", pass_location="left", pass_depth="deep",
                  air_yards=25.0, yac=0.0, yards_gained=0.0, complete_pass=False,
                  touchdown=False, epa=-0.70, success=False)
        p3 = Play(game_id="2026_01_MIA_DET", play_id=3, posteam="MIA", defteam="DET",
                  play_type="run", run_location="left", run_gap="tackle",
                  yards_gained=14.0, touchdown=True, epa=1.40, success=True)
        p4 = Play(game_id="2026_01_MIA_DET", play_id=4, posteam="DET", defteam="MIA",
                  play_type="run", run_location="middle", run_gap="guard",
                  yards_gained=2.0, touchdown=False, epa=-0.20, success=False)

        session.add_all([p1, p2, p3, p4])
        session.commit()
        yield session


def test_normalize_run_gap():
    assert normalize_run_gap("left", "end") == "left end"
    assert normalize_run_gap("left", "tackle") == "left tackle"
    assert normalize_run_gap("left", "guard") == "left guard"
    assert normalize_run_gap("middle", None) == "middle"
    assert normalize_run_gap("right", "guard") == "right guard"
    assert normalize_run_gap("right", "tackle") == "right tackle"
    assert normalize_run_gap("right", "end") == "right end"
    assert normalize_run_gap(None, None) == "middle"


def test_calculate_favorability():
    # Strong offense scenario: high EPA and high success against porous defense
    fav = calculate_favorability(off_epa=0.5, off_succ=0.7, def_allowed_epa=0.4,
                                 def_allowed_succ=0.6, off_vol=10, def_vol=10)
    assert fav["score"] > 0.35
    assert fav["tier"] == "strong_offense"
    assert "Advantage" in fav["tier_label"]

    # Strong defense scenario: negative EPA and low success against lockdown defense
    fav_def = calculate_favorability(off_epa=-0.4, off_succ=0.2, def_allowed_epa=-0.3,
                                     def_allowed_succ=0.3, off_vol=10, def_vol=10)
    assert fav_def["score"] < -0.35
    assert fav_def["tier"] == "strong_defense"

    # Empty sample
    fav_empty = calculate_favorability(off_epa=0.0, off_succ=0.0, def_allowed_epa=0.0,
                                       def_allowed_succ=0.0, off_vol=0, def_vol=0)
    assert fav_empty["score"] == 0.0
    assert fav_empty["tier"] == "neutral"


def test_team_field_heatmap(test_db):
    data = team_field_heatmap(test_db, "MIA", 2026, "reg", last_n_games=4)
    assert data["team"]["abbr"] == "MIA"
    assert len(data["sample_games"]) == 2

    # Check offense zones
    zones = data["offense"]["passing"]["zones"]
    assert len(zones) == 6
    left_short = next(z for z in zones if z["location"] == "left" and z["depth_band"] == "short")
    assert left_short["attempts"] == 1
    assert left_short["completions"] == 1
    assert left_short["yards"] == 17.0

    # Check offense run gaps
    gaps = data["offense"]["rushing"]["gaps"]
    assert len(gaps) == 7
    left_tackle = next(g for g in gaps if g["gap_key"] == "left tackle")
    assert left_tackle["carries"] == 1
    assert left_tackle["touchdowns"] == 1


def test_matchup_heatmap(test_db):
    data = matchup_heatmap(test_db, "MIA", "DET", 2026, "reg", last_n_games=4)
    assert "map_a_vs_b" in data
    assert "map_b_vs_a" in data
    assert data["map_a_vs_b"]["title"] == "MIA Offense vs DET Defense"
    assert data["map_b_vs_a"]["title"] == "DET Offense vs MIA Defense"

    passing_overlay = data["map_a_vs_b"]["passing_zones"]
    assert len(passing_overlay) == 6
    for z in passing_overlay:
        assert "advantage" in z
        assert "score" in z["advantage"]


def test_upcoming_matchups(test_db):
    res = upcoming_matchups(test_db, 2026, "reg")
    assert res["active_week"] == 9
    assert len(res["matchups"]) == 1
    m = res["matchups"][0]
    assert m["home"]["abbr"] == "MIA"
    assert m["away"]["abbr"] == "DET"

