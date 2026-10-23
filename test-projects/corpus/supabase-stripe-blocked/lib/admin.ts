import { createClient } from '@supabase/supabase-js'

// Used by the nightly cleanup job.
export function purgeOldNotes() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
  return admin.from('notes').delete().lt('created_at', new Date(Date.now() - 864e5).toISOString())
}
