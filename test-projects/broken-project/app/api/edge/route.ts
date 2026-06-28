import fs from 'fs'; // Incompatible Node import in Edge!

export const runtime = 'edge';

export async function GET() {
  const content = fs.readFileSync('somefile.txt', 'utf8');
  return new Response(content);
}
