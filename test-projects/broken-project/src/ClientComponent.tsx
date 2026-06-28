'use client';

import { PrismaClient } from '@prisma/client';
import { something } from 'server-only';
import { db } from '@/lib/db';

export function ClientComponent() {
  console.log('Client-side Prisma client instantiation is dangerous!');
  const prisma = new PrismaClient();
  return <div>Client Component</div>;
}
