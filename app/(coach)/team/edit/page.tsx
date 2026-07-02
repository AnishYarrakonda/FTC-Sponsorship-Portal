import { permanentRedirect } from 'next/navigation'

export default function LegacyTeamEditPage() {
  permanentRedirect('/dashboard?tab=portfolio')
}
