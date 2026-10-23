export interface Invoice {
  id: string
  amountCents: number
  status: 'paid' | 'open'
}

export async function fetchInvoices(sessionToken: string): Promise<Invoice[]> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/invoices`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Invoices request failed: ${response.status}`)
  return (await response.json()) as Invoice[]
}
