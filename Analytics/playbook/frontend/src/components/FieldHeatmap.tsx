import { useState, useMemo, useRef, useEffect } from 'react';
import type {
  MatchupOverlayGap,
  MatchupOverlayMap,
  MatchupOverlayZone,
  TeamHeatmap,
} from '../api';

const W = 560;
const H = 460;
const LOS_Y = 360; // line of scrimmage
const PX_PER_YD = 7.6;

function depthY(depth: number): number {
  return LOS_Y - Math.max(-10, Math.min(45, depth)) * PX_PER_YD;
}

// 7 running gaps across the line of scrimmage with standard football abbreviations
// Arranged with 5px spacing between cells across the field width
const GAP_CONFIG: Record<string, { x: number; w: number; abbr: string; fullName: string }> = {
  'left end': { x: 62, w: 56, abbr: 'LE', fullName: 'Left End' },
  'left tackle': { x: 123, w: 56, abbr: 'LT', fullName: 'Left Tackle' },
  'left guard': { x: 184, w: 56, abbr: 'LG', fullName: 'Left Guard' },
  'middle': { x: 245, w: 56, abbr: 'C', fullName: 'Center / Middle' },
  'right guard': { x: 306, w: 56, abbr: 'RG', fullName: 'Right Guard' },
  'right tackle': { x: 367, w: 56, abbr: 'RT', fullName: 'Right Tackle' },
  'right end': { x: 428, w: 56, abbr: 'RE', fullName: 'Right End' },
};

// Zone cards positioned with 14px horizontal spacing and 23px vertical spacing
const ZONE_BOXES: Record<string, Record<string, { x: number; y: number; w: number; h: number }>> = {
  deep: {
    left: { x: 62, y: depthY(42), w: 136, h: depthY(17) - depthY(42) },
    middle: { x: 212, y: depthY(42), w: 136, h: depthY(17) - depthY(42) },
    right: { x: 362, y: depthY(42), w: 136, h: depthY(17) - depthY(42) },
  },
  short: {
    left: { x: 62, y: depthY(14), w: 136, h: depthY(1) - depthY(14) },
    middle: { x: 212, y: depthY(14), w: 136, h: depthY(1) - depthY(14) },
    right: { x: 362, y: depthY(14), w: 136, h: depthY(1) - depthY(14) },
  },
};

const LANE_CENTERS: Record<string, number> = { left: 130, middle: 280, right: 430 };

function laneX(location: string | null, i: number): number {
  const base = LANE_CENTERS[location ?? 'middle'] ?? 280;
  const jitter = ((i * 47) % 100) / 100 - 0.5;
  return base + jitter * 90;
}

function gapX(gapKey: string, i: number): number {
  const conf = GAP_CONFIG[gapKey] ?? GAP_CONFIG['middle'];
  const jitter = ((i * 37) % 100) / 100 - 0.5;
  return conf.x + conf.w / 2 + jitter * (conf.w - 18);
}

// Color and opacity helper for favorability
function getFavorabilityStyle(tier: string, score: number) {
  const absScore = Math.abs(score);
  if (tier === 'strong_offense') {
    return {
      fill: '#10b981',
      stroke: '#059669',
      opacity: Math.min(0.52, 0.26 + absScore * 0.26),
      textColor: '#0ca30c',
    };
  }
  if (tier === 'lean_offense') {
    return {
      fill: '#34d399',
      stroke: '#10b981',
      opacity: 0.20 + absScore * 0.16,
      textColor: '#10b981',
    };
  }
  if (tier === 'strong_defense') {
    return {
      fill: '#eab308',
      stroke: '#ca8a04',
      opacity: Math.min(0.52, 0.26 + absScore * 0.26),
      textColor: '#eab308',
    };
  }
  if (tier === 'lean_defense') {
    return {
      fill: '#fde047',
      stroke: '#eab308',
      opacity: 0.20 + absScore * 0.16,
      textColor: '#ca8a04',
    };
  }
  return {
    fill: 'var(--surface)',
    stroke: 'var(--border)',
    opacity: 0.14,
    textColor: 'var(--muted)',
  };
}

// ---------------------------------------------------------------------------
// Tooltip state model
// ---------------------------------------------------------------------------
interface TooltipData {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  edge: number;
  tier: string;
  isSmallSample: boolean;
  sampleNote?: string;
  offenseHeader: string;
  offenseLines: string[];
  defenseHeader: string;
  defenseLines: string[];
  topReceiver?: string;
  hint: string;
}

// ---------------------------------------------------------------------------
// Matchup Overlay Heatmap Component (used on /heatmap)
// ---------------------------------------------------------------------------

export interface MatchupHeatmapProps {
  data: MatchupOverlayMap;
  mapId: 'map_a' | 'map_b';
  linkedZoneKey?: string | null;
  onHoverZoneKey?: (key: string | null) => void;
  selectedZoneKey?: string | null;
  onSelectZoneKey?: (key: string | null, mapId: 'map_a' | 'map_b') => void;
  linkedGapKey?: string | null;
  onHoverGapKey?: (key: string | null) => void;
  selectedGapKey?: string | null;
  onSelectGapKey?: (key: string | null, mapId: 'map_a' | 'map_b') => void;
  selectedMapId?: 'map_a' | 'map_b' | null;
}

