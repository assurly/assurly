import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchInvoices } from '@/lib/api'

export default async function DashboardPage() {
  const session = (await cookies()).get('session')?.value
  if (!session) redirect('/login')

  const invoices = await fetchInvoices(session)
  return (
    <main>
      <h1>Invoices</h1>
      <ul>
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            {invoice.id}: {(invoice.amountCents / 100).toFixed(2)} ({invoice.status})
          </li>
        ))}
      </ul>
    </main>
  )
}
