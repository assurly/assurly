import { createUserClient } from '@/lib/supabase-server'

export default async function HomePage() {
  const supabase = await createUserClient()
  const { data: projects } = await supabase.from('projects').select('id, name')
  return (
    <main>
      <h1>Projects</h1>
      <ul>
        {(projects ?? []).map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
    </main>
  )
}
