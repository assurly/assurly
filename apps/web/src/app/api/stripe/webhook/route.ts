import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import {
  ApiError,
  emptyObjectSchema,
  RATE_LIMITS,
  secureRoute,
} from '../../../../utils/apiSecurity';
import { getAdminDbAdapter } from '../../../../utils/dbAdapter';
import { getStripeClient, getStripeWebhookSecret } from '../../../../utils/stripe';
import { processStripeEvent, StripeBillingValidationError } from '../../../../utils/stripeBilling';

export const POST = secureRoute(
  {
    routeId: 'stripe:webhook',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: z.string().max(1024 * 1024),
    bodyMode: 'raw',
    maxBodyBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.webhook,
  },
  async ({ request, body }) => {
    const webhookSecret = getStripeWebhookSecret();
    const signature = request.headers.get('stripe-signature');
    if (!signature || signature.length > 1024) {
      throw new ApiError(400, 'invalid_webhook', 'Invalid webhook event.');
    }
    try {
      const stripe = getStripeClient();
      const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      const result = await processStripeEvent(stripe, getAdminDbAdapter(), event);
      return NextResponse.json({ received: true, result });
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeSignatureVerificationError ||
        error instanceof StripeBillingValidationError
      ) {
        throw new ApiError(400, 'invalid_webhook', 'Invalid webhook event.');
      }
      throw error;
    }
  },
);
