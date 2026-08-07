'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { teamOnboardingSchema, teamOnboardingBaseSchema, type TeamOnboardingInput } from '@/lib/schemas/team'
import { achievementSchema, type AchievementInput } from '@/lib/schemas/achievement'
import { validateFTCTeam, type FTCTeam } from '@/lib/ftc-roster'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'
import { validateUploadedFile, IMAGE_MIMES } from '@/lib/file-validation'

function normalizePressLinks(
  links: TeamOnboardingInput['pressLinks'] | undefined
): { label: string; url: string }[] {
  return (links || []).map(link => ({ label: link.label.trim(), url: link.url.trim() }))
}

function normalizeBudgetItems(
  items: TeamOnboardingInput['budgetItems'] | undefined
): { label: string; qty: number; unit_cost_cents: number; total_cents: number }[] {
  return (items || []).map(item => ({
    label: item.label.trim(),
    qty: item.qty,
    unit_cost_cents: item.unitCostCents,
    total_cents: item.totalCents,
  }))
}

export async function lookupFTCTeam(
  teamNumber: number
): Promise<{ team: FTCTeam; error?: never } | { team?: never; error: string }> {
  if (!teamNumber || teamNumber <= 0) {
    return { error: 'Invalid team number' }
  }

  const team = await validateFTCTeam(teamNumber)
  if (!team) {
    return { error: `FTC Team #${teamNumber} could not be found in the FIRST registry.` }
  }
  return { team }
}

export async function createTeam(data: TeamOnboardingInput) {
  const result = teamOnboardingSchema.safeParse(data)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid data provided', details: result.error.format() }
  }

  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' }
  }

  const payloadData = result.data

  if (payloadData.status === 'existing' && payloadData.ftcTeamNumber) {
    const ftcData = await validateFTCTeam(payloadData.ftcTeamNumber)
    if (!ftcData) {
      return { error: `FTC Team #${payloadData.ftcTeamNumber} could not be found in the FIRST registry.` }
    }
  }

  const normalizedBudgetItems = normalizeBudgetItems(payloadData.budgetItems)
  const totalAsk = normalizedBudgetItems.reduce((sum, item) => sum + item.total_cents, 0)

  // P0-14: teams.slug is NOT NULL UNIQUE with no DB default (0046:5,20). This insert
  // omitted it and the `as never` cast at the call below hid that from tsc.
  const teamName = payloadData.teamName.trim()
  const baseSlug = deriveTeamSlug(teamName, payloadData.ftcTeamNumber)

  const teamPayload = {
    owner_id: user.id,
    status: payloadData.status,
    ftc_team_number: payloadData.ftcTeamNumber ?? null,
    team_name: teamName,
    slug: baseSlug,
    organization: payloadData.organization?.trim() || null,
    city: payloadData.city.trim(),
    state: payloadData.state.trim(),
    tagline: payloadData.tagline?.trim() || null,
    mission_statement: payloadData.missionStatement.trim(),
    tax_status: payloadData.taxStatus,
    community_interest_text: payloadData.communityInterestText?.trim() || null,
    student_interest_count: payloadData.studentInterestCount ?? 0,
    sustainability_plan: payloadData.sustainabilityPlan?.trim() || null,
    seed_funding_goals_cents: payloadData.seedFundingGoalsCents ?? 0,
    technical_summary: payloadData.technicalSummary?.trim() || null,
    outreach_summary: payloadData.outreachSummary?.trim() || null,
    media_urls: payloadData.mediaUrls || [],
    youtube_url: payloadData.youtubeUrl || null,
    budget_items: normalizedBudgetItems,
    financial_ask_cents: totalAsk,
    github_link: payloadData.githubLink?.trim() || null,
    subteam_breakdown: payloadData.subteamBreakdown?.trim() || null,
    visual_pitch_items: payloadData.visualPitchItems ?? [],
    coach_photo_url: payloadData.coachPhotoUrl ?? null,
    // Team Story & People
    founded_year: payloadData.foundedYear ?? null,
    team_size: payloadData.teamSize ?? null,
    seasons_competed: payloadData.seasonsCompeted ?? null,
    coach_experience: payloadData.coachExperience?.trim() || null,
    // Credibility
    past_sponsors: payloadData.pastSponsors ?? [],
    press_links: normalizePressLinks(payloadData.pressLinks),
    community_endorsements: payloadData.communityEndorsements?.trim() || null,
    // Community & Ethics Impact
    students_reached: payloadData.studentsReached ?? null,
    events_hosted: payloadData.eventsHosted ?? null,
    volunteer_hours: payloadData.volunteerHours ?? null,
  }

  // Keep onboarding idempotent: one owner should map to one team profile.
  const { data: existingTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let teamId: string | null = null

  if (existingTeam?.id) {
    // An existing team keeps the slug it already has: it may be linked from elsewhere,
    // and re-deriving it from a renamed team would silently break those links.
    // Destructured rather than `as Record<string, unknown>` + delete, so the payload
    // stays fully typed against the generated Update type.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { owner_id: _ownerId, slug: _slug, ...updatePayload } = teamPayload
    const { data: updated, error: updateError } = await supabase
      .from('teams')
      .update(updatePayload)
      .eq('id', existingTeam.id)
      .eq('owner_id', user.id)
      .select('id')
      .single()

    if (updateError) {
      return { error: mapDbError(updateError, 'team.create.update') }
    }
    teamId = updated.id
  } else {
    let { data: team, error } = await supabase
      .from('teams')
      .insert(teamPayload)
      .select('id')
      .single()

    // Two teams can share a name, so a slug collision is expected, not exceptional.
    if (error?.code === '23505') {
      ;({ data: team, error } = await supabase
        .from('teams')
        .insert({ ...teamPayload, slug: uniquifyTeamSlug(baseSlug) })
        .select('id')
        .single())
    }

    if (error) {
      return { error: mapDbError(error, 'team.create.insert') }
    }
    teamId = team!.id
  }

  // Audit log — coach create is a material event admins should see
  const admin = createAdminClient()
  const { error: createAuditError } = await admin.from('audit_log').insert({
    actor_id: user.id,
    action: 'create_team',
    entity_type: 'teams',
    entity_id: teamId,
    metadata: { team_name: payloadData.teamName, status: payloadData.status },
  })
  if (createAuditError) {
    console.error('Failed to write create_team audit log:', createAuditError.message)
  }

  redirect('/dashboard')
}

