type FakeCustomer = {
  id: string
  name: string
  email: string
}

const FAKE_CUSTOMERS: FakeCustomer[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'FAKE DATA — Ada Example',
    email: 'ada.fake@example.com',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'FAKE DATA — Ben Example',
    email: 'ben.fake@example.com',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'FAKE DATA — Cara Example',
    email: 'cara.fake@example.com',
  },
]

export async function GET(): Promise<Response> {
  return Response.json(FAKE_CUSTOMERS)
}
