export async function GET(): Promise<Response> {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
