# CRM Full Audit — 2026-06-05

Comprehensive sweep across every major subsystem (8 parallel code reviews + a
production data integrity sweep). Findings ordered by severity. The recurring
schedule back-dating fix (commit 4d6c063) is already deployed; this report
covers everything else.

---

## 🔴 CRITICAL — Money / Compliance

### 1. **1,307 hours of duplicate payroll payments**
**Where:** `payroll_shift_reviews` table.
**What:** 386 unique shifts have been reviewed and paid in 2–5 different pay
periods. Same caregiver, same date, same schedule — paid multiple times.
**Root cause:** The unique index in `migration_v21_payroll_shift_reviews.sql:48`
keys on `(pay_period_start, pay_period_end, caregiver_id, shift_date, schedule_id)`.
If an admin runs `/api/payroll/generate-shifts` with overlapping date ranges
(weekly + biweekly, or re-running an old range), each run creates a NEW review
row for the same shift.
**Worst offenders:**
- Terri Tranel — 21 hrs extra on 2026-03-23 alone, paid across 3 pay periods
- Jennifer Susedik — 16 hrs extra on 2026-03-27, 4 pay periods
- Daniel Burr — 15 hrs extra on 2026-04-01, 4 pay periods
- Neugene Watkins, Alexis Phillips, Kristen Semrow — 10-12 hrs each
**Total exposure:** ~1,307 hours. At $15/hr that's ~$19,600.
**Fix needed:** (a) Drop pay_period_start/end from the unique index — keep
unique on (caregiver, shift_date, schedule_id). (b) Backfill: pick the
earliest-paid row per shift, delete the rest. (c) Bumper check in
`/generate-shifts` to refuse if the period overlaps an existing review.

### 2. **257 hours paid for shifts with NO clock-in**
**Where:** `payroll_shift_reviews` rows where `status='missing_punch'` and
`payable_minutes > 0`.
**What:** 116 review rows marked "missing_punch" (no time_entry matched) but
with payable_minutes set anyway. Status is supposed to mean "scheduled but
not worked", so payable_minutes should be 0 unless converted to manual_entry.
**Worst:** Terri Tranel — multiple 5-7 hr shifts in April/May with no punches.
**Total:** ~257.75 hours, ~$3,866 at $15/hr.
**Fix needed:** Trigger or app-level guard: `status='missing_punch'` → force
`payable_minutes = 0`. Audit historical rows and clawback or excuse.

### 3. **HIPAA — Audit log routes have ZERO authentication**
**Where:** `backend/src/routes/auditLogs.js:11,52,122,170,200`
**What:** `GET /api/audit-logs*`, `POST /api/audit-logs/export`,
`/compliance-report` — the `verifyToken` middleware applied at the mount
point in server.js doesn't actually run on these handlers. Any unauthenticated
caller can dump the entire audit trail, including all PHI access records.
**Risk:** Direct HIPAA §164.312(b) violation. Reportable breach if exploited.
**Compound:** 333,539 audit_log rows have NULL `record_id` (known from March
audit). Even when auth is fixed, the audit trail itself is mostly useless.

### 4. **HIPAA — Client routes have no role check (IDOR)**
**Where:** `backend/src/routes/clientsRoutes.js:54,66`
**What:** `GET/PUT /api/clients/:id` only require `verifyToken`. Any caregiver
with a valid login can read/modify any client's PHI (medical, meds, insurance)
by guessing or enumerating UUIDs.
**Same issue in:**
- `caregiverRoutes.js:140,157,204,212` — any caregiver can edit any other
  caregiver's availability, blackout dates, certs
- `documentsRoutes.js:105-149` — any caregiver can download any client's
  documents
- `clinicalRoutes.js:181-244` — incident reports and performance reviews
  visible to all staff
- `familyPortalRoutes.js:15-47` — `/admin/members` accessible to anyone

### 5. **EVV — IVR clock-out bypasses Sandata entirely**
**Where:** `backend/src/routes/ivrRoutes.js:162-204`
**What:** Web clock-out calls `createEVVFromTimeEntry` (timeTrackingRoutes.js:376).
The IVR (phone) clock-out doesn't. Any visit closed by calling in goes nowhere
near Sandata.
**Risk:** Wisconsin Medicaid EVV non-compliance for every IVR-closed visit.
Audit data sweep showed **176 complete shifts in last 30 days with no Sandata
submission** — IVR is the likely cause.

