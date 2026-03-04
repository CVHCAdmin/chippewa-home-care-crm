-- Migration v9: Add hourly_rate column to users table
-- payrollRoutes.js queries u.hourly_rate which did not exist
-- Backfill from existing default_pay_rate column

ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2);

UPDATE users SET hourly_rate = default_pay_rate
WHERE hourly_rate IS NULL AND default_pay_rate IS NOT NULL;
