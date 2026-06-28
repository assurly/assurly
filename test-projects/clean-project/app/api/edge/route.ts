export const runtime = 'edge';

export async function GET() {
  // Safe: uses web native fetch API, not fs
  const res = await fetch('https://api.github.com/repos/vercel/next.js');
  const data = await res.json();
  return Response.json(data);
}
