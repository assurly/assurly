import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildShipGateFromWebFindings } from '../../../utils/shipGate';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';
import { scanLiveUrl } from '../../../utils/runtimeScanner';
import { assertScannableUrl, UrlSafetyError } from '../../../utils/urlSafety';

const scanUrlBody = z
  .object({
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

export const POST = secureRoute(
  {
    routeId: 'scan:url',
    auth: 'optional',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: scanUrlBody,
    bodyMode: 'json',
    maxBodyBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.expensive,
  },
  async ({ body }) => {
    let parsedUrl;
    try {
      parsedUrl = assertScannableUrl(body.url);
    } catch (error) {
      if (error instanceof UrlSafetyError) {
        throw new ApiError(400, 'invalid_url', error.message);
      }
      throw error;
    }

    const findings = await scanLiveUrl(parsedUrl.toString());
    const report = buildShipGateFromWebFindings(findings, {
      scannedFileCount: 1,
      cleanFileCount: findings.length === 0 ? 1 : 0,
    });

    return NextResponse.json({ report, findings });
  },
);
