# Q1 2026 Molina Rate Negotiation — Data Gap Analysis

**Scope.** Read-only audit of the CVHC tenant DB and CRM code to determine
whether we can produce a defensible cost-per-service-hour breakdown for a
Molina / My Choice Wisconsin rate negotiation. Companion script:
`q1_2026_financial_snapshot.sql` (run that first, then read this).

**Bottom line.** We can produce a *labor-hours and labor-cost* view from the
CRM with reasonable confidence. We **cannot** produce a fully-loaded
cost-per-hour without pulling three things from outside the CRM: payroll
burden (FICA/WC/UI), actual cash disbursements, and overhead. The revenue
side is the weaker half — the claims/remittance pipeline is in place
schematically but is only populated when the EVV→claim engine runs, which
requires Sandata to be configured (currently not). If Molina claims have
been filed manually via Midas/ForwardHealth, the dollar amounts and paid
dates for Q1 are **not in this database**.

---

## Data-point-by-data-point findings

### Revenue side

| # | Data point | Present in DB? | Queryable in one SQL? | Closest proxy if missing | UI or engineer-only? |
|---|---|---|---|---|---|
| 1 | Q1 hours by service code (S5125/S5130/S5135) | **Partial.** `claims.units_billed` + `claims.procedure_code` exist but only populated if claim was generated from an `evv_visits` row. Authoritative source for hours is `time_entries.duration_minutes`; service code comes from the linked `authorizations.procedure_code`. | Yes — section 5a (if claims exist) and section 6b (via authorizations). | Link `time_entries` → active `authorizations` by client_id + date overlap and pull `a.procedure_code`. Not perfect: a client can have multiple concurrent auths. | Engineer-only. Nothing in the UI breaks hours out by HCPCS code. |
| 2 | Claims submitted to Molina Q1 | Present **if** claims were generated. `claims.payer_id` → `referral_sources.name LIKE '%molina%'`, `claims.status IN ('submitted','accepted','paid','denied')`. | Yes — section 5a. | If claims table is empty for Q1, there is **no proxy inside the CRM** for "submitted to Molina" — manual submissions via Midas aren't captured. | Claims page (`/claims`) lists them. Billing Engine (`/billing-engine`) also. |
| 3 | Claims paid by Molina Q1 with dates | Present **if** remittance was matched. `claims.paid_date`, `claims.paid_amount`, OR `remittance_line_items.paid_amount` joined via `claim_id`. `payments.payer_id` + `payment_claim_matches` is the reconciled path. | Yes — section 5b. | Bank statement / Midas portal export. No CRM proxy if remittance wasn't posted. | Billing Dashboard shows paid invoices, but that's the *invoices* module, not claims. |
| 4 | Current reimbursement rate per 15-min unit per service code | **Weak.** `referral_source_rates.rate_amount` exists but is **one rate per payer** (rate_type is 'hourly' / etc., not a CPT code). There is NO per-service-code fee schedule table linking (payer × code × rate). `service_codes.rate_per_unit` is a global fallback, not payer-specific. | Returns rows but they aren't truly per-service-code. Section 5d. | Ask Alexis for the Molina fee schedule PDF; rates live in her email/files. | Pricing page (`/pricing`) surfaces `referral_source_rates` to admin. |
| 5 | Denied / pending claims $ at risk | Present **if** claims exist. `claims.status`, `claims.charge_amount`, `claims.denial_code`, `denial_code_lookup.description`. | Yes — section 5c. | None inside CRM if claims table is empty. | Claims page filters by status. |

**Headline gap on revenue:** the schema is ready for EDI 837 / 835 flow, but
nothing automates the pull from Midas. Alexis still keys claims manually
into Midas/ForwardHealth portals per CLAUDE memory. Until the Sandata→EVV
pipeline is turned on and/or a Midas importer writes into `claims`, Q1
"revenue" numbers must be reconstructed from Molina's EOB PDFs or Midas
exports, not this DB.

### Cost side

