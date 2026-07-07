import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, emptyObjectSchema, RATE_LIMITS, secureRoute } from '../../../utils/apiSecurity';

const contactBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    email: z.string().email().max(254),
    subject: z.enum(['technical', 'bug', 'business', 'other']),
    message: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)),
  })
  .strict();

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

export const POST = secureRoute(
  {
    routeId: 'contact:create',
    auth: 'none',
    query: emptyObjectSchema,
    params: emptyObjectSchema,
    body: contactBody,
    bodyMode: 'json',
    maxBodyBytes: 8 * 1024,
    rateLimit: RATE_LIMITS.contact,
    csrf: true,
  },
  async ({ body }) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      if (
        process.env.NODE_ENV !== 'production' &&
        process.env.CONTACT_SIMULATION_ENABLED === 'true'
      ) {
        return NextResponse.json({
          success: true,
          simulated: true,
          message: 'Your support request was accepted.',
        });
      }
      throw new ApiError(503, 'service_unavailable', 'Contact service is unavailable.');
    }

    const supportEmail = z
      .string()
      .email()
      .parse(process.env.SUPPORT_EMAIL || 'support@assurly.dev');
    const name = escapeHtml(body.name);
    const email = escapeHtml(body.email);
    const subject = escapeHtml(body.subject.toUpperCase());
    const message = escapeHtml(body.message);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: 'Assurly Support <onboarding@resend.dev>',
        to: supportEmail,
        reply_to: body.email,
        subject: `[Assurly Support] ${body.subject.toUpperCase()} from ${body.name}`,
        html: `<h2>New Assurly support request</h2><p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Subject:</strong> ${subject}</p><hr><p><strong>Message:</strong></p><p style="white-space:pre-wrap">${message}</p>`,
      }),
    });
    if (!response.ok)
      throw new ApiError(502, 'email_delivery_failed', 'Message could not be delivered.');
    return NextResponse.json({ success: true, message: 'Your support request was sent.' });
  },
);
