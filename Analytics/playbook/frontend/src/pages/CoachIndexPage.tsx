import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { TeamTotals } from '../api';
import { PHASE_LABEL, useSeason } from '../state';

const CONFERENCES = ['AFC', 'NFC'];
const DIVISIONS = ['East', 'North', 'South', 'West'];

const pct = (t: TeamTotals) => {
  const g = t.wins + t.losses + t.ties;
  return g ? (t.wins + t.ties / 2) / g : 0;
};
const rank = (list: string[], v: string) => {
  const i = list.indexOf(v);
  return i < 0 ? list.length : i;
};

// conference, then division, then standing within the division (win pct, then wins)
function byStanding(a: TeamTotals, b: TeamTotals) {
  const [ac, ad] = (a.division ?? '').split(' ');
  const [bc, bd] = (b.division ?? '').split(' ');
  return rank(CONFERENCES, ac) - rank(CONFERENCES, bc)
    || rank(DIVISIONS, ad) - rank(DIVISIONS, bd)
    || pct(b) - pct(a)
    || b.wins - a.wins
    || a.name.localeCompare(b.name);
}

// The coaching profile is per team (/coach/:abbr), so the nav entry needs a
// landing page. Same team grid as TeamsPage, minus the yardage rows -- the
// point here is picking a team, not comparing them.
export default function CoachIndexPage() {
  const { season, phase } = useSeason();
  const [teams, setTeams] = useState<TeamTotals[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTeams(null); setError(null);
    api.teams(season, phase).then(setTeams).catch((e) => setError(String(e)));
  }, [season, phase]);

  if (error) return <div className="error-box">Couldn’t load teams: {error}</div>;
  if (!teams) return <div className="loading">Loading teams…</div>;

  const active = teams.filter((t) => t.games > 0).sort(byStanding);

  return (
    <>
      <div className="page-head">
        <h1>Coaching</h1>
        <span className="sub">
          {season} {PHASE_LABEL[phase]?.toLowerCase()} · pick a team for its playbook, drives, usage and defensive profile
        </span>
      </div>
      {!active.length && <div className="loading">No games played yet for this phase.</div>}
      <div className="grid teams-grid">
        {active.map((t) => (
          <Link key={t.abbr} to={`/coach/${t.abbr}`} className="card team-card"
            style={{ ['--team-color' as string]: t.color ?? 'var(--series-1)' }}>
            <div className="head">
              {t.logo && <img src={t.logo} alt="" loading="lazy" />}
              <div>
                <h3>{t.name}</h3>
                <div className="sub">{t.division ?? ''} · {t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
