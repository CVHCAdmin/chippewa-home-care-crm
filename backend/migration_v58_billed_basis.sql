-- migration_v58_billed_basis.sql
-- Record WHY each invoice line is the number it is.
--
-- Billing bills the scheduled shift; a clock-in is verification, not the amount.
-- When the two disagree the person generating the invoice picks which to bill,
-- so every line needs to carry that decision — otherwise a disputed invoice
-- cannot be explained six months later, and nobody can tell a deliberate
-- "bill what she actually worked" from a mis-punch that slipped through.
--
--   billed_basis       'scheduled' | 'clocked' | 'unscheduled'
--   scheduled_minutes  the shift as scheduled  (NULL when there was no shift)
--   clocked_minutes    the punch as recorded   (NULL when nobody clocked in)

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS billed_basis VARCHAR(16),
  ADD COLUMN IF NOT EXISTS scheduled_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS clocked_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'invoice_line_items'::regclass
       AND conname  = 'invoice_line_items_billed_basis_check'
  ) THEN
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_billed_basis_check
      CHECK (billed_basis IS NULL OR billed_basis IN ('scheduled', 'clocked', 'unscheduled'));
  END IF;
END $$;

-- Existing lines: a line tied to a time entry was billed off that punch, and one
-- without was billed off the schedule. Backfilled as a best-effort label only —
-- the minute columns stay NULL because the old rows never recorded both sides.
UPDATE invoice_line_items
   SET billed_basis = CASE WHEN time_entry_id IS NULL THEN 'scheduled' ELSE 'clocked' END
 WHERE billed_basis IS NULL;
