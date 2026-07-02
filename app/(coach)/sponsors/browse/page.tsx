import { permanentRedirect } from 'next/navigation'

export default function LegacySponsorsBrowsePage() {
  permanentRedirect('/dashboard?tab=sponsors')
}
