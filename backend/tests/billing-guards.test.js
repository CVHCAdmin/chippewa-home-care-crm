// tests/billing-guards.test.js
// Unit tests for the two billing guards added after the June 2026 incidents:
//   1. invoice line-item descriptions overflowing VARCHAR(255)
//   2. missed clock-outs auto-billing implausibly long shifts (esp. private pay)
// Pure functions — no DB, no HTTP.

process.env.JWT_SECRET = 'test-secret-guards';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
process.env.NODE_ENV = 'test';

jest.mock('../src/db', () => ({ query: jest.fn(), pool: { on: jest.fn() }, auditLog: jest.fn() }));

const { clampLineItemDescription, MAX_LINE_ITEM_DESC } = require('../src/routes/billingRoutes');
const { applyExcessiveDurationGuard, MAX_SHIFT_MINUTES } = require('../src/routes/timeTrackingRoutes');

describe('clampLineItemDescription', () => {
  test('leaves short descriptions untouched', () => {
    const s = 'Home Care Services (1:30 PM - 3:00 PM)';
    expect(clampLineItemDescription(s)).toBe(s);
  });

  test('passes through a description exactly at the limit', () => {
    const s = 'x'.repeat(MAX_LINE_ITEM_DESC);
    expect(clampLineItemDescription(s)).toBe(s);
  });

  test('clamps an over-long description to <= the column width', () => {
    const s = 'A'.repeat(2713);
    const out = clampLineItemDescription(s);
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_ITEM_DESC);
  });

  test('preserves the trailing "(time range)" suffix when truncating', () => {
    const suffix = '(10:30 AM - 12:45 PM)';
    const s = 'B'.repeat(400) + ' ' + suffix;
    const out = clampLineItemDescription(s);
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_ITEM_DESC);
    expect(out.endsWith(suffix)).toBe(true);
    expect(out).toContain('…');
  });

  test('handles null / undefined without throwing', () => {
    expect(clampLineItemDescription(null)).toBe('');
    expect(clampLineItemDescription(undefined)).toBe('');
  });

  test('clamps even when the suffix itself is enormous (no negative room)', () => {
    const out = clampLineItemDescription('(' + 'z'.repeat(400) + ')');
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_ITEM_DESC);
  });
});

describe('applyExcessiveDurationGuard', () => {
  const base = (over) => ({
    durationMinutes: over.durationMinutes,
    allottedMinutes: over.allottedMinutes,
    billableMinutes: over.billableMinutes,
    needsApproval: over.needsApproval ?? false,
    approvalReason: over.approvalReason ?? null,
  });

  test('normal shift under the ceiling is unchanged', () => {
    const r = applyExcessiveDurationGuard(base({ durationMinutes: 120, allottedMinutes: 120, billableMinutes: 120 }));
    expect(r).toEqual({ billableMinutes: 120, needsApproval: false, approvalReason: null });
  });

  test('legitimate private-pay overage under the ceiling still bills full time, no flag', () => {
    // 10h worked on a 2h-scheduled private-pay visit — billed in full, not flagged.
    const r = applyExcessiveDurationGuard(base({ durationMinutes: 600, allottedMinutes: 120, billableMinutes: 600 }));
    expect(r.billableMinutes).toBe(600);
    expect(r.needsApproval).toBe(false);
  });

  test('private-pay missed clock-out is capped to the allotment and flagged', () => {
    // The Diane Shantz case: 66.5h auto-closed, private pay billed full.
    const r = applyExcessiveDurationGuard(base({ durationMinutes: 3990, allottedMinutes: 120, billableMinutes: 3990 }));
    expect(r.billableMinutes).toBe(120);
    expect(r.needsApproval).toBe(true);
    expect(r.approvalReason).toBe('excessive_duration');
  });

  test('appends to an existing approval reason rather than clobbering it', () => {
    const r = applyExcessiveDurationGuard(base({ durationMinutes: 28894, allottedMinutes: 180, billableMinutes: 180, needsApproval: true, approvalReason: 'time_variance' }));
    expect(r.billableMinutes).toBe(180);
    expect(r.approvalReason).toBe('time_variance,excessive_duration');
  });

  test('unscheduled excessive shift caps at the ceiling, not unbounded', () => {
    const r = applyExcessiveDurationGuard(base({ durationMinutes: 1200, allottedMinutes: null, billableMinutes: 1200 }));
    expect(r.billableMinutes).toBe(MAX_SHIFT_MINUTES);
    expect(r.needsApproval).toBe(true);
  });

  test('exactly at the ceiling is not treated as excessive', () => {
    const r = applyExcessiveDurationGuard(base({ durationMinutes: MAX_SHIFT_MINUTES, allottedMinutes: null, billableMinutes: MAX_SHIFT_MINUTES }));
    expect(r.needsApproval).toBe(false);
  });
});
