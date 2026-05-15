# MIDAS → Care Task Import

Turn a MIDAS **SHC Homemaking Services** assessment into a client's caregiver
to-do checklist using Claude for Chrome + the bulk import endpoint.

## The flow

1. Open the member's MIDAS SHC Homemaking assessment in Chrome.
2. Run the **extraction prompt** (below) in Claude for Chrome. It outputs one JSON object.
3. In the CRM: **Clients Management → client → 📋 Tasks → "Import from MIDAS assessment"**.
4. Paste the JSON → **Parse & preview** → check the reconciliation banner → **Import**.

The preview/import reconciles computed `mins/week` against the assessment's own
**Total Mins/Week**. A mismatch (red banner) means Claude misread a cell — fix
before importing. This is the safety net; never skip the reconciliation check.

## Autonomous run (matching the right client)

For unattended runs across a caseload, the dangerous step is putting the
assessment on the **wrong** client. Resolve the client deterministically before
importing — never by guessing from name alone.

`POST /api/clients/resolve` (admin token). Body:

```json
{ "medicaidId": "1234567890", "name": "Doe, Jane", "backfillMedicaidId": true }
```

Match priority: `medicaid_id` / `mco_member_id` (exact) → name (exact,
case-insensitive). Response `status` is one of:

- `matched` — exactly one client. Use `client.id` for the import. `matchType`
  tells you whether it was `medicaid_id` (trustworthy) or `name` (weaker).
  `backfilled: true` means the client had no Medicaid ID and the one from MIDAS
  was written to their profile. `conflict` (non-null) means the client already
  has a *different* Medicaid ID — **stop, do not import**, flag for a human.
- `ambiguous` — more than one candidate (`candidates[]`). **Stop**, flag for a human.
- `not_found` — no client. **Stop**, flag for a human (client may not be in the CRM yet).

The Medicaid ID lives on the client profile (`medicaid_id` / `mco_member_id`,
editable on the client form). Passing `backfillMedicaidId: true` fills it in
automatically the first time a name match succeeds, so subsequent runs match by
ID. It never overwrites an existing different ID.

**Hard rules for an autonomous run — all four must hold before Import:**
1. `resolve` returned `status: "matched"` with **one** client.
2. No `conflict` on the resolve response.
3. The import reconciliation banner is **green** (computed = assessment total).
4. On any `ambiguous` / `not_found` / `conflict` / red banner: skip that
   member, log it, move on — never import on a guess.

## What counts as a task

Only rows where the **"Paid Services / Informal Supports Not Available"** columns
(`x/wk` and `min/task`) are filled in. Exclude:

- Rows with only a `type` of **S / N / I** and a blank paid column (natural/unpaid supports).
- "Member has Meal Services" / blank meal rows.
- `0 / 0` rows (Supervision, Budgeting, Care Coordination) unless a paid value is present.

All SHC Homemaking line items map to category **`iadl`**.

## JSON contract

```json
{
  "source": "midas_shc_homemaking",
  "assessmentTotals": { "minsPerWeek": 291, "unitsPerWeek": 19.40, "hoursPerWeek": 5.00 },
  "tasks": [
    {
      "taskName": "Dust/Vacuum (Living Area)",
      "category": "iadl",
      "weeklyFrequency": 1,
      "allottedMinutes": 10,
      "daysOfWeek": "",
      "timeOfDay": "any",
      "description": ""
    }
  ]
}
```

- `weeklyFrequency` = the paid **x/wk**. `allottedMinutes` = the paid **min/task**.
  Server computes `mins/week = weeklyFrequency * allottedMinutes`.
- `daysOfWeek` / `timeOfDay` ("AM" | "PM" | "any") from the "Preference for Days
  and AM or PMs" grid at the top of the section; apply the same preference to
  every task unless the sheet differentiates.
- Disambiguate repeated names with the section in parentheses, e.g.
  `Dust/Vacuum (Bedroom)` vs `Dust/Vacuum (Living Area)`.