### 6. **Two clock-ins from MARCH 2026 still open**
**Where:** `time_entries` table.
- Jennifer Snow-Best → Cheri Shower, clocked in 2026-03-20 (1,840 hours ago)
- Debra Monte → Sally Bandoli, clocked in 2026-05-31 (112 hours ago)
**What:** Someone forgot to clock out. The shifts are unbillable until closed.
**Fix:** Quick admin action — close them with the right end times, or flag
as missed-punch for review.

---

## 🟠 HIGH — Real bugs that bite

### 7. **Stripe webhook has no idempotency**
`backend/src/routes/stripeRoutes.js:290-313` — `checkout.session.completed`
inserts a payment row without checking if the same session_id was already
processed. Stripe retries failed webhooks; this causes double-payment recording
and double-incrementing `amount_paid` on invoices.

### 8. **Remittance overwrites instead of accumulating partial payments**
`backend/src/routes/remittanceRoutes.js:102-104` uses
`SET paid_amount=$1` (assignment) instead of `paid_amount = COALESCE(paid_amount,0) + $1`.
Second partial payment erases the first.

### 9. **Authorization units burned even when claim submission fails**
`backend/src/services/claimsEngine.js:226-251` (called from
`claimsRoutes.js:287,562`). `deductAuthorizationUnits()` is in a catch-block
treated as non-fatal. If submission crashes mid-flight, units deducted but
claim stays pending. Retry burns units again. No idempotency.

### 10. **PTO spanning a pay period boundary doesn't get paid**
`backend/src/routes/payrollRoutes.js:558` — filters PTO with
`start_date >= $1 AND end_date <= $2`. PTO that starts in period 1 and ends
in period 2 falls through both ends — caregiver doesn't get paid for either.

### 11. **Gusto export sends overtime as regular hours**
`backend/src/routes/gustoRoutes.js:170` — sends `regular_hours: total_hours`
with no overtime split. 45-hour week → Gusto pays 45 regular instead of
40 reg + 5 OT. Federal FLSA violation if Gusto is actually live.

### 12. **SMS shift reminders marked "sent" before sending**
`backend/src/routes/smsRoutes.js:292-301` — DB updated with status='sent'
BEFORE the Twilio call. If Twilio fails, no retry, no detection. Caregivers
silently miss shift reminders.

### 13. **VAPID push keys default to placeholder string**
`backend/src/routes/pushNotificationRoutes.js:16-24,59` — falls back to
`'PLACEHOLDER_REPLACE_WITH_REAL_KEY'`. Line 19 skips registration if detected,
but line 59 still hands the placeholder to the browser, breaking push
registration silently.

### 14. **Optimizer endpoints unauthenticated**
`backend/src/routes/optimizerRoutes.js:12,93,389` — `GET /client-data/:clientId`,
`POST /run`, `POST /apply` have NO `auth` middleware. Anyone can read client
auth data, generate proposals, and apply schedule changes to prod.

### 15. **Background-check endpoints unauthenticated**
`backend/src/routes/backgroundChecksRoutes.js:152,165` —
`GET /caregiver/:id/eligibility` and `POST /poll-now` exposed.

### 16. **Failsafe credential check is always-false**
`backend/src/routes/failsafeRoutes.js:76-77` — queries for
`status = 'clear'` but `background_checks.status` is actually
`pending|in_progress|completed|disqualifying`. Check never validates anything.
Claims pass credential verification by accident.

### 17. **Care plan schedule generation ignores auth-exhausted**
`backend/src/routes/clinicalRoutes.js:128-149` — builds a warnings array but
never returns early if `authCheck.allowed === false`. Generates schedules
even when authorization is empty.

---

## 🟡 MEDIUM — Worth fixing soon

### 18. **Sandata API submits GPS as `null`**
`sandataAutoSubmit.js:226-229` — payload sends `GPSInLatitude: null` when
GPS is missing. Sandata rejects, retry runs 3x, then "needs_manual" with
no clear cause. Should pre-validate and route to manual queue immediately.

### 19. **Retry logic doesn't distinguish transient from permanent errors**
`sandataAutoSubmit.js:124-209` — every error gets 3 retries. NO_AUTH or
INVALID_SERVICE_CODE will never succeed on retry; should fail fast.

### 20. **Open-shift claim conflict check ignores `is_active`**
`backend/src/routes/openShiftsRoutes.js:151-157` — checks status but not
is_active. Soft-deleted schedules block legitimate claims.

### 21. **Auto-fill conflict check ignores `is_active`**
`backend/src/routes/schedulingRoutes.js:209` — same omission. Creates
double-bookings against soft-deleted rows.

