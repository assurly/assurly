import stripe from 'stripe';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature') || '';
  const body = await req.text();

  // Safe signature verification!
  const event = (stripe as any).webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );

  console.log('Verified event:', event.type);
}