| # | Data point | Present in DB? | Queryable in one SQL? | Closest proxy if missing | UI or engineer-only? |
|---|---|---|---|---|---|
| 6 | Caregiver wages per visit | **Yes.** Rate = `COALESCE(client_assignments.pay_rate, users.hourly_rate, users.default_pay_rate)`; hours = `COALESCE(time_entries.approved_billable_minutes, billable_minutes, duration_minutes)`. v27 enforces scheduled-hours-billing for Medicaid clients, so `approved_billable_minutes` is the correct column when set. | Yes — section 8. | N/A — this is present. | Payroll page (`/payroll`) does this per pay period. Not exposed as a per-payer total. |
| 7 | Mileage reimbursement per visit | **Partial.** `mileage.miles` exists; **no rate column**, and no FK from mileage row to a specific `time_entries` row (only to `caregiver_id` + `date`). | Miles only — section 9. Dollars need an external rate. | Multiply miles × IRS or agency rate (external). Per-visit allocation is impossible without relinking by date/shift. | Expenses/Payroll UI shows miles, not per-visit. |
| 8 | Employer burden (FICA, WC, UI, benefits) | **No.** `payroll.taxes` column exists but is hardcoded to 0 and never written. No fields for FICA, workers comp, unemployment, benefits. Gusto integration is **export-only**: `gustoRoutes.js` pushes hours to Gusto but does not pull back actual payroll disbursements or tax figures (see `gusto_sync_log`, which records exports only). | No. | Pull from Gusto portal (they compute FICA+WC+UI) and apply as % overlay to wages. | Not in UI at all. |
| 9 | Supervisory / RN oversight time | **No dedicated tracking.** Users table has only `role='admin'` or `role='caregiver'`; no 'nurse' role. Could be inferred from `users.certifications` array containing 'RN' and/or filtering `claims.procedure_code IN ('G0299','G0300')` — but that only works if RN visits are coded differently, which this schema does not enforce. | Partial — filter time_entries by caregiver certifications. | If Alexis knows who the RN(s) are (1-2 people), pass those user IDs explicitly. Otherwise treat RN time as 0 in the snapshot and flag. | Not in UI. |
| 10 | Overhead allocation (software/training/admin) by month | **No.** No overhead_costs, admin_expenses, or similar table. `expenses` table captures individual receipts but is not categorized into overhead buckets with monthly allocation. | No. | QuickBooks / bank statement summary, applied as a flat % of revenue or $/member. | Not in CRM. |

### Member / caseload

| # | Data point | Present in DB? | Queryable in one SQL? | Closest proxy if missing | UI or engineer-only? |
|---|---|---|---|---|---|
| 11 | Active Molina members served Q1 | **Yes.** Three identification paths (see section 3 of the SQL). `authorizations.payer_id` is the strongest signal — a client with an active Q1 auth against Molina *is* a Molina member for billing purposes. | Yes — section 4. | N/A. | Clients list exists, but there is no Molina-only filter in the UI. |
| 12 | Members in 54768 / 54726 / 54771 ZIPs | **Weak.** `clients.zip` is nullable and not required by the onboarding form (`ClientOnboarding.jsx` and `clientsRoutes.js` treat address fields as optional). Many rows likely have NULL zip. | Yes — section 11 — but expect a large "(zip missing)" bucket. | Cross-reference client home address (if captured as free text) or use the caregiver's service area. Ugly. | Not in UI. |
| 13 | Avg hours/week per member | **Yes** if we use `time_entries` / 13 weeks. Or use `client_assignments.hours_per_week` for *planned* hours (less reliable — that field is frequently stale). | Yes — section 10. | N/A. | Not in UI as a Molina-filtered metric. |
| 14 | Show-up rate (completed vs scheduled) | **Yes, with a caveat.** Requires expanding recurring schedules (`date IS NULL, day_of_week=N`) into dates with `generate_series` and matching against `time_entries`. `reports.js` currently does NOT do this correctly — it sums `EXTRACT(EPOCH FROM end-start)` once per schedule row, which undercounts recurring visits. The snapshot SQL expands correctly in section 7. | Yes — section 7. | `noshow_alerts` table counts caught no-shows, but only post-grace-period alerts, not a true show-up rate. | Not a UI-accessible metric; Reports page shows hours totals that are already wrong for recurring schedules. |

