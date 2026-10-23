import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

// Stripe calls this on every subscription change.
export async function POST(request: Request): Promise<Response> {
  const event = JSON.parse(await request.text()) as Stripe.Event
  if (event.type === 'customer.subscription.deleted') {
    await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id)
  }
  return new Response('ok')
}