export function MatchupFieldHeatmap({
  data,
  mapId,
  linkedZoneKey,
  onHoverZoneKey,
  selectedZoneKey,
  onSelectZoneKey,
  linkedGapKey,
  onHoverGapKey,
  selectedGapKey,
  onSelectGapKey,
  selectedMapId,
}: MatchupHeatmapProps) {
  const [view, setView] = useState<'both' | 'pass' | 'run'>('both');
  const [showVectors, setShowVectors] = useState(true);
  const [localHoveredZone, setLocalHoveredZone] = useState<string | null>(null);
  const [localHoveredGap, setLocalHoveredGap] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);

  const isMyMapSelected = selectedMapId === mapId;
  const activeZoneKey = isMyMapSelected ? selectedZoneKey : null;
  const activeGapKey = isMyMapSelected ? selectedGapKey : null;

  // Selected entities for breakdown card
  const selectedZone = useMemo(() => {
    if (!activeZoneKey) return null;
    return data.passing_zones.find(
      (z) => `${z.location}-${z.depth_band}` === activeZoneKey
    ) ?? null;
  }, [data.passing_zones, activeZoneKey]);

  const selectedGap = useMemo(() => {
    if (!activeGapKey) return null;
    return data.rushing_gaps.find((g) => g.gap_key === activeGapKey) ?? null;
  }, [data.rushing_gaps, activeGapKey]);

  // Smooth scroll into view when this map's inspector is opened
  useEffect(() => {
    if (isMyMapSelected && (selectedZone || selectedGap)) {
      breakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isMyMapSelected, selectedZone, selectedGap]);

  // Plays filtering based on focus
  const effectiveHoveredZone = localHoveredZone;
  const effectiveFocusZone = activeZoneKey ?? effectiveHoveredZone;

  const passPlays = useMemo(() => {
    return data.passing_plays;
  }, [data.passing_plays]);

  const effectiveHoveredGap = localHoveredGap;
  const effectiveFocusGap = activeGapKey ?? effectiveHoveredGap;

  const runPlays = useMemo(() => {
    return data.rushing_plays;
  }, [data.rushing_plays]);

  // Tooltip positioning helper
  const updateTooltipPos = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    setTooltip((prev) => (prev ? { ...prev, x: rawX, y: rawY } : null));
  };

  const handleZoneMouseEnter = (e: React.MouseEvent, z: MatchupOverlayZone) => {
    const key = `${z.location}-${z.depth_band}`;
    setLocalHoveredZone(key);
    onHoverZoneKey?.(key);

    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 200;
    const y = rect ? e.clientY - rect.top : 150;
    const isSmall = z.offense.attempts < 8;

    const topTarget = z.offense.top_receivers?.[0];
    setTooltip({
      x,
      y,
      title: `${z.label} Pass Zone`,
      subtitle: `${data.offense_team.abbr} Offense vs ${data.defense_team.abbr} Defense`,
      edge: z.advantage.score,
      tier: z.advantage.tier,
      isSmallSample: isSmall,
      sampleNote: isSmall ? `Small sample (${z.offense.attempts} att, < 8)` : undefined,
      offenseHeader: `${data.offense_team.abbr} Passing (${data.offense_sample_games.length} games)`,
      offenseLines: [
        `${z.offense.attempts} att · ${z.offense.completions} comp (${Math.round(z.offense.comp_pct * 100)}%)`,
        `${z.offense.yards} yds · ${z.offense.yards_per_att} Y/A`,
        `EPA/play: ${z.offense.epa_avg > 0 ? `+${z.offense.epa_avg.toFixed(2)}` : z.offense.epa_avg.toFixed(2)} · ${Math.round(z.offense.success_rate * 100)}% succ`,
      ],
      defenseHeader: `${data.defense_team.abbr} Pass Defense Allowed`,
      defenseLines: [
        `${z.defense.attempts} att alwd (${z.defense.completions} comp, ${Math.round(z.defense.comp_pct * 100)}%)`,
        `${z.defense.yards} yds alwd · ${z.defense.yards_per_att} Y/A`,
        `EPA alwd/play: ${z.defense.epa_avg > 0 ? `+${z.defense.epa_avg.toFixed(2)}` : z.defense.epa_avg.toFixed(2)} · ${Math.round(z.defense.success_rate * 100)}% succ`,
      ],
      topReceiver: topTarget
        ? `Top target: ${topTarget.name} (${topTarget.targets} tgt, ${topTarget.catches} rec, ${topTarget.yards} yds)`
        : undefined,
      hint: 'Click zone to lock view and show full receiver table',
    });
  };

  const handleZoneMouseLeave = () => {
    setLocalHoveredZone(null);
    onHoverZoneKey?.(null);
    setTooltip(null);
  };

  const handleZoneClick = (z: MatchupOverlayZone) => {
    const key = `${z.location}-${z.depth_band}`;
    const nextKey = activeZoneKey === key ? null : key;
    onSelectZoneKey?.(nextKey, mapId);
  };

  const handleGapMouseEnter = (e: React.MouseEvent, g: MatchupOverlayGap) => {
    setLocalHoveredGap(g.gap_key);
    onHoverGapKey?.(g.gap_key);

    const conf = GAP_CONFIG[g.gap_key] ?? GAP_CONFIG['middle'];
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 200;
    const y = rect ? e.clientY - rect.top : 260;
    const isSmall = g.offense.carries < 8;

    setTooltip({
      x,
      y,
      title: `${conf.fullName} (${conf.abbr}) Run Gap`,
      subtitle: `${data.offense_team.abbr} Rushing vs ${data.defense_team.abbr} Run Defense`,
      edge: g.advantage.score,
      tier: g.advantage.tier,
      isSmallSample: isSmall,
      sampleNote: isSmall ? `Small sample (${g.offense.carries} carries, < 8)` : undefined,
      offenseHeader: `${data.offense_team.abbr} Rushing (${data.offense_sample_games.length} games)`,
      offenseLines: [
        `${g.offense.carries} carries · ${g.offense.touchdowns} TD · ${g.offense.tfls} TFL`,
        `${g.offense.yards} yds · ${g.offense.ypc} YPC`,
        `EPA/carry: ${g.offense.epa_avg > 0 ? `+${g.offense.epa_avg.toFixed(2)}` : g.offense.epa_avg.toFixed(2)} · ${Math.round(g.offense.success_rate * 100)}% succ`,
      ],
      defenseHeader: `${data.defense_team.abbr} Run Defense Allowed`,
      defenseLines: [
        `${g.defense.carries} carries alwd · ${g.defense.touchdowns} TD alwd · ${g.defense.tfls} stops`,
        `${g.defense.yards} yds alwd · ${g.defense.ypc} YPC`,
        `EPA alwd/carry: ${g.defense.epa_avg > 0 ? `+${g.defense.epa_avg.toFixed(2)}` : g.defense.epa_avg.toFixed(2)} · ${Math.round(g.defense.success_rate * 100)}% succ`,
      ],
      hint: 'Click gap to lock view and show run breakdown',
    });
  };

  const handleGapMouseLeave = () => {
    setLocalHoveredGap(null);
    onHoverGapKey?.(null);
    setTooltip(null);
  };

  const handleGapClick = (g: MatchupOverlayGap) => {
    const nextKey = activeGapKey === g.gap_key ? null : g.gap_key;
    onSelectGapKey?.(nextKey, mapId);
  };

  return (
    <div className="card" style={{ padding: '16px 18px', marginBottom: 20 }}>
      {/* Header with Title and Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.offense_team.logo && (
            <img src={data.offense_team.logo} alt={data.offense_team.abbr} style={{ width: 26, height: 26, objectFit: 'contain' }} />
          )}
          <span style={{ fontWeight: 800, fontSize: 15 }}>
            {data.offense_team.abbr} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Offense</span>
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>vs</span>
          {data.defense_team.logo && (
            <img src={data.defense_team.logo} alt={data.defense_team.abbr} style={{ width: 26, height: 26, objectFit: 'contain' }} />
          )}
          <span style={{ fontWeight: 800, fontSize: 15 }}>
            {data.defense_team.abbr} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Defense</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="btn-group" style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
            <button
              type="button"
              className={view === 'both' ? 'active' : ''}
              onClick={() => { setView('both'); onSelectZoneKey?.(null, mapId); onSelectGapKey?.(null, mapId); }}
              style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 6, border: 'none', background: view === 'both' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Pass & Run
            </button>
            <button
              type="button"
              className={view === 'pass' ? 'active' : ''}
              onClick={() => { setView('pass'); onSelectGapKey?.(null, mapId); }}
              style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 6, border: 'none', background: view === 'pass' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Passing
            </button>
            <button
              type="button"
              className={view === 'run' ? 'active' : ''}
              onClick={() => { setView('run'); onSelectZoneKey?.(null, mapId); }}
              style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 6, border: 'none', background: view === 'run' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Rushing
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showVectors}
              onChange={(e) => setShowVectors(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Play trails
          </label>
        </div>
      </div>

      {/* SVG Football Field with Interactive Tooltip */}
      <div
        ref={containerRef}
        onMouseMove={updateTooltipPos}
        style={{ position: 'relative', overflow: 'visible' }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={data.title}
          style={{ width: '100%', maxWidth: 600, display: 'block', margin: '0 auto', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--grid)' }}
        >
          {/* Field Background */}
          <rect
            x={36}
            y={8}
            width={488}
            height={LOS_Y - 8}
            rx={10}
            fill="color-mix(in oklab, var(--surface) 94%, #18201a)"
            stroke="var(--grid)"
          />

          {/* Yard Lines */}
          {[0, 10, 20, 30, 40].map((yd) => (
            <g key={yd}>
              <line
                x1={38}
                x2={522}
                y1={depthY(yd)}
                y2={depthY(yd)}
                stroke={yd === 0 ? 'var(--baseline)' : 'var(--grid)'}
                strokeWidth={yd === 0 ? 1.8 : 0.8}
              />
              <text
                x={518}
                y={depthY(yd) - 4}
                textAnchor="end"
                fontSize={9.5}
                fill="var(--muted)"
                fontWeight={yd === 0 ? 700 : 400}
              >
                {yd === 0 ? 'LOS' : `+${yd}`}
              </text>
            </g>
          ))}

          {/* Hash marks */}
          {[5, 15, 25, 35].map((yd) => {
            const y = depthY(yd);
            return (
              <g key={yd}>
                <line x1={228} x2={234} y1={y} y2={y} stroke="var(--grid)" strokeWidth={0.8} />
                <line x1={326} x2={332} y1={y} y2={y} stroke="var(--grid)" strokeWidth={0.8} />
              </g>
            );
          })}

          {/* PASSING ZONES (6 zones) */}
          {(view === 'both' || view === 'pass') &&
            data.passing_zones.map((z) => {
              const boxGroup = ZONE_BOXES[z.depth_band];
              const box = boxGroup ? boxGroup[z.location] : null;
              if (!box) return null;

              const style = getFavorabilityStyle(z.advantage.tier, z.advantage.score);
              const key = `${z.location}-${z.depth_band}`;
              const isSelected = activeZoneKey === key;
              const isHovered = localHoveredZone === key;
              const isLinked = linkedZoneKey === key && !isHovered && !isSelected;
              const isSmallSample = z.offense.attempts < 8;

              return (
                <g
                  key={`zone-${key}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${z.label} pass zone: ${z.advantage.score > 0 ? `+${z.advantage.score.toFixed(2)}` : z.advantage.score.toFixed(2)} edge`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onMouseEnter={(e) => handleZoneMouseEnter(e, z)}
                  onMouseLeave={handleZoneMouseLeave}
                  onClick={() => handleZoneClick(z)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleZoneClick(z);
                    }
                  }}
                  onFocus={(e) => handleZoneMouseEnter(e as any, z)}
                  onBlur={handleZoneMouseLeave}
                >
                  {/* Zone Card Rectangle */}
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={9}
                    fill={style.fill}
                    opacity={
                      isSelected || isHovered
                        ? Math.min(0.68, style.opacity + 0.22)
                        : isSmallSample
                          ? style.opacity * 0.75
                          : style.opacity
                    }
                    stroke={
                      isSelected
                        ? '#ffffff'
                        : isHovered
                          ? style.textColor
                          : isLinked
                            ? 'var(--series-1)'
                            : style.stroke
                    }
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : isLinked ? 1.8 : 1}
                    strokeDasharray={isLinked ? '4 3' : isSmallSample ? '4 3' : undefined}
                  />

                  {/* Zone Name */}
                  <text
                    x={box.x + 12}
                    y={box.y + 22}
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--ink)"
                  >
                    {z.label}
                  </text>

                  {/* Signed Edge Value */}
                  <text
                    x={box.x + 12}
                    y={box.y + 40}
                    fontSize={13.5}
                    fontWeight={800}
                    fill={style.textColor}
                  >
                    {z.advantage.score > 0 ? `+${z.advantage.score.toFixed(2)}` : z.advantage.score.toFixed(2)}
                  </text>

                  {/* Subtle linked tag if corresponding zone is focused on the other map */}
                  {isLinked && (
                    <g transform={`translate(${box.x + box.w - 56}, ${box.y + 8})`}>
                      <rect width={48} height={16} rx={4} fill="var(--series-1)" opacity={0.25} />
                      <text x={24} y={11.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="var(--series-1)">
                        Matching
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* RUSHING GAPS (7 gaps along LOS) */}
          {(view === 'both' || view === 'run') &&
            data.rushing_gaps.map((g) => {
              const conf = GAP_CONFIG[g.gap_key] ?? GAP_CONFIG['middle'];
              const style = getFavorabilityStyle(g.advantage.tier, g.advantage.score);
              const isSelected = activeGapKey === g.gap_key;
              const isHovered = localHoveredGap === g.gap_key;
              const isLinked = linkedGapKey === g.gap_key && !isHovered && !isSelected;
              const isSmallSample = g.offense.carries < 8;

              const yStart = LOS_Y - 15;
              const h = 30;

              return (
                <g
                  key={`gap-${g.gap_key}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${conf.fullName} gap: ${g.advantage.score > 0 ? `+${g.advantage.score.toFixed(2)}` : g.advantage.score.toFixed(2)} edge`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onMouseEnter={(e) => handleGapMouseEnter(e, g)}
                  onMouseLeave={handleGapMouseLeave}
                  onClick={() => handleGapClick(g)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleGapClick(g);
                    }
                  }}
                  onFocus={(e) => handleGapMouseEnter(e as any, g)}
                  onBlur={handleGapMouseLeave}
                >
                  <rect
                    x={conf.x}
                    y={yStart}
                    width={conf.w}
                    height={h}
                    rx={6}
                    fill={style.fill}
                    opacity={
                      isSelected || isHovered
                        ? Math.min(0.72, style.opacity + 0.25)
                        : view === 'run'
                          ? Math.min(0.55, style.opacity + 0.1)
                          : isSmallSample
                            ? style.opacity * 0.75
                            : style.opacity * 0.9
                    }
                    stroke={
                      isSelected
                        ? '#ffffff'
                        : isHovered
                          ? style.textColor
                          : isLinked
                            ? 'var(--series-1)'
                            : style.stroke
                    }
                    strokeWidth={isSelected ? 2 : isHovered ? 1.8 : isLinked ? 1.5 : 1}
                    strokeDasharray={isLinked ? '3 2' : isSmallSample ? '3 2' : undefined}
                  />

                  {/* Gap Abbreviation */}
                  <text
                    x={conf.x + conf.w / 2}
                    y={LOS_Y - 3}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={800}
                    fill="var(--ink)"
                  >
                    {conf.abbr}
                  </text>

                  {/* Signed Edge */}
                  <text
                    x={conf.x + conf.w / 2}
                    y={LOS_Y + 9}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={700}
                    fill={style.textColor}
                  >
                    {g.advantage.score > 0 ? `+${g.advantage.score.toFixed(2)}` : g.advantage.score.toFixed(2)}
                  </text>
                </g>
              );
            })}

          {/* PASS PLAY VECTORS (Faint background texture by default, focused on hover/click) */}
          {showVectors && (view === 'both' || view === 'pass') &&
            passPlays.map((p, i) => {
              const x = laneX(p.location, i);
              const yTarget = depthY(p.depth);
              const bend = p.location === 'left' ? -20 : p.location === 'right' ? 20 : 0;
              const yacY = p.complete && p.yac ? Math.max(14, yTarget - p.yac * PX_PER_YD) : null;

              const playZoneKey = `${p.location}-${p.depth_band}`;
              const isInFocusZone = effectiveFocusZone ? playZoneKey === effectiveFocusZone : false;
              const hasAnyZoneFocus = Boolean(effectiveFocusZone);

              // Play trail opacity rules:
              // - In focus zone: full prominence (0.90 complete, 0.45 incomplete)
              // - Default state: blue lines clearly visible (0.38), red line just as visible as blue but 10% darker (0.48), with matching thickness (1.4px)
              let lineOpacity = 0.38;
              let strokeW = 1.4;
              let dotR = 2.4;

              if (hasAnyZoneFocus) {
                if (isInFocusZone) {
                  lineOpacity = p.touchdown ? 1.0 : p.complete ? 0.90 : 0.45;
                  strokeW = 1.8;
                  dotR = p.touchdown ? 4.0 : 3.5;
                } else if (p.touchdown) {
                  lineOpacity = 0.48;
                  strokeW = 1.4;
                  dotR = 3.0;
                } else {
                  lineOpacity = 0.05;
                  strokeW = 0.8;
                  dotR = 0;
                }
              } else {
                if (p.touchdown) {
                  // Red line: 10% darker than blue (0.48 vs 0.38) and same thickness (1.4px)
                  lineOpacity = 0.48;
                  strokeW = 1.4;
                  dotR = 3.0;
                } else if (p.complete) {
                  // Blue line: clearly visible at 0.38 opacity and 1.4px thickness
                  lineOpacity = 0.38;
                  strokeW = 1.4;
                  dotR = 2.4;
                } else {
                  lineOpacity = 0.16;
                  strokeW = 1.0;
                  dotR = 0;
                }
              }

              const color = p.touchdown
                ? '#dc2626'
                : p.complete
                  ? 'var(--series-1)'
                  : 'var(--muted)';

              return (
                <g key={`p-${p.play_id}`} opacity={lineOpacity}>
                  <path
                    d={`M 280 ${LOS_Y} Q ${x - bend} ${(LOS_Y + yTarget) / 2} ${x} ${yTarget}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeDasharray={p.complete ? undefined : '3 3'}
                  />
                  {yacY != null && (
                    <line
                      x1={x}
                      y1={yTarget}
                      x2={x}
                      y2={yacY}
                      stroke={color}
                      strokeWidth={strokeW}
                      strokeDasharray="2 2"
                      opacity={lineOpacity > 0.4 ? 0.8 : 0.3}
                    />
                  )}
                  {dotR > 0 && (
                    <circle
                      cx={x}
                      cy={yTarget}
                      r={dotR}
                      fill={color}
                      stroke="var(--surface)"
                      strokeWidth={1.5}
                    />
                  )}
                </g>
              );
            })}

          {/* RUN PLAY VECTORS (Hidden by default in the strip; revealed on gap hover/click) */}
          {showVectors && (view === 'both' || view === 'run') &&
            runPlays.map((r, i) => {
              const x = gapX(r.gap_key, i);
              const yBackfield = LOS_Y + 16;
              const yEnd = depthY(r.yards);
              const isTfl = r.yards < 0;

              const isThisGapFocused = effectiveFocusGap ? r.gap_key === effectiveFocusGap : false;

              // Hide run dots by default; reveal when gap is focused
              if (!isThisGapFocused && !r.touchdown) {
                return null;
              }

              const color = r.touchdown ? 'var(--series-2)' : isTfl ? '#ef4444' : 'var(--series-3)';
              const opacity = isThisGapFocused ? 0.85 : 0.65;

              return (
                <g key={`r-${r.play_id}`} opacity={opacity}>
                  <line
                    x1={x}
                    y1={yBackfield}
                    x2={x}
                    y2={yEnd}
                    stroke={color}
                    strokeWidth={r.touchdown ? 2.5 : 1.75}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={x}
                    cy={yEnd}
                    r={r.touchdown ? 4.5 : isTfl ? 3.5 : 3.0}
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth={1.2}
                  />
                </g>
              );
            })}

          {/* Legend */}
          <g fontSize={9.5} transform={`translate(40, ${H - 24})`}>
            <circle cx={4} cy={4} r={3.5} fill="#10b981" />
            <text x={12} y={7.5} fill="var(--ink-2)">Offense Advantage</text>

            <circle cx={190} cy={4} r={3.5} fill="#eab308" />
            <text x={198} y={7.5} fill="var(--ink-2)">Defense Advantage</text>

            <circle cx={380} cy={4} r={3.5} fill="#dc2626" />
            <text x={390} y={7.5} fill="var(--ink-2)">Touchdown</text>
          </g>
        </svg>

        {/* Floating Progressive Disclosure Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(W - 250, Math.max(10, tooltip.x + 12)),
              top: Math.min(H - 180, Math.max(10, tooltip.y - 40)),
              width: 250,
              padding: '10px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--grid)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              pointerEvents: 'none',
              zIndex: 30,
              fontSize: 11,
              lineHeight: 1.35,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 800, color: 'var(--ink)' }}>{tooltip.title}</span>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 11,
                  color: tooltip.edge > 0 ? '#10b981' : tooltip.edge < 0 ? '#eab308' : 'var(--muted)',
                }}
              >
                {tooltip.edge > 0 ? `+${tooltip.edge.toFixed(2)}` : tooltip.edge.toFixed(2)} Edge
              </span>
            </div>

            {tooltip.isSmallSample && (
              <div style={{ color: 'var(--series-4)', fontWeight: 700, fontSize: 10, marginBottom: 4 }}>
                ⚠ {tooltip.sampleNote}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--grid)', paddingTop: 5, marginTop: 4 }}>
              <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{tooltip.offenseHeader}</div>
              {tooltip.offenseLines.map((line, idx) => (
                <div key={idx} style={{ color: 'var(--ink-2)' }}>{line}</div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--grid)', paddingTop: 5, marginTop: 4 }}>
              <div style={{ fontWeight: 700, color: 'var(--muted)' }}>{tooltip.defenseHeader}</div>
              {tooltip.defenseLines.map((line, idx) => (
                <div key={idx} style={{ color: 'var(--muted)' }}>{line}</div>
              ))}
            </div>

            {tooltip.topReceiver && (
              <div style={{ borderTop: '1px solid var(--grid)', paddingTop: 5, marginTop: 4, fontWeight: 600, color: 'var(--series-1)' }}>
                {tooltip.topReceiver}
              </div>
            )}

            <div style={{ marginTop: 6, fontSize: 9.5, color: 'var(--muted)', fontStyle: 'italic' }}>
              {tooltip.hint}
            </div>
          </div>
        )}
      </div>

      {/* Selected Inspector Breakdown Card */}
      {(selectedZone || selectedGap) && isMyMapSelected && (
        <div
          ref={breakdownRef}
          style={{
            marginTop: 14,
            padding: '14px 16px',
            background: 'var(--page)',
            borderRadius: 10,
            border: '1px solid var(--grid)',
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          {selectedZone && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  {selectedZone.label} Matchup Breakdown
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: getFavorabilityStyle(selectedZone.advantage.tier, selectedZone.advantage.score).fill,
                      color: '#ffffff',
                    }}
                  >
                    {selectedZone.advantage.score > 0 ? `+${selectedZone.advantage.score.toFixed(2)}` : selectedZone.advantage.score.toFixed(2)} Edge
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectZoneKey?.(null, mapId)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}
                    title="Close breakdown"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--ink-2)' }}>
                {selectedZone.advantage.description}
                {selectedZone.offense.attempts < 8 && ' (Small sample alert: fewer than 8 attempts in this zone)'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, marginBottom: 14 }}>
                <div style={{ padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    {data.offense_team.abbr} Offense ({data.offense_sample_games.length} games)
                  </div>
                  <div>Targets/Att: <strong>{selectedZone.offense.attempts}</strong> ({selectedZone.offense.completions} comp, {Math.round(selectedZone.offense.comp_pct * 100)}%)</div>
                  <div>Yards: <strong>{selectedZone.offense.yards}</strong> ({selectedZone.offense.yards_per_att} Y/A)</div>
                  <div>EPA/play: <strong style={{ color: selectedZone.offense.epa_avg >= 0 ? 'var(--good)' : 'var(--bad)' }}>{selectedZone.offense.epa_avg > 0 ? `+${selectedZone.offense.epa_avg}` : selectedZone.offense.epa_avg}</strong></div>
                  <div>Success Rate: <strong>{Math.round(selectedZone.offense.success_rate * 100)}%</strong></div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    {data.defense_team.abbr} Defense Allowed ({data.defense_sample_games.length} games)
                  </div>
                  <div>Att Allowed: <strong>{selectedZone.defense.attempts}</strong> ({selectedZone.defense.completions} comp, {Math.round(selectedZone.defense.comp_pct * 100)}%)</div>
                  <div>Yards Allowed: <strong>{selectedZone.defense.yards}</strong> ({selectedZone.defense.yards_per_att} Y/A)</div>
                  <div>EPA Allowed/play: <strong style={{ color: selectedZone.defense.epa_avg >= 0 ? 'var(--bad)' : 'var(--good)' }}>{selectedZone.defense.epa_avg > 0 ? `+${selectedZone.defense.epa_avg}` : selectedZone.defense.epa_avg}</strong></div>
                  <div>Success Allowed: <strong>{Math.round(selectedZone.defense.success_rate * 100)}%</strong></div>
                </div>
              </div>

              {/* Top Receivers in this Zone */}
              {selectedZone.offense.top_receivers?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Top Receivers in {selectedZone.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>
                      ({data.offense_team.abbr} - last {data.offense_sample_games.length} games)
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--grid)', textAlign: 'left' }}>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' }}>Receiver</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Tgt</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Rec</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Catch%</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Yds</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Y/R</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>TD</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>EPA/t</th>
                          <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Succ%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedZone.offense.top_receivers.map((rec, rank) => {
                          const isTop = rank === 0;
                          return (
                            <tr
                              key={rec.player_id}
                              style={{
                                borderBottom: '1px solid var(--grid)',
                                background: isTop ? 'color-mix(in oklab, var(--series-1) 6%, transparent)' : 'transparent',
                              }}
                            >
                              <td style={{ padding: '6px 8px', fontWeight: isTop ? 800 : 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: '50%',
                                  background: isTop ? 'var(--series-1)' : 'var(--grid)',
                                  color: isTop ? '#fff' : 'var(--ink-2)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  flexShrink: 0,
                                }}>
                                  {rank + 1}
                                </span>
                                {rec.name}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{rec.targets}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{rec.catches}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: rec.comp_pct >= 0.6 ? 'var(--good)' : rec.comp_pct <= 0.4 ? 'var(--bad)' : 'var(--ink)' }}>
                                {Math.round(rec.comp_pct * 100)}%
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{rec.yards}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{rec.catches > 0 ? rec.ypr : '-'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: rec.touchdowns > 0 ? 'var(--series-2)' : 'var(--ink-2)', fontWeight: rec.touchdowns > 0 ? 800 : 400 }}>
                                {rec.touchdowns > 0 ? rec.touchdowns : '-'}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: rec.epa_avg >= 0.1 ? 'var(--good)' : rec.epa_avg <= -0.1 ? 'var(--bad)' : 'var(--ink-2)' }}>
                                {rec.epa_avg > 0 ? `+${rec.epa_avg.toFixed(2)}` : rec.epa_avg.toFixed(2)}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', color: rec.success_rate >= 0.5 ? 'var(--good)' : 'var(--ink-2)' }}>
                                {Math.round(rec.success_rate * 100)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedGap && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  {selectedGap.label} Gap Run Breakdown
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: getFavorabilityStyle(selectedGap.advantage.tier, selectedGap.advantage.score).fill,
                      color: '#ffffff',
                    }}
                  >
                    {selectedGap.advantage.score > 0 ? `+${selectedGap.advantage.score.toFixed(2)}` : selectedGap.advantage.score.toFixed(2)} Edge
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectGapKey?.(null, mapId)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}
                    title="Close breakdown"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p style={{ margin: '0 0 10px 0', fontSize: 12, color: 'var(--ink-2)' }}>
                {selectedGap.advantage.description}
                {selectedGap.offense.carries < 8 && ' (Small sample alert: fewer than 8 carries in this gap)'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div style={{ padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    {data.offense_team.abbr} Rushing ({data.offense_sample_games.length} games)
                  </div>
                  <div>Carries: <strong>{selectedGap.offense.carries}</strong> ({selectedGap.offense.touchdowns} TDs, {selectedGap.offense.tfls} TFLs)</div>
                  <div>Yards: <strong>{selectedGap.offense.yards}</strong> ({selectedGap.offense.ypc} YPC)</div>
                  <div>EPA/carry: <strong style={{ color: selectedGap.offense.epa_avg >= 0 ? 'var(--good)' : 'var(--bad)' }}>{selectedGap.offense.epa_avg > 0 ? `+${selectedGap.offense.epa_avg}` : selectedGap.offense.epa_avg}</strong></div>
                  <div>Success Rate: <strong>{Math.round(selectedGap.offense.success_rate * 100)}%</strong></div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    {data.defense_team.abbr} Run Defense Allowed ({data.defense_sample_games.length} games)
                  </div>
                  <div>Carries Allowed: <strong>{selectedGap.defense.carries}</strong> ({selectedGap.defense.touchdowns} TDs, {selectedGap.defense.tfls} Stops/TFL)</div>
                  <div>Yards Allowed: <strong>{selectedGap.defense.yards}</strong> ({selectedGap.defense.ypc} YPC)</div>
                  <div>EPA Allowed/carry: <strong style={{ color: selectedGap.defense.epa_avg >= 0 ? 'var(--bad)' : 'var(--good)' }}>{selectedGap.defense.epa_avg > 0 ? `+${selectedGap.defense.epa_avg}` : selectedGap.defense.epa_avg}</strong></div>
                  <div>Success Allowed: <strong>{Math.round(selectedGap.defense.success_rate * 100)}%</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Team Heatmap Component (used in Coaching > "Team's heatmap" tab)
// ---------------------------------------------------------------------------

interface SingleTeamHeatmapProps {
  data: TeamHeatmap;
}

export function SingleTeamHeatmap({ data }: SingleTeamHeatmapProps) {
  const [side, setSide] = useState<'offense' | 'defense'>('offense');
  const [view, setView] = useState<'both' | 'pass' | 'run'>('both');
  const [showVectors, setShowVectors] = useState(true);
  const [hoveredZoneKey, setHoveredZoneKey] = useState<string | null>(null);
  const [hoveredGapKey, setHoveredGapKey] = useState<string | null>(null);
  const [selectedZoneKey, setSelectedZoneKey] = useState<string | null>(null);
  const [selectedGapKey, setSelectedGapKey] = useState<string | null>(null);

  const activeUnit = side === 'offense' ? data.offense : data.defense;
  const maxZoneAtt = Math.max(1, ...activeUnit.passing.zones.map((z) => z.attempts));
  const maxGapCar = Math.max(1, ...activeUnit.rushing.gaps.map((g) => g.carries));

  const selectedZone = selectedZoneKey
    ? activeUnit.passing.zones.find((z) => `${z.location}-${z.depth_band}` === selectedZoneKey) ?? null
    : null;

  const selectedGap = selectedGapKey
    ? activeUnit.rushing.gaps.find((g) => g.gap_key === selectedGapKey) ?? null
    : null;

  const handleZoneClick = (loc: string, depth: string) => {
    const key = `${loc}-${depth}`;
    setSelectedZoneKey((prev) => (prev === key ? null : key));
    setSelectedGapKey(null);
  };

  const handleGapClick = (gapKey: string) => {
    setSelectedGapKey((prev) => (prev === gapKey ? null : gapKey));
    setSelectedZoneKey(null);
  };

  const effectiveFocusZone = selectedZoneKey ?? hoveredZoneKey;
  const effectiveFocusGap = selectedGapKey ?? hoveredGapKey;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Unit & Type Toggles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="btn-group" style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
            <button
              type="button"
              className={side === 'offense' ? 'active' : ''}
              onClick={() => { setSide('offense'); setSelectedZoneKey(null); setSelectedGapKey(null); }}
              style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: 'none', background: side === 'offense' ? 'var(--series-1)' : 'transparent', color: side === 'offense' ? '#fff' : 'var(--ink)', cursor: 'pointer', fontWeight: 700 }}
            >
              Offense Field Map
            </button>
            <button
              type="button"
              className={side === 'defense' ? 'active' : ''}
              onClick={() => { setSide('defense'); setSelectedZoneKey(null); setSelectedGapKey(null); }}
              style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: 'none', background: side === 'defense' ? 'var(--series-2)' : 'transparent', color: side === 'defense' ? '#fff' : 'var(--ink)', cursor: 'pointer', fontWeight: 700 }}
            >
              Defense Stop Map
            </button>
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Rolling {data.sample_games.length} games (click a zone to see top receivers)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="btn-group" style={{ display: 'inline-flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
            <button
              type="button"
              onClick={() => setView('both')}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: 'none', background: view === 'both' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Both
            </button>
            <button
              type="button"
              onClick={() => setView('pass')}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: 'none', background: view === 'pass' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Passing
            </button>
            <button
              type="button"
              onClick={() => setView('run')}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: 'none', background: view === 'run' ? 'var(--page)' : 'transparent', color: 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}
            >
              Rushing
            </button>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showVectors}
              onChange={(e) => setShowVectors(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Show trails
          </label>
        </div>
      </div>

      {/* SVG Field */}
      <div className="card" style={{ padding: '20px', maxWidth: 640, margin: '0 auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${data.team.name} ${side} field heatmap`}
          style={{ width: '100%', display: 'block', margin: '0 auto' }}
        >
          {/* Field Background */}
          <rect
            x={36}
            y={8}
            width={488}
            height={LOS_Y - 8}
            rx={10}
            fill="color-mix(in oklab, var(--series-3) 7%, var(--surface))"
            stroke="var(--grid)"
          />

          {/* Yard lines */}
          {[0, 10, 20, 30, 40].map((yd) => (
            <g key={yd}>
              <line
                x1={38}
                x2={522}
                y1={depthY(yd)}
                y2={depthY(yd)}
                stroke={yd === 0 ? 'var(--baseline)' : 'var(--grid)'}
                strokeWidth={yd === 0 ? 1.8 : 0.8}
              />
              <text
                x={518}
                y={depthY(yd) - 4}
                textAnchor="end"
                fontSize={9.5}
                fill="var(--muted)"
                fontWeight={yd === 0 ? 700 : 400}
              >
                {yd === 0 ? 'LOS' : `+${yd}`}
              </text>
            </g>
          ))}

          {/* Pass Zones with generous padding */}
          {(view === 'both' || view === 'pass') &&
            activeUnit.passing.zones.map((z) => {
              const boxGroup = ZONE_BOXES[z.depth_band];
              const box = boxGroup ? boxGroup[z.location] : null;
              if (!box) return null;

              const volumeStrength = (z.attempts / maxZoneAtt) * 0.35;
              const good = side === 'offense' ? z.epa_avg >= 0 : z.epa_avg < 0;
              const key = `${z.location}-${z.depth_band}`;
              const isSelected = selectedZoneKey === key;
              const isHovered = hoveredZoneKey === key;
              const isSmallSample = z.attempts < 8;

              return (
                <g
                  key={`single-zone-${key}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${z.label} pass zone`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onClick={() => handleZoneClick(z.location, z.depth_band)}
                  onMouseEnter={() => setHoveredZoneKey(key)}
                  onMouseLeave={() => setHoveredZoneKey(null)}
                >
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={9}
                    fill={side === 'offense' ? 'var(--series-1)' : 'var(--series-2)'}
                    opacity={isSelected || isHovered ? 0.45 : isSmallSample ? Math.max(0.06, volumeStrength * 0.75) : Math.max(0.08, volumeStrength)}
                    stroke={isSelected ? '#ffffff' : isHovered ? 'var(--ink)' : z.attempts === maxZoneAtt ? 'var(--series-1)' : 'var(--border)'}
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                    strokeDasharray={isSelected ? undefined : isSmallSample ? '4 3' : '4 3'}
                  />
                  <text
                    x={box.x + 12}
                    y={box.y + 22}
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--ink)"
                  >
                    {z.label}
                  </text>
                  <text
                    x={box.x + 12}
                    y={box.y + 40}
                    fontSize={13}
                    fontWeight={800}
                    fill={good ? 'var(--good)' : 'var(--muted)'}
                  >
                    {z.attempts} att · {Math.round(z.comp_pct * 100)}%
                  </text>
                  <text
                    x={box.x + 12}
                    y={box.y + 56}
                    fontSize={10}
                    fill="var(--ink-2)"
                  >
                    {z.epa_avg > 0 ? `+${z.epa_avg.toFixed(2)}` : z.epa_avg.toFixed(2)} EPA · {z.yards} yds
                  </text>
                </g>
              );
            })}

          {/* Run Gaps */}
          {(view === 'both' || view === 'run') &&
            activeUnit.rushing.gaps.map((g) => {
              const conf = GAP_CONFIG[g.gap_key] ?? GAP_CONFIG['middle'];
              const volumeStrength = (g.carries / maxGapCar) * 0.35;
              const isSelected = selectedGapKey === g.gap_key;
              const isHovered = hoveredGapKey === g.gap_key;
              const isSmallSample = g.carries < 8;

              return (
                <g
                  key={`single-gap-${g.gap_key}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${conf.fullName} run gap`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onClick={() => handleGapClick(g.gap_key)}
                  onMouseEnter={() => setHoveredGapKey(g.gap_key)}
                  onMouseLeave={() => setHoveredGapKey(null)}
                >
                  <rect
                    x={conf.x}
                    y={LOS_Y - 15}
                    width={conf.w}
                    height={30}
                    rx={6}
                    fill={side === 'offense' ? 'var(--series-3)' : 'var(--series-4)'}
                    opacity={isSelected || isHovered ? 0.5 : Math.max(0.1, volumeStrength)}
                    stroke={isSelected ? '#ffffff' : isHovered ? 'var(--ink)' : 'var(--border)'}
                    strokeWidth={isSelected ? 2 : isHovered ? 1.8 : 1}
                    strokeDasharray={isSmallSample ? '3 2' : undefined}
                  />
                  <text
                    x={conf.x + conf.w / 2}
                    y={LOS_Y - 3}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={800}
                    fill="var(--ink)"
                  >
                    {conf.abbr}
                  </text>
                  <text
                    x={conf.x + conf.w / 2}
                    y={LOS_Y + 9}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={600}
                    fill="var(--ink-2)"
                  >
                    {g.carries}c · {g.ypc}y
                  </text>
                </g>
              );
            })}

          {/* Individual Pass Play Vectors */}
          {showVectors && (view === 'both' || view === 'pass') &&
            activeUnit.passing.plays.map((p, i) => {
              const x = laneX(p.location, i);
              const yTarget = depthY(p.depth);
              const color = p.touchdown ? '#dc2626' : p.complete ? 'var(--series-1)' : 'var(--muted)';
              const bend = p.location === 'left' ? -20 : p.location === 'right' ? 20 : 0;
              const yacY = p.complete && p.yac ? Math.max(14, yTarget - p.yac * PX_PER_YD) : null;

              const playZoneKey = `${p.location}-${p.depth_band}`;
              const isInFocusZone = effectiveFocusZone ? playZoneKey === effectiveFocusZone : false;

              let lineOpacity = 0.38;
              let strokeW = 1.4;
              let dotR = 2.4;

              if (effectiveFocusZone) {
                if (isInFocusZone) {
                  lineOpacity = p.touchdown ? 1.0 : p.complete ? 0.90 : 0.45;
                  strokeW = 1.8;
                  dotR = p.touchdown ? 4.0 : 3.5;
                } else if (p.touchdown) {
                  lineOpacity = 0.48;
                  strokeW = 1.4;
                  dotR = 3.0;
                } else {
                  lineOpacity = 0.05;
                  strokeW = 0.8;
                  dotR = 0;
                }
              } else {
                if (p.touchdown) {
                  lineOpacity = 0.48;
                  strokeW = 1.4;
                  dotR = 3.0;
                } else if (p.complete) {
                  lineOpacity = 0.38;
                  strokeW = 1.4;
                  dotR = 2.4;
                } else {
                  lineOpacity = 0.16;
                  strokeW = 1.0;
                  dotR = 0;
                }
              }

              return (
                <g key={`sp-${p.play_id}`} opacity={lineOpacity}>
                  <path
                    d={`M 280 ${LOS_Y} Q ${x - bend} ${(LOS_Y + yTarget) / 2} ${x} ${yTarget}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeDasharray={p.complete ? undefined : '3 3'}
                  />
                  {yacY != null && (
                    <line x1={x} y1={yTarget} x2={x} y2={yacY} stroke={color} strokeWidth={strokeW} strokeDasharray="2 2" opacity={lineOpacity > 0.4 ? 0.8 : 0.3} />
                  )}
                  {dotR > 0 && (
                    <circle cx={x} cy={yTarget} r={dotR} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
                  )}
                </g>
              );
            })}

          {/* Individual Run Play Vectors (revealed on gap focus) */}
          {showVectors && (view === 'both' || view === 'run') &&
            activeUnit.rushing.plays.map((r, i) => {
              const x = gapX(r.gap_key, i);
              const yBackfield = LOS_Y + 16;
              const yEnd = depthY(r.yards);
              const isTfl = r.yards < 0;

              const isThisGapFocused = effectiveFocusGap ? r.gap_key === effectiveFocusGap : false;

              if (!isThisGapFocused && !r.touchdown) {
                return null;
              }

              const color = r.touchdown ? 'var(--series-2)' : isTfl ? '#ef4444' : 'var(--series-3)';
              const opacity = isThisGapFocused ? 0.85 : 0.65;

              return (
                <g key={`sr-${r.play_id}`} opacity={opacity}>
                  <line x1={x} y1={yBackfield} x2={x} y2={yEnd} stroke={color} strokeWidth={r.touchdown ? 2.5 : 1.75} strokeLinecap="round" />
                  <circle cx={x} cy={yEnd} r={r.touchdown ? 4.5 : isTfl ? 3.5 : 3.0} fill={color} stroke="var(--surface)" strokeWidth={1.2} />
                </g>
              );
            })}

          {/* Legend */}
          <g fontSize={10} transform={`translate(40, ${H - 24})`}>
            <circle cx={4} cy={0} r={4} fill="var(--series-1)" />
            <text x={14} y={4} fill="var(--ink-2)">Catch / Completion</text>
            <circle cx={160} cy={0} r={4} fill="var(--series-3)" />
            <text x={170} y={4} fill="var(--ink-2)">Run Gain</text>
            <circle cx={270} cy={0} r={4} fill="#ef4444" />
            <text x={280} y={4} fill="var(--ink-2)">Tackle for loss / Stop</text>
            <circle cx={440} cy={0} r={4.5} fill="var(--series-2)" />
            <text x={450} y={4} fill="var(--ink-2)">Touchdown</text>
          </g>
        </svg>
      </div>

      {/* Receiver Inspector for selected zone */}
      {selectedZone && (view === 'both' || view === 'pass') && (
        <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--page)', borderRadius: 10, border: '1px solid var(--grid)' }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Top Receivers in {selectedZone.label}</span>
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>
              {side === 'offense' ? `${data.team.abbr} offense` : `Opponents targeting ${data.team.abbr} defense`} ({data.sample_games.length} games)
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
              {selectedZone.attempts} att · {Math.round(selectedZone.comp_pct * 100)}% catch · {selectedZone.yards} yds · {selectedZone.epa_avg > 0 ? `+${selectedZone.epa_avg.toFixed(2)}` : selectedZone.epa_avg.toFixed(2)} EPA/t
            </span>
            <button
              type="button"
              onClick={() => setSelectedZoneKey(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}
              title="Close"
            >
              ✕
            </button>
          </div>

          {selectedZone.top_receivers?.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--grid)' }}>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'left' }}>Receiver</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Tgt</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Rec</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Catch%</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Yds</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Y/R</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>TD</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>EPA/t</th>
                    <th style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', textAlign: 'right' }}>Succ%</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedZone.top_receivers.map((rec, rank) => {
                    const isTop = rank === 0;
                    const shareOfZone = selectedZone.attempts > 0
                      ? Math.round((rec.targets / selectedZone.attempts) * 100)
                      : 0;
                    return (
                      <tr
                        key={rec.player_id}
                        style={{
                          borderBottom: '1px solid var(--grid)',
                          background: isTop ? 'color-mix(in oklab, var(--series-1) 6%, transparent)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '7px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: isTop ? 'var(--series-1)' : 'var(--grid)',
                              color: isTop ? '#fff' : 'var(--ink-2)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 800,
                              flexShrink: 0,
                            }}>
                              {rank + 1}
                            </span>
                            <div>
                              <div style={{ fontWeight: isTop ? 800 : 600, color: 'var(--ink)' }}>{rec.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{shareOfZone}% of zone targets</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{rec.targets}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{rec.catches}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, color: rec.comp_pct >= 0.6 ? 'var(--good)' : rec.comp_pct <= 0.35 ? 'var(--bad)' : 'var(--ink)' }}>
                          {Math.round(rec.comp_pct * 100)}%
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600 }}>{rec.yards}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--ink-2)' }}>
                          {rec.catches > 0 ? rec.ypr : '-'}
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: rec.touchdowns > 0 ? 'var(--series-2)' : 'var(--ink-2)', fontWeight: rec.touchdowns > 0 ? 800 : 400 }}>
                          {rec.touchdowns > 0 ? rec.touchdowns : '-'}
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: rec.epa_avg >= 0.1 ? 'var(--good)' : rec.epa_avg <= -0.1 ? 'var(--bad)' : 'var(--ink-2)' }}>
                          {rec.epa_avg > 0 ? `+${rec.epa_avg.toFixed(2)}` : rec.epa_avg.toFixed(2)}
                        </td>
                        <td style={{ padding: '7px 8px', textAlign: 'right', color: rec.success_rate >= 0.5 ? 'var(--good)' : 'var(--ink-2)' }}>
                          {Math.round(rec.success_rate * 100)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No receiver data recorded in this zone for the selected sample.
            </div>
          )}
        </div>
      )}

      {/* Run Gap Inspector for selected gap */}
      {selectedGap && (view === 'both' || view === 'run') && (
        <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--page)', borderRadius: 10, border: '1px solid var(--grid)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>
              {selectedGap.label} Gap Run Breakdown
            </span>
            <button
              type="button"
              onClick={() => setSelectedGapKey(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}
              title="Close"
            >
              ✕
            </button>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
              {side === 'offense' ? `${data.team.abbr} Rushing` : `Opponent Rushing vs ${data.team.abbr} Defense`} ({data.sample_games.length} games)
            </div>
            <div>Carries: <strong>{selectedGap.carries}</strong> ({selectedGap.touchdowns} TDs, {selectedGap.tfls} {side === 'offense' ? 'TFLs' : 'Stops'})</div>
            <div>Yards: <strong>{selectedGap.yards}</strong> ({selectedGap.ypc} YPC)</div>
            <div>EPA/carry: <strong style={{ color: selectedGap.epa_avg >= 0 ? (side === 'offense' ? 'var(--good)' : 'var(--bad)') : (side === 'offense' ? 'var(--bad)' : 'var(--good)') }}>{selectedGap.epa_avg > 0 ? `+${selectedGap.epa_avg.toFixed(2)}` : selectedGap.epa_avg.toFixed(2)}</strong></div>
            <div>Success Rate: <strong>{Math.round(selectedGap.success_rate * 100)}%</strong></div>
          </div>
        </div>
      )}
    </div>
  );
}
