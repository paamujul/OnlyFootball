import { useEffect, useState } from 'react';
import { api } from '../api';
import type {
  MatchupHeatmap,
  UpcomingMatchupTeam,
  UpcomingMatchupsResponse,
} from '../api';
import { MatchupFieldHeatmap } from '../components/FieldHeatmap';
import { PHASE_LABEL, useSeason } from '../state';

export default function HeatmapPage() {
  const { season, phase } = useSeason();
  const [teamA, setTeamA] = useState('MIA');
  const [teamB, setTeamB] = useState('DET');
  const [gamesWindow, setGamesWindow] = useState(4);
  const [upcoming, setUpcoming] = useState<UpcomingMatchupsResponse | null>(null);
  const [matchupData, setMatchupData] = useState<MatchupHeatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Linked interaction state between Map 1 and Map 2
  const [hoveredZoneKey, setHoveredZoneKey] = useState<string | null>(null);
  const [hoveredGapKey, setHoveredGapKey] = useState<string | null>(null);
  const [selectedZoneKey, setSelectedZoneKey] = useState<string | null>(null);
  const [selectedGapKey, setSelectedGapKey] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<'map_a' | 'map_b' | null>(null);

  // Load upcoming games and team directory
  useEffect(() => {
    api.heatmapUpcoming(season, phase)
      .then((res) => {
        setUpcoming(res);
        // Default to first scheduled matchup if available
        if (res.matchups.length > 0) {
          const first = res.matchups[0];
          setTeamA(first.home.abbr);
          setTeamB(first.away.abbr);
        }
      })
      .catch((err) => {
        console.error('Failed to load upcoming matchups:', err);
      });
  }, [season, phase]);

  // Load matchup overlay heatmap whenever teams or parameters change
  useEffect(() => {
    if (!teamA || !teamB) return;
    setLoading(true);
    setError(null);
    api.heatmapMatchup(teamA, teamB, season, phase, gamesWindow)
      .then((data) => {
        setMatchupData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [teamA, teamB, season, phase, gamesWindow]);

  const handleSelectMatchup = (home: UpcomingMatchupTeam, away: UpcomingMatchupTeam) => {
    setTeamA(home.abbr);
    setTeamB(away.abbr);
  };

  const handleSwap = () => {
    const nextA = teamB;
    const nextB = teamA;
    setTeamA(nextA);
    setTeamB(nextB);
  };

  const allTeams = upcoming?.teams ?? [];

  return (
    <div>
      {/* Page Header */}
      <div className="page-head">
        <h1>Matchup Heat Map</h1>
        <span className="sub">
          {season} {PHASE_LABEL[phase]?.toLowerCase()} · Offense overlayed on Defense for passing & rushing attack zones.
          Darker colors indicate high favorability (green = offense advantage) or non-favorability (red = defense advantage).
        </span>
      </div>

      {/* Upcoming Games Bar */}
      {upcoming && upcoming.matchups.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Week {upcoming.active_week} Matchups ({upcoming.matchups.length} games)
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Click any game to load dual overlay
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 6,
              scrollbarWidth: 'thin',
            }}
          >
            {upcoming.matchups.map((m) => {
              const isSelected =
                (teamA === m.home.abbr && teamB === m.away.abbr) ||
                (teamA === m.away.abbr && teamB === m.home.abbr);
              return (
                <button
                  key={m.game_id}
                  type="button"
                  onClick={() => handleSelectMatchup(m.home, m.away)}
                  style={{
                    flex: '0 0 auto',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: isSelected ? 'var(--surface)' : 'var(--page)',
                    border: isSelected ? '2px solid var(--series-1)' : '1px solid var(--border)',
                    boxShadow: isSelected ? 'var(--shadow)' : 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {m.away.logo && (
                      <img src={m.away.logo} alt={m.away.abbr} style={{ width: 18, height: 18, objectFit: 'contain' }} />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{m.away.abbr}</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>@</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {m.home.logo && (
                      <img src={m.home.logo} alt={m.home.abbr} style={{ width: 18, height: 18, objectFit: 'contain' }} />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)' }}>{m.home.abbr}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Matchup Controls: Team Selectors & Sample Window */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Matchup:</span>
          {/* Team A Picker */}
          <select
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontWeight: 700,
            }}
          >
            {allTeams.map((t) => (
              <option key={t.abbr} value={t.abbr} disabled={t.abbr === teamB}>
                {t.name} ({t.abbr})
              </option>
            ))}
          </select>

          {/* Swap Button */}
          <button
            type="button"
            onClick={handleSwap}
            title="Swap Home/Away or Team Order"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '6px 10px',
              cursor: 'pointer',
              color: 'var(--ink)',
              fontWeight: 700,
            }}
          >
            ⇄ Swap
          </button>

          {/* Team B Picker */}
          <select
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontWeight: 700,
            }}
          >
            {allTeams.map((t) => (
              <option key={t.abbr} value={t.abbr} disabled={t.abbr === teamA}>
                {t.name} ({t.abbr})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>Sample Window:</label>
          <select
            value={gamesWindow}
            onChange={(e) => setGamesWindow(Number(e.target.value))}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          >
            <option value={4}>Last 4 games (recent form)</option>
            <option value={8}>Last 8 games</option>
            <option value={16}>Full season</option>
          </select>
        </div>
      </div>

      {/* Favorability Legend Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 16,
          padding: '10px 16px',
          background: 'var(--surface)',
          borderRadius: 8,
          border: '1px solid var(--grid)',
          marginBottom: 20,
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Heat Color Guide:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#10b981', display: 'inline-block' }} />
          <span>Strong Offense Advantage (High Favorable)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#34d399', display: 'inline-block' }} />
          <span>Lean Offense</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--muted)', opacity: 0.5, display: 'inline-block' }} />
          <span>Neutral</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#fde047', display: 'inline-block' }} />
          <span>Lean Defense</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: '#eab308', display: 'inline-block' }} />
          <span>Strong Defense Advantage (Yellow)</span>
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          Computing passing and rushing heat overlays...
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '20px', color: 'var(--bad)', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Main 2-Map Overlay Display */}
      {matchupData && !loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* Map 1: Team A Offense vs Team B Defense */}
          <div>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge" style={{ background: 'var(--series-1)', color: '#fff', fontWeight: 800 }}>
                Map 1
              </span>
              <h2 style={{ margin: 0, fontSize: 17 }}>
                {matchupData.map_a_vs_b.title}
              </h2>
            </div>
            <MatchupFieldHeatmap
              data={matchupData.map_a_vs_b}
              mapId="map_a"
              linkedZoneKey={hoveredZoneKey ?? (selectedMapId === 'map_b' ? selectedZoneKey : null)}
              onHoverZoneKey={setHoveredZoneKey}
              selectedZoneKey={selectedMapId === 'map_a' ? selectedZoneKey : null}
              onSelectZoneKey={(key, mid) => {
                setSelectedZoneKey(key);
                setSelectedMapId(key ? mid : null);
                if (key) setSelectedGapKey(null);
              }}
              linkedGapKey={hoveredGapKey ?? (selectedMapId === 'map_b' ? selectedGapKey : null)}
              onHoverGapKey={setHoveredGapKey}
              selectedGapKey={selectedMapId === 'map_a' ? selectedGapKey : null}
              onSelectGapKey={(key, mid) => {
                setSelectedGapKey(key);
                setSelectedMapId(key ? mid : null);
                if (key) setSelectedZoneKey(null);
              }}
              selectedMapId={selectedMapId}
            />
          </div>

          {/* Map 2: Team B Offense vs Team A Defense */}
          <div>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge" style={{ background: 'var(--series-2)', color: '#fff', fontWeight: 800 }}>
                Map 2
              </span>
              <h2 style={{ margin: 0, fontSize: 17 }}>
                {matchupData.map_b_vs_a.title}
              </h2>
            </div>
            <MatchupFieldHeatmap
              data={matchupData.map_b_vs_a}
              mapId="map_b"
              linkedZoneKey={hoveredZoneKey ?? (selectedMapId === 'map_a' ? selectedZoneKey : null)}
              onHoverZoneKey={setHoveredZoneKey}
              selectedZoneKey={selectedMapId === 'map_b' ? selectedZoneKey : null}
              onSelectZoneKey={(key, mid) => {
                setSelectedZoneKey(key);
                setSelectedMapId(key ? mid : null);
                if (key) setSelectedGapKey(null);
              }}
              linkedGapKey={hoveredGapKey ?? (selectedMapId === 'map_a' ? selectedGapKey : null)}
              onHoverGapKey={setHoveredGapKey}
              selectedGapKey={selectedMapId === 'map_b' ? selectedGapKey : null}
              onSelectGapKey={(key, mid) => {
                setSelectedGapKey(key);
                setSelectedMapId(key ? mid : null);
                if (key) setSelectedZoneKey(null);
              }}
              selectedMapId={selectedMapId}
            />
          </div>
        </div>
      )}
    </div>
  );
}