---

## Consolidated verdict

### ✅ Data we have in the CRM (clean, trustworthy)
- Roster of Molina / My Choice clients via authorizations (section 3)
- Active member count for Q1 with at least one completed visit (section 4)
- Actual service hours delivered (time_entries, section 6)
- Visits completed vs scheduled with proper recurring-schedule expansion (section 7)
- Caregiver wages per visit, using the v27 approval-aware billable-minutes rule (section 8)
- Miles driven (count and sum, section 9) — not dollars
- Authorization utilization / remaining units (section 12)

### ⚠️ Data we can approximate from the CRM (usable with caveats — call them out in the negotiation memo)
- **Hours by service code.** Map `time_entries` → overlapping `authorizations.procedure_code`. Breaks if a client has multiple concurrent auths for different codes; Alexis will need to sanity-check a sample.
- **Mileage dollars.** Multiply `mileage.miles` by IRS 2026 rate (or the agency's current reimbursement rate). The CRM has no rate field, so the choice is external.
- **Per-service-code rate.** The `referral_source_rates` row is one rate per payer; the fee schedule PDF that Alexis has is the authoritative source. The CRM can store it, but hasn't been populated by service code.
- **RN / supervisory time.** Filter `users.certifications` array for 'RN' and sum their `time_entries` — only valid if Alexis confirms the certifications array is populated for the 1–2 nurses and no one else.
- **ZIP geography.** Section 11 will run but produce an "(zip missing)" bucket. Usable only if Alexis backfills zips for the ~24 active clients (trivial manual task; not worth a schema change).

### ❌ Data that must come from outside the CRM
- **Molina claims actually submitted in Q1 and their paid dates / amounts** — these live in Midas and on Molina's remittance PDFs. The CRM's `claims` table is only populated when the EVV→claim engine runs (requires Sandata). Until that's turned on, Q1 revenue numbers come from Midas exports, not here.
- **Employer burden (FICA 7.65% + WI UI + WC rate)** — pull from Gusto. Gusto is currently configured for one-way export (hours out); nothing reads its payroll runs back into this DB.
- **Actual cash disbursed to caregivers** — the `payroll` table tracks workflow status ('draft' → 'approved' → 'processed' → 'paid') but has no bank-clear date, no check-clearing evidence, no gross-to-net reconciliation. Bank statement is source of truth.
- **Overhead (rent, software subs, admin salaries, marketing, training)** — not modeled in the CRM at all. QuickBooks / bank statement.
- **Benefits (if any)** — not modeled.

---

## For next quarter — what to add to make this a one-click report

Only listing items; no schema changes in this audit per your instruction. In priority order:

1. Wire up Sandata so `evv_visits` actually populates and `claimsEngine.js` can produce real `claims` rows. Without this the revenue half of every future report also has to be reconstructed.
2. A `payer_fee_schedule` table keyed by `(payer_id, service_code, modifier, effective_date)` → `rate_per_unit` + `unit_type`. Replaces the current one-rate-per-payer `referral_source_rates` row. Enables per-code revenue math and rate-change modeling.
3. A `mileage_rate` column on either `users` or a new `mileage_rates` effective-dated table. Cheap; lets mileage dollars roll up automatically.
4. A `payroll_disbursements` table capturing actual cash out (date, amount, gross-to-net breakdown, Gusto payroll ID). Pair with a scheduled pull from Gusto to populate it. This is the single biggest gap for future financial reporting.
5. A `cost_allocation` or `overhead_costs` table with monthly buckets (rent, software, admin salary, training) and an allocation rule (% of revenue / $ per member / etc.). One row per month is enough.
6. Fix the recurring-schedule expansion bug in `backend/src/routes/reports.js` (the `EXTRACT(EPOCH FROM end-start)` sum). This is why the Reports/Revenue Forecast pages undercount hours for the weekly-recurring clients.
7. Require `clients.zip` on onboarding — trivial, and makes geographic breakdowns reliable.
