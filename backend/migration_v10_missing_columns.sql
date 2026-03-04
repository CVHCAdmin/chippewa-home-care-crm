-- Migration v10: Add all missing columns causing 500 errors
-- Covers: emergency/miss-reports, authorizations, forecast/revenue,
--         forecast/caregiver-utilization

-- ═══════════════════════════════════════════════════════════════════════════════
-- ABSENCES — emergency miss-reports stores JSON in notes, queries status
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE absences ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE absences ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUTHORIZATIONS — authorizationRoutes.js uses different column names
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS auth_number VARCHAR(100);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS payer_id UUID;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS low_units_alert_threshold INTEGER DEFAULT 20;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS midas_auth_id VARCHAR(100);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS procedure_code VARCHAR(50);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS modifier VARCHAR(50);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS imported_from VARCHAR(100);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS authorized_hours DECIMAL(10,2);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS used_hours DECIMAL(10,2) DEFAULT 0;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2);

-- Backfill auth_number from authorization_number where available
UPDATE authorizations SET auth_number = authorization_number
WHERE auth_number IS NULL AND authorization_number IS NOT NULL;

-- Backfill payer_id from referral_source_id where available
UPDATE authorizations SET payer_id = referral_source_id
WHERE payer_id IS NULL AND referral_source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CLAIMS — forecastRoutes.js queries service_date and total_amount
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE claims ADD COLUMN IF NOT EXISTS service_date DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12,2);

-- Backfill service_date from service_date_from
UPDATE claims SET service_date = service_date_from
WHERE service_date IS NULL AND service_date_from IS NOT NULL;

-- Backfill total_amount from charge_amount
UPDATE claims SET total_amount = charge_amount
WHERE total_amount IS NULL AND charge_amount IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS — caregiver-utilization queries employment_type
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50) DEFAULT 'full_time';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHEDULES — various routes reference status column
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
