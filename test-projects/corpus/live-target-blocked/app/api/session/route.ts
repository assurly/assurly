export async function GET(): Promise<Response> {
  return Response.json({ user: null, organization: null })
}
