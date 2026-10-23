import Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 30

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !secret) return new Response('Missing signature', { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  const supabase = createServiceClient()
  // Stripe retries deliveries: record event.id first and skip duplicates.
  const { error: duplicate } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })
  if (duplicate) return new Response('Already processed', { status: 200 })

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', subscription.id)
  }
  return new Response('ok', { status: 200 })
}
