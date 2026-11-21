import { api } from '../api';
import MatchupHeatmapShell from '../components/MatchupHeatmapShell';

const RED_ZONE_WINDOWS = [
  { value: 8, label: 'Last 8 games' },
  { value: 16, label: 'Last 16 games' },
  { value: 32, label: 'Full season' },
];

export default function RedZonePage() {
  return (
    <MatchupHeatmapShell
      fetchMatchup={api.redzoneMatchup}
      redZone
      title="Red-Zone Matchup"
      subtitle="Offense overlayed on Defense inside the opponent's 20-yard line."
      defaultWindow={16}
      windowOptions={RED_ZONE_WINDOWS}
      note="Distances are measured from the line of scrimmage; plays are capped at the goal line."
    />
  );
}
