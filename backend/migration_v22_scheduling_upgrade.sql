-- Migration v22: Scheduling System Upgrade
-- Adds client GPS coordinates for travel time calculations
-- Adds reason codes to audit trail for compliance

-- Client GPS coordinates (for travel time warnings between consecutive shifts)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);

-- Reason codes on schedule changes (compliance/audit)
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason_code VARCHAR(50);
