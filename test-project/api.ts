import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const resendKey = process.env.RESEND_API_KEY;
const s3Bucket = process.env.S3_BUCKET_NAME;

export async function chargeCustomer(email: string, amount: number) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: 'price_123', quantity: 1 }],
    mode: 'payment',
  });
  return session;
}
