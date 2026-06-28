import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  requireRouteUser,
  secureRoute,
} from '../../../utils/apiSecurity';
import { requireOrganizationMember } from '../../../utils/authorization';

const repositoryBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(3)
      .max(201)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    githubRepoId: z.number().int().positive().safe(),
  })
  .strict();

export const POST = secureRoute(
  {
    routeId: 'repositories:create',
    auth: 'required',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: repositoryBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.write,
    csrf: true,
  },
  async ({ auth, body }) => {
    const context = requireRouteUser(auth);
    const organization = await context.db.getOrganizationByUserId(context.user.id);
    if (!organization) throw new ApiError(404, 'not_found', 'Workspace not found.');
    await requireOrganizationMember(context, organization.id);

    const existing = await context.db.getRepositories(organization.id);
    const duplicate = existing.find(
      (repository) =>
        repository.github_repo_id === body.githubRepoId ||
        repository.name.toLowerCase() === body.name.toLowerCase(),
    );
    if (duplicate) return NextResponse.json(duplicate);

    const repository = await context.db.addRepository(
      organization.id,
      body.name,
      body.githubRepoId,
    );
    return NextResponse.json(repository, { status: 201 });
  },
);
