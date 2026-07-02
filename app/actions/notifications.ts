'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/actions-utils'
import { mapDbError } from '@/lib/errors'

const markReadSchema = z.object({ id: z.string().uuid('Invalid notification id') })

export async function markNotificationRead(id: string) {
  // 1. VALIDATE
  const parsed = markReadSchema.safeParse({ id })
  if (!parsed.success) return { error: 'Invalid notification id' }

  // 2. AUTH
  let user, supabase
  try {
    const auth = await requireAuth()
    user = auth.user
    supabase = auth.supabase
  } catch {
    return { error: 'Unauthorized' }
  }

  // 3. MUTATE — server client respects RLS; the recipient_id filter additionally
  // pins ownership, and .select() verifies the update actually matched a row.
  const { data: updated, error } = await supabase.from('notifications')
    .update({ read_at: new Date().toISOString() } as never)
    .eq('id', parsed.data.id)
    .eq('recipient_id', user.id)
    .select('id')

  if (error) {
    return { error: mapDbError(error, 'markNotificationRead.update') }
  }
  if (!updated || updated.length === 0) {
    return { error: 'Notification not found' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/sponsor/inbox')
  return { success: true }
}
