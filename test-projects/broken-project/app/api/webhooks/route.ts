import stripe from 'stripe';

export async function POST(req: Request) {
  // Vulnerability: Stripe signature is not verified!
  const body = await req.json();
  console.log('Stripe payload:', body);
}
