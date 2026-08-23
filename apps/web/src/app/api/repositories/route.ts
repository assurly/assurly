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
import { getAdminDbAdapter } from '../../../utils/dbAdapter';

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

    const existingByGithub = await context.db.getRepositoryByGithubRepoId(body.githubRepoId);
    if (existingByGithub && existingByGithub.organization_id !== organization.id) {
      throw new ApiError(409, 'conflict', 'That GitHub repository is already connected elsewhere.');
    }
    if (existingByGithub && existingByGithub.organization_id === organization.id) {
      if (!existingByGithub.is_active || existingByGithub.dismissed_at) {
        await getAdminDbAdapter().reconnectRepository(existingByGithub.id, body.name);
        const restored = await context.db.getRepository(existingByGithub.id);
        if (!restored) throw new ApiError(404, 'not_found', 'Repository not found.');
        return NextResponse.json(restored);
      }
      return NextResponse.json(existingByGithub);
    }

    const existing = await context.db.getRepositories(organization.id);
    const duplicateName = existing.find(
      (repository) => repository.name.toLowerCase() === body.name.toLowerCase(),
    );
    if (duplicateName) return NextResponse.json(duplicateName);

    const repository = await context.db.addRepository(
      organization.id,
      body.name,
      body.githubRepoId,
    );
    return NextResponse.json(repository, { status: 201 });
  },
);
