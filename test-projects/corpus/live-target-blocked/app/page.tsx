'use client'

import { createClient } from '@supabase/supabase-js'
import { useEffect, useState, type ReactElement } from 'react'

type JsonValue = unknown

export default function HomePage(): ReactElement {
  const [adminCustomers, setAdminCustomers] = useState<JsonValue>(null)
  const [health, setHealth] = useState<JsonValue>(null)
  const [tableRows, setTableRows] = useState<JsonValue>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const customersResponse = await fetch('/api/admin/customers')
        const healthResponse = await fetch('/api/health')
        setAdminCustomers(await customersResponse.json())
        setHealth(await healthResponse.json())

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!supabaseUrl || !supabaseAnonKey) {
          setError('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
          return
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey)
        const { data, error: tableError } = await supabase.from('customers').select('*')
        if (tableError) {
          setError(tableError.message)
          return
        }
        setTableRows(data)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unknown error')
      }
    })()
  }, [])

  return (
    <main>
      <h1>Assurly live test target</h1>
      <p>Deliberately vulnerable. Every customer row is fake. RLS is off on purpose.</p>
      {error ? <p>Error: {error}</p> : null}
      <section>
        <h2>/api/admin/customers</h2>
        <pre>{JSON.stringify(adminCustomers, null, 2)}</pre>
      </section>
      <section>
        <h2>/api/health</h2>
        <pre>{JSON.stringify(health, null, 2)}</pre>
      </section>
      <section>
        <h2>supabase.from(&apos;customers&apos;)</h2>
        <pre>{JSON.stringify(tableRows, null, 2)}</pre>
      </section>
    </main>
  )
}
