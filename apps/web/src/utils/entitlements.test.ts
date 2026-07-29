import { describe, expect, it } from 'vitest';
import { entitlementsForPlan, type BillingPlan } from './entitlements';

describe('entitlementsForPlan', () => {
  it('free = one guarded app, free key tier, no deep review, no visibility detail, not OEM', () => {
    expect(entitlementsForPlan('free')).toEqual({
      guardedAppLimit: 1,
      apiKeyTier: 'free',
      deepReviewEnabled: false,
      visibilityReportEnabled: false,
      oem: false,
    });
  });

  it('pro = unlimited guarded apps, pro key tier, deep review, visibility detail, not OEM', () => {
    expect(entitlementsForPlan('pro')).toEqual({
      guardedAppLimit: null,
      apiKeyTier: 'pro',
      deepReviewEnabled: true,
      visibilityReportEnabled: true,
      oem: false,
    });
  });

  it('oem = unlimited guarded apps, oem key tier, deep review, visibility detail, OEM', () => {
    expect(entitlementsForPlan('oem')).toEqual({
      guardedAppLimit: null,
      apiKeyTier: 'oem',
      deepReviewEnabled: true,
      visibilityReportEnabled: true,
      oem: true,
    });
  });

  it.each([
    ['free', false],
    ['pro', true],
    ['oem', true],
  ] as const)('visibilityReportEnabled for %s is %s', (plan, enabled) => {
    expect(entitlementsForPlan(plan).visibilityReportEnabled).toBe(enabled);
  });

  it('the free guarded-app limit is exactly 1 (only pro/oem lift it)', () => {
    expect(entitlementsForPlan('free').guardedAppLimit).toBe(1);
    expect(entitlementsForPlan('pro').guardedAppLimit).toBeNull();
    expect(entitlementsForPlan('oem').guardedAppLimit).toBeNull();
  });

  it('deep review is a paid entitlement only', () => {
    expect(entitlementsForPlan('free').deepReviewEnabled).toBe(false);
    expect(entitlementsForPlan('pro').deepReviewEnabled).toBe(true);
    expect(entitlementsForPlan('oem').deepReviewEnabled).toBe(true);
  });

  it('the API-key tier equals the plan (kept in sync with apiKeyRateLimitForPlan)', () => {
    const plans: BillingPlan[] = ['free', 'pro', 'oem'];
    for (const plan of plans) {
      expect(entitlementsForPlan(plan).apiKeyTier).toBe(plan);
    }
  });

  it('only the OEM plan is an OEM tenant', () => {
    expect(entitlementsForPlan('free').oem).toBe(false);
    expect(entitlementsForPlan('pro').oem).toBe(false);
    expect(entitlementsForPlan('oem').oem).toBe(true);
  });
});
