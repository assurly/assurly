import { z } from 'zod'
import { createUserClient } from '@/lib/supabase-server'

const createProjectSchema = z.object({ name: z.string().trim().min(1).max(120) })

export async function GET(): Promise<Response> {
  const supabase = await createUserClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('projects').select('id, name, created_at')
  if (error) return Response.json({ error: 'Could not load projects' }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createUserClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createProjectSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Invalid project' }, { status: 400 })

  const { data, error } = await supabase
    .from('projects')
    .insert({ name: parsed.data.name, owner_id: claims.claims.sub })
    .select('id, name, created_at')
    .single()
  if (error) return Response.json({ error: 'Could not create project' }, { status: 500 })
  return Response.json(data, { status: 201 })
}
