import { api } from '../api';
import { useEffect, useState } from 'react';
import type {
  MatchupHeatmap,
  UpcomingMatchupTeam,
  UpcomingMatchupsResponse,
} from '../api';
import { MatchupFieldHeatmap } from './FieldHeatmap';
import { useSeason } from '../state';

export interface WindowOption {
  value: number;
  label: string;
}

const DEFAULT_WINDOW_OPTIONS: WindowOption[] = [
  { value: 4, label: 'Last 4 games (recent form)' },
  { value: 8, label: 'Last 8 games' },
  { value: 16, label: 'Full season' },
];

// red-zone samples are small, so offer longer windows and start at 16 games
const RED_ZONE_WINDOW_OPTIONS: WindowOption[] = [
  { value: 8, label: 'Last 8 games' },
  { value: 16, label: 'Last 16 games' },
  { value: 32, label: 'Full season' },
];

const RED_ZONE_NOTE = 'Distances are measured from the line of scrimmage; plays are capped at the goal line.';

export default function MatchupHeatmapShell() {
  const [redZone, setRedZone] = useState(false);
  const fetchMatchup = redZone ? api.redzoneMatchup : api.heatmapMatchup;
  const windowOptions = redZone ? RED_ZONE_WINDOW_OPTIONS : DEFAULT_WINDOW_OPTIONS;
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
    fetchMatchup(teamA, teamB, season, phase, gamesWindow)
      .then((data) => {
        setMatchupData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [teamA, teamB, season, phase, gamesWindow, fetchMatchup]);

  const handleSelectMatchup = (home: UpcomingMatchupTeam, away: UpcomingMatchupTeam) => {
    setTeamA(home.abbr);
    setTeamB(away.abbr);
  };

  const toggleRedZone = () => {
    const next = !redZone;
    setRedZone(next);
    setGamesWindow(next ? 16 : 4);
    setSelectedZoneKey(null);
    setSelectedGapKey(null);
    setSelectedMapId(null);
  };

  return (
    <div>
      {/* Upcoming Games Bar */}
      {upcoming && upcoming.matchups.length > 0 && (
        <div style={{ marginBottom: 20 }}>
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
                    background: isSelected ? 'var(--surface)' : 'transparent',
                    border: isSelected ? '1px solid var(--ink)' : '1px solid var(--border)',
                    boxShadow: isSelected ? 'inset 0 0 0 1px var(--ink)' : 'none',
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

      {/* Sample window */}
      <div
        style={{
          padding: '4px 0 14px',
          marginBottom: 20,
          borderBottom: '1px solid var(--grid)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <label htmlFor="sample-window" style={{ fontSize: 13, color: 'var(--muted)' }}>Sample window</label>
        <select
          id="sample-window"
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
          {windowOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {redZone && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{RED_ZONE_NOTE}</div>
      )}

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
            <MatchupFieldHeatmap
              data={matchupData.map_a_vs_b}
              redZone={redZone}
              onToggleRedZone={toggleRedZone}
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
            <MatchupFieldHeatmap
              data={matchupData.map_b_vs_a}
              redZone={redZone}
              onToggleRedZone={toggleRedZone}
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

