import { api } from '../api';
import { useEffect, useState } from 'react';
import type {
  MatchupHeatmap,
  UpcomingMatchupTeam,
  UpcomingMatchupsResponse,
} from '../api';
import { MatchupFieldHeatmap } from './FieldHeatmap';
import { PHASE_LABEL, useSeason } from '../state';

export interface WindowOption {
  value: number;
  label: string;
}

const HEAT_SUBTITLE =
  'Offense overlayed on Defense for passing & rushing attack zones. Darker colors indicate high favorability (green = offense advantage) or non-favorability (red = defense advantage).';

const DEFAULT_WINDOW_OPTIONS: WindowOption[] = [
  { value: 4, label: 'Last 4 games (recent form)' },
  { value: 8, label: 'Last 8 games' },
  { value: 16, label: 'Full season' },
];

export interface MatchupHeatmapShellProps {
  fetchMatchup: (
    teamA: string,
    teamB: string,
    season: number,
    phase: string,
    games: number,
  ) => Promise<MatchupHeatmap>;
  redZone?: boolean;
  title: string;
  subtitle?: string;
  defaultWindow: number;
  windowOptions?: WindowOption[];
  note?: string;
}

export default function MatchupHeatmapShell({
  fetchMatchup,
  redZone,
  title,
  subtitle,
  defaultWindow,
  windowOptions = DEFAULT_WINDOW_OPTIONS,
  note,
}: MatchupHeatmapShellProps) {
  const { season, phase } = useSeason();
  const [teamA, setTeamA] = useState('MIA');
  const [teamB, setTeamB] = useState('DET');
  const [gamesWindow, setGamesWindow] = useState(defaultWindow);
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
        <h1>{title}</h1>
        <span className="sub">
          {season} {PHASE_LABEL[phase]?.toLowerCase()} · {subtitle ?? HEAT_SUBTITLE}
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

      {/* Matchup Controls: Team Selectors & Sample Window */}
      <div
        style={{
          padding: '14px 0',
          marginBottom: 20,
          borderTop: '1px solid var(--grid)',
          borderBottom: '1px solid var(--grid)',
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
            {windowOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {note && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{note}</div>
      )}

      {/* Favorability Legend Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
          padding: '0',
          marginBottom: 20,
          fontSize: 12,
          color: 'var(--ink-2)',
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
              <span className="badge" style={{ background: 'transparent', color: 'var(--series-1)', border: '1px solid currentColor', fontWeight: 700 }}>
                Map 1
              </span>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {matchupData.map_a_vs_b.title}
              </h2>
            </div>
            <MatchupFieldHeatmap
              data={matchupData.map_a_vs_b}
              redZone={redZone}
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
              <span className="badge" style={{ background: 'transparent', color: 'var(--series-2)', border: '1px solid currentColor', fontWeight: 700 }}>
                Map 2
              </span>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {matchupData.map_b_vs_a.title}
              </h2>
            </div>
            <MatchupFieldHeatmap
              data={matchupData.map_b_vs_a}
              redZone={redZone}
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

