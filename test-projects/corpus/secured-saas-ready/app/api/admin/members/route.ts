import { createServiceClient, createUserClient } from '@/lib/supabase-server'

export async function GET(): Promise<Response> {
  const supabase = await createUserClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims || claims.claims.app_metadata?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 50 })
  if (error) return Response.json({ error: 'Could not load members' }, { status: 500 })
  return Response.json(data.users.map((user) => ({ id: user.id, email: user.email })))
}
