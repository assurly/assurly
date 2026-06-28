import { PrismaClient } from '@prisma/client';

export async function POST(req: Request) {
  // Violation: PrismaClient instantiated inside handler!
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany();
  return Response.json(users);
}
