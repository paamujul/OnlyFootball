import { api } from '../api';
import MatchupHeatmapShell from '../components/MatchupHeatmapShell';

export default function HeatmapPage() {
  return (
    <MatchupHeatmapShell
      fetchMatchup={api.heatmapMatchup}
      title="Matchup Heat Map"
      defaultWindow={4}
    />
  );
}