export async function uploadTeamLogo(teamId: string, formData: FormData) {
  let user, supabase, clerkUserId
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
    clerkUserId = auth.clerkUserId
  } catch {
    return { error: 'Not authenticated' }
  }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { error: 'No file provided' }

  // Was: trust `file.name`'s extension, trust `file.type`, then store the object in a
  // PUBLIC bucket with `contentType: file.type`. Both inputs are attacker-controlled, so
  // arbitrary bytes could be hosted under a content type of the uploader's choosing.
  // Now validated by MIME allowlist + magic bytes, and both the path extension and the
  // stored content type are derived from the VERIFIED type, never from the filename.
  const validation = await validateUploadedFile(file, {
    allowedMimes: IMAGE_MIMES,
    maxBytes: 2 * 1024 * 1024,
    label: 'Logo',
  })
  if (validation.error) return { error: validation.error }
  const { ext, mime } = validation

  const filePath = `${clerkUserId}/${teamId}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('team-logos')
    .upload(filePath, file, { upsert: true, contentType: mime })

  if (uploadError) return { error: uploadError.message }

  const { data: urlData } = supabase.storage.from('team-logos').getPublicUrl(filePath)

  const { error: updateError } = await supabase
    .from('teams')
    .update({ logo_url: urlData.publicUrl })
    .eq('id', teamId)
    .eq('owner_id', user.id)

  if (updateError) return { error: mapDbError(updateError, 'team.uploadLogo') }

  return { success: true, url: urlData.publicUrl }
}

export async function updateTeam(id: string, data: Partial<TeamOnboardingInput>) {
  // STEP 1 — VALIDATE. This action was the ONLY mutating action in app/actions/* missing
  // step 1 of the project's canonical 5-step shape: createTeam validated, the edit path
  // did not. Everything the schema enforces was bypassable through it — the
  // supabase-host allowlist on mediaUrls, pressLinks[].url validation, every LIMITS
  // length cap (the DB columns are bare `text`), the budget-item bounds, and the
  // cross-field rule that budget items must sum to financialAskCents.
  //
  // `.partial()` because this is a patch: the coach's portfolio is saved section by
  // section and a full-object schema would reject every partial save.
  const parsed = teamOnboardingBaseSchema.partial().safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  // Build from parsed.data, never from the raw input — otherwise validation is decorative.
  const clean = parsed.data

  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' }
  }

  const updatePayload: Record<string, unknown> = {}

  // status / ftcTeamNumber had NO branch here at all, while createTeam writes both
  // (team.ts:77-78). The only caller that needs them is the incubator-graduation flow in
  // components/coach/dashboard-shell.tsx, which sends {status,ftcTeamNumber,teamName} —
  // so graduation wrote the name, left status='incubator' and ftc_team_number NULL, and
  // still toasted "Congratulations! You are now an official Existing Team." The coach
  // could repeat it forever. (An `as any` at that call site is what hid it from tsc —
  // the same cast-hides-a-dropped-field pattern as P0-14.)
  if (clean.status) updatePayload.status = clean.status
  if (clean.ftcTeamNumber !== undefined) updatePayload.ftc_team_number = clean.ftcTeamNumber ?? null
  if (typeof clean.teamName === 'string') updatePayload.team_name = clean.teamName.trim()
  if (typeof clean.organization === 'string') updatePayload.organization = clean.organization.trim() || null
  if (typeof clean.city === 'string') updatePayload.city = clean.city.trim()
  if (typeof clean.state === 'string') updatePayload.state = clean.state.trim()
  if (clean.tagline !== undefined) updatePayload.tagline = clean.tagline?.trim() || null
  if (typeof clean.missionStatement === 'string') updatePayload.mission_statement = clean.missionStatement.trim()
  if (clean.taxStatus) updatePayload.tax_status = clean.taxStatus
  if (clean.communityInterestText !== undefined) updatePayload.community_interest_text = clean.communityInterestText?.trim() || null
  if (clean.studentInterestCount !== undefined) updatePayload.student_interest_count = clean.studentInterestCount
  if (clean.sustainabilityPlan !== undefined) updatePayload.sustainability_plan = clean.sustainabilityPlan?.trim() || null
  if (clean.seedFundingGoalsCents !== undefined) updatePayload.seed_funding_goals_cents = clean.seedFundingGoalsCents
  if (clean.technicalSummary !== undefined) updatePayload.technical_summary = clean.technicalSummary?.trim() || null
  if (clean.outreachSummary !== undefined) updatePayload.outreach_summary = clean.outreachSummary?.trim() || null
  if (clean.mediaUrls !== undefined) updatePayload.media_urls = clean.mediaUrls
  if (clean.youtubeUrl !== undefined) updatePayload.youtube_url = clean.youtubeUrl || null

  if (clean.budgetItems !== undefined) {
    const normalizedBudgetItems = normalizeBudgetItems(clean.budgetItems as TeamOnboardingInput['budgetItems'])
    updatePayload.budget_items = normalizedBudgetItems
    updatePayload.financial_ask_cents = normalizedBudgetItems.reduce((sum, item) => sum + item.total_cents, 0)
  }
  // Deliberately NO `else if (clean.financialAskCents)` branch.
  // lib/schemas/team.ts justifies dropping the cross-field refinement for the patch path
  // by asserting that updateTeam always derives financial_ask_cents from budgetItems —
  // an else-branch accepting a client-supplied figure made that assertion false, and the
  // value flows straight into submissions.requested_amount_cents (submission.ts:105) and
  // is reserved against the sponsor's cap by approve_submission_atomic. The ask is now
  // ALWAYS the sum of the line items, which is what the portfolio UI shows the coach.

  if (clean.githubLink !== undefined) updatePayload.github_link = clean.githubLink?.trim() || null
  if (clean.subteamBreakdown !== undefined) updatePayload.subteam_breakdown = clean.subteamBreakdown?.trim() || null
  if (clean.visualPitchItems !== undefined) updatePayload.visual_pitch_items = clean.visualPitchItems
  if (clean.coachPhotoUrl !== undefined) updatePayload.coach_photo_url = clean.coachPhotoUrl || null
  // Team Story & People
  if (clean.foundedYear !== undefined) updatePayload.founded_year = clean.foundedYear ?? null
  if (clean.teamSize !== undefined) updatePayload.team_size = clean.teamSize ?? null
  if (clean.seasonsCompeted !== undefined) updatePayload.seasons_competed = clean.seasonsCompeted ?? null
  if (clean.coachExperience !== undefined) updatePayload.coach_experience = clean.coachExperience?.trim() || null
  // Credibility
  if (clean.pastSponsors !== undefined) updatePayload.past_sponsors = clean.pastSponsors ?? []
  if (clean.pressLinks !== undefined) updatePayload.press_links = normalizePressLinks(clean.pressLinks)
  if (clean.communityEndorsements !== undefined) updatePayload.community_endorsements = clean.communityEndorsements?.trim() || null
  // Community & Ethics Impact
  if (clean.studentsReached !== undefined) updatePayload.students_reached = clean.studentsReached ?? null
  if (clean.eventsHosted !== undefined) updatePayload.events_hosted = clean.eventsHosted ?? null
  if (clean.volunteerHours !== undefined) updatePayload.volunteer_hours = clean.volunteerHours ?? null

  if (Object.keys(updatePayload).length === 0) {
    return { success: true }
  }

  const { error } = await supabase
    .from('teams')
    .update(updatePayload as never)
    .eq('id', id)
    .eq('owner_id', user.id)

  if (error) {
    return { error: mapDbError(error, 'team.update') }
  }

  // Handle achievements sync. Only rewrite when the content actually changed, so an
  // unchanged save doesn't churn achievement ids/created_at or spend two extra DB
  // round-trips deleting and re-inserting identical rows.
  if (clean.achievements) {
    const incoming = clean.achievements.map(a => ({
      team_id: id,
      season: a.season,
      event_name: a.eventName,
      award: a.award,
      description: a.description ?? null,
    }))

    const { data: existing } = await supabase
      .from('team_achievements')
      .select('season, event_name, award, description')
      .eq('team_id', id)

    const signature = (a: { season?: string | null; event_name?: string | null; award?: string | null; description?: string | null }) =>
      JSON.stringify([a.season ?? null, a.event_name ?? null, a.award ?? null, a.description ?? null])
    const existingSigs = (existing ?? []).map(signature).sort()
    const incomingSigs = incoming.map(signature).sort()
    const unchanged =
      existingSigs.length === incomingSigs.length &&
      existingSigs.every((s, i) => s === incomingSigs[i])

    if (!unchanged) {
      // This sequence DELETES every achievement and then re-inserts. If the re-insert
      // fails the coach has silently lost their entire awards history and the action
      // still returned {success:true}. There is no transaction available through
      // PostgREST, so the delete is not attempted until the payload is known-good, the
      // delete itself is checked, and a failed re-insert is reported rather than
      // swallowed — with the rows we tried to write echoed to the log so they are
      // recoverable from Vercel's runtime logs.
      const { error: delError } = await supabase.from('team_achievements').delete().eq('team_id', id)
      if (delError) {
        return { error: mapDbError(delError, 'team.update.achievements.delete') }
      }

      if (incoming.length > 0) {
        const { error: achError } = await supabase.from('team_achievements').insert(incoming)
        if (achError) {
          console.error(
            'Failed to re-insert achievements after delete — the team update was saved but the ' +
              'achievements list is now EMPTY. Rows attempted:',
            JSON.stringify(incoming),
            achError
          )
          return {
            error:
              'Your team details were saved, but the achievements could not be updated and have been ' +
              'cleared. Please re-enter them and save again.',
          }
        }
      }
    }
  }

  // Audit log — profile edits after submission are material
  const admin = createAdminClient()
  const { error: updateAuditError } = await admin.from('audit_log').insert({
    actor_id: user.id,
    action: 'update_team',
    entity_type: 'teams',
    entity_id: id,
    metadata: { fields_updated: Object.keys(clean) },
  })
  if (updateAuditError) {
    console.error('Failed to write update_team audit log:', updateAuditError.message)
  }

  return { success: true }
}

export async function addAchievement(teamId: string, data: AchievementInput) {
  const result = achievementSchema.safeParse(data)
  if (!result.success) {
    return { error: 'Invalid data provided' }
  }

  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Not authenticated' }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('owner_id', user.id)
    .single()

  if (!team) {
    return { error: 'Team not found or not owned by you' }
  }

  const { error } = await supabase
    .from('team_achievements')
    .insert({
      team_id: teamId,
      season: result.data.season,
      event_name: result.data.eventName,
      award: result.data.award,
      description: result.data.description,
    })

  if (error) {
    return { error: mapDbError(error, 'team.addAchievement') }
  }

  return { success: true }
}

