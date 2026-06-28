import pkg from '@next/env';
const { loadEnvConfig } = pkg;
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { ensureStripeCustomerForPortal } from './src/utils/stripeCustomer.ts';

loadEnvConfig(process.cwd(), true);
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/,'');
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, svc, { auth: { persistSession:false } });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY.trim(), { typescript: true });
const { data: orgs } = await db.from('organizations').select('*').limit(1);
const org = orgs[0];
console.log('before:', org.stripe_customer_id);
const customer = await ensureStripeCustomerForPortal(
  stripe,
  org,
  'dev@example.com',
  async (organizationId, stripeCustomerId) => {
    await db.from('organizations').update({ stripe_customer_id: stripeCustomerId }).eq('id', organizationId);
    console.log('synced:', stripeCustomerId);
  },
);
console.log('resolved customer:', customer.id);
const session = await stripe.billingPortal.sessions.create({
  customer: customer.id,
  return_url: 'http://localhost:3000/dashboard',
});
console.log('portal session ok:', session.url.startsWith('https://billing.stripe.com'));
