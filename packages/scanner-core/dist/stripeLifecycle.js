"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanStripeWebhookIdempotency = scanStripeWebhookIdempotency;
exports.scanStripeLiveKeyInDev = scanStripeLiveKeyInDev;
exports.scanStripeMissingSubscriptionEvents = scanStripeMissingSubscriptionEvents;
exports.scanStripeLifecycle = scanStripeLifecycle;
const result = (findings) => ({
    errorCount: findings.filter((finding) => finding.severity === 'error').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    findings,
});
function isWebhookHandler(content, file) {
    const webhookPath = /(^|[/\\._-])webhooks?([/\\._-]|$)/i.test(file) || !/[\\/]/.test(file);
    const readsStripeSignature = /['"]stripe-signature['"]/.test(content);
    const usesStripeWebhookApi = /\.webhooks\b/.test(content);
    const importsStripe = /from\s+['"]stripe['"]/.test(content) || /require\s*\(\s*['"]stripe['"]/.test(content);
    return (webhookPath || readsStripeSignature || usesStripeWebhookApi) && importsStripe;
}
const IDEMPOTENCY_PATTERNS = [
    /\bevent\.id\b/,
    /\bstripe_event_id\b/i,
    /\bprocessedEvents\b/,
    /\balreadyProcessed\b/i,
    /\bidempotency\b/i,
    /\bon\s+conflict\b/i,
    /\.upsert\s*\(/,
    /\bprocessed_at\b/i,
    /\bwebhook_events\b/i,
];
// Signals that THIS webhook deals with subscriptions. Deliberately narrow —
// bare `subscriptions.` and `STRIPE_PRICE_` matched env declarations and
// unrelated files, so they are excluded.
const SUBSCRIPTION_SIGNAL_PATTERNS = [
    /\bcustomer\.subscription\b/i,
    /\bmode:\s*['"]subscription['"]/i,
];
const SUBSCRIPTION_EVENT_PATTERNS = [
    /\bcustomer\.subscription\.(?:created|updated|deleted)\b/,
    /\binvoice\.payment_(?:failed|succeeded)\b/,
    /\bcustomer\.subscription\.trial_will_end\b/,
    /\bswitch\s*\(\s*event\.type\s*\)/,
    /\bevent\.type\s*===\s*['"]customer\.subscription/,
];
const DEV_ENV_FILE = /(?:^|[/\\])\.env(?:\.(?:local|development|dev|test|staging))?(?:$|[/\\])/i;
function scanStripeWebhookIdempotency(content, file = 'route.ts') {
    const findings = [];
    if (!isWebhookHandler(content, file))
        return result(findings);
    if (IDEMPOTENCY_PATTERNS.some((pattern) => pattern.test(content)))
        return result(findings);
    return result([
        {
            ruleId: 'stripe-webhook-no-idempotency',
            severity: 'warning',
            confidence: 'medium',
            file,
            line: 1,
            message: 'Stripe webhook handler has no obvious idempotency or replay protection.',
            suggestion: 'Persist processed event IDs (event.id) and ignore duplicates before mutating subscription state.',
        },
    ]);
}
function scanStripeLiveKeyInDev(content, file = '.env.development') {
    const findings = [];
    if (!DEV_ENV_FILE.test(file.replace(/\\/g, '/')))
        return result(findings);
    content.split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            return;
        const match = line.match(/sk_live_[a-zA-Z0-9]{8,}/);
        if (!match)
            return;
        findings.push({
            ruleId: 'stripe-live-key-in-dev',
            severity: 'error',
            confidence: 'high',
            file,
            line: index + 1,
            message: `Live Stripe secret key found in a dev/test env file (${match[0].slice(0, 10)}...).`,
            suggestion: 'Remove sk_live_ keys from dev/test env files, rotate the exposed key, and use sk_test_ locally.',
        });
    });
    return result(findings);
}
function scanStripeMissingSubscriptionEvents(content, file = 'route.ts') {
    const findings = [];
    // Lifecycle events are handled in the Stripe webhook, so only a webhook
    // handler can be "missing" them. Gating on isWebhookHandler keeps the rule
    // off env-var declarations, checkout routes, the VS Code extension, and any
    // other file that merely mentions subscriptions.
    if (!isWebhookHandler(content, file))
        return result(findings);
    const hasSubscriptionBilling = SUBSCRIPTION_SIGNAL_PATTERNS.some((pattern) => pattern.test(content));
    if (!hasSubscriptionBilling)
        return result(findings);
    const handlesLifecycle = SUBSCRIPTION_EVENT_PATTERNS.some((pattern) => pattern.test(content));
    if (handlesLifecycle)
        return result(findings);
    return result([
        {
            ruleId: 'stripe-missing-subscription-events',
            severity: 'warning',
            confidence: 'low',
            file,
            line: 1,
            message: 'Subscription billing is present but key lifecycle webhook events are not obviously handled.',
            suggestion: 'Handle customer.subscription.deleted and invoice.payment_failed (at minimum) in your Stripe webhook route.',
        },
    ]);
}
function scanStripeLifecycle(content, file = 'route.ts') {
    return result([
        ...scanStripeWebhookIdempotency(content, file).findings,
        ...scanStripeLiveKeyInDev(content, file).findings,
        ...scanStripeMissingSubscriptionEvents(content, file).findings,
    ]);
}