### 22. **Time-off shift expansion has timezone risk**
`backend/src/routes/timeOffRoutes.js:169-184` — uses `new Date('YYYY-MM-DD' + 'T12:00:00')` and `getDay()`. Server in UTC, caregiver in Central → wrong day-of-week → missed shifts in coverage planning.

### 23. **Open-shift approval skips authorization recheck**
`backend/src/routes/openShiftsRoutes.js:182-223` — admin approves a claim
without re-checking auth balance. Auth could have been consumed between
claim and approval.

### 24. **CSV pay period overtime ignores weekly threshold**
`backend/src/routes/gustoRoutes.js:193` — sums all hours over the whole
range and subtracts 40 once. Misses weekly OT in a 2-week pay period.

### 25. **Legacy `/api/payroll/run` bypasses shift_review reconciliation**
`backend/src/routes/payrollRoutes.js:968-980` — pulls raw time_entries.
If both `/generate-shifts` and `/run` are called for the same period →
double pay (this is likely contributing to finding #1).

### 26. **Mileage entries have no duplicate detection**
`backend/src/routes/payrollRoutes.js:550-552` — POST has no uniqueness
constraint. Admin can submit the same mileage twice; both sum into gross.

### 27. **`notifyAdmins` omits `status` column**
`backend/src/routes/clientPortalRoutes.js:867-870` — inserts notifications
without `status`, defaulting NULL. Notification bell count mismatches
`is_read`.

### 28. **No low-authorization-units alert**
`backend/src/routes/authorizationRoutes.js` — calculates `health_status='low'`
in GETs but never sends a notification. Admins must manually monitor.

### 29. **Password reset token reuse window**
`backend/src/routes/authRoutes.js:330-348` — token nulled only on success,
no rate limit on attempts. Intercepted token is replayable until expiry.

### 30. **Email service has no SMS fallback for critical sends**
`backend/src/services/emailService.js:46-52` — SES failure for password
reset / portal invite goes nowhere; user is locked out.

### 31. **Document IDOR — `/unsigned/:userId`**
`backend/src/routes/documentsRoutes.js:105-121` — caregiver can enumerate
any other caregiver's unsigned compliance docs.

### 32. **Race in shift-swap approval**
`backend/src/routes/shiftSwapsRoutes.js:101-103` — approves without checking
if the schedule was meanwhile deleted or modified. Orphans a swap row.

---

## 🟢 LOWER PRIORITY — Hygiene / data quality

- **4 active schedules** point at deleted/inactive clients (orphan cleanup)
- **18 active caregivers** have no certifications recorded (data entry gap)
- **12 active clients** have no `care_type_id` (billing fallback risk)
- **18 active clients** missing GPS coords (route optimizer broken for them)
- **102 payroll reviews** stuck in `pending` > 30 days (admin backlog)
- **CaregiverDashboard mobile sidebar** — touch handler misalignment on small
  screens (`frontend/src/components/CaregiverDashboard.jsx:165-169`)
- **SMS character-limit validation** missing in template creator
- **Scheduled backup cron** — defined but unclear if actually running

---

## ✅ Things that are working

- All invoice totals match `subtotal + tax` — no math drift
- All invoice line items: `amount = hours × rate` — no rounding errors
- Zero impossible shifts (`end_time <= start_time`)
- Zero time_entries with `end_time < start_time`
- Zero claims stuck >60 days
- Zero authorizations with end_date before start_date
- Zero notifications stuck in pending >24h
- Notifications: zero failures logged in last 7 days
- Schedule exception orphans: zero
- Time-entry orphans (caregiver or client): zero
- Audit log activity: 30,854 events in last 7 days, broad action coverage
  (so it IS writing — just missing record_id and unauthenticated to read)

---

## Recommended order of operations

1. **Today** — Auth the audit log routes (1-line `requireAdmin` add), close the
   3 open punches, and put a guard on `payroll_shift_reviews` inserts that
   rejects overlapping pay-periods.
2. **This week** — Backfill the 386 duplicate payroll rows (keep oldest,
   delete the rest) and clean up the 116 missing_punch+paid rows. Then
   add the IDOR auth checks across clients/caregivers/documents/clinical.
3. **Before next payroll run** — Fix the PTO-spans-boundary and Gusto OT
   bugs (FLSA exposure).
4. **Before next claim submission batch** — Fix the auth-units-burned-on-error
   and Stripe-webhook idempotency.
5. **Before next Sandata audit** — Wire IVR clock-out into EVV submission.