`POST /api/clients/:clientId/care-tasks/import`
Body: `{ tasks, replaceExisting, source, assessmentTotals }`.
`replaceExisting: true` soft-deletes the current active tasks first — use it when
re-importing an updated reassessment so the list doesn't duplicate.

## Extraction prompt for Claude for Chrome

> Read the MIDAS SHC Homemaking Services assessment on this page. For every
> service line where the **"Paid Services / Informal Supports Not Available"**
> columns have an `x/wk` and a `min/task` value, output one task. Ignore rows
> that only have a `type` (S/N/I) with a blank paid column, "Member has Meal
> Services", and any `0/0` rows. Use category `"iadl"` for all of them.
> Disambiguate duplicate task names with their section in parentheses. Read the
> "Preference for Days and AM or PMs" grid and put it on every task as
> `daysOfWeek` and `timeOfDay`. Also capture the sheet's **Total Mins/Week**,
> and the member's **Medicaid/MA ID** and full name from the assessment header.
> Output only the JSON object in this exact shape (no prose):
> `{ "source": "midas_shc_homemaking", "member": { "medicaidId": "<id or empty>", "name": "<Last, First>" }, "assessmentTotals": { "minsPerWeek": <int> }, "tasks": [ { "taskName", "category", "weeklyFrequency", "allottedMinutes", "daysOfWeek", "timeOfDay", "description" } ] }`
> Then verify: sum of (weeklyFrequency × allottedMinutes) must equal
> assessmentTotals.minsPerWeek. If it doesn't, re-read the cells and fix before
> returning.

### Autonomous sequence (per member)

For each member's assessment, Claude for Chrome should:

1. Extract the JSON above (including `member.medicaidId` / `member.name`).
2. `POST /api/clients/resolve` with `{ medicaidId, name, backfillMedicaidId: true }`.
3. If `status` ≠ `matched`, or `conflict` is present → **skip this member**,
   log `{member, reason}`, continue to the next. Do not import.
4. On `matched`: `POST /api/clients/<client.id>/care-tasks/import` with
   `{ tasks, assessmentTotals, replaceExisting: true, source }`.
5. If the import response `reconciliation.match` is `false` → **skip / flag**;
   the tasks were written but totals didn't reconcile, so a human must review.
6. Produce a run summary: imported, skipped (with reasons), backfilled IDs,
   conflicts.

## Worked example (the sample assessment — 291 min/week)

```json
{
  "source": "midas_shc_homemaking",
  "assessmentTotals": { "minsPerWeek": 291, "unitsPerWeek": 19.40, "hoursPerWeek": 5.00 },
  "tasks": [
    { "taskName": "Dust/Vacuum (Living Area)", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 10 },
    { "taskName": "Light Organization", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 10 },
    { "taskName": "Clean Tub/Sink", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 10 },
    { "taskName": "Clean Toilet/Commode", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Mop Floor (Bathroom)", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Dust/Vacuum (Bedroom)", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Change Sheets/Bedding", "category": "iadl", "weeklyFrequency": 2, "allottedMinutes": 5 },
    { "taskName": "Wipe Stove Top/Counters/Sink", "category": "iadl", "weeklyFrequency": 4, "allottedMinutes": 3 },
    { "taskName": "Sweep", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 2 },
    { "taskName": "Mop Floor (Kitchen)", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Clean Refrigerator/Microwave/Stove", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Wash/Dry/Put Away Dishes", "category": "iadl", "weeklyFrequency": 4, "allottedMinutes": 3 },
    { "taskName": "Offsite Attended Laundry", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 120 },
    { "taskName": "Empty Garbage", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 5 },
    { "taskName": "Shopping", "category": "iadl", "weeklyFrequency": 1, "allottedMinutes": 60, "description": "Member needs assistance with shopping due to shortness of breath and other physical limitations." }
  ]
}
```

Check: 10+10+10+5+5+5+(2×5)+(4×3)+2+5+5+(4×3)+120+5+60 = **291** ✅
