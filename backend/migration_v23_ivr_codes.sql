-- Migration v23: IVR Phone Clock-In Support
-- Adds PIN codes for caregivers and client codes for IVR phone clock-in/out

-- Caregiver 4-digit PIN for IVR authentication
ALTER TABLE users ADD COLUMN IF NOT EXISTS ivr_pin VARCHAR(4);

-- Client 3-digit code for IVR client selection
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ivr_code VARCHAR(3);

-- Auto-generate unique IVR codes for existing caregivers
DO $$
DECLARE
  r RECORD;
  pin INT;
BEGIN
  FOR r IN SELECT id FROM users WHERE role = 'caregiver' AND is_active = true AND ivr_pin IS NULL LOOP
    LOOP
      pin := floor(random() * 9000 + 1000)::int;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE ivr_pin = pin::text);
    END LOOP;
    UPDATE users SET ivr_pin = pin::text WHERE id = r.id;
  END LOOP;
END $$;

-- Auto-generate unique IVR codes for existing clients
DO $$
DECLARE
  r RECORD;
  code INT;
BEGIN
  FOR r IN SELECT id FROM clients WHERE is_active = true AND ivr_code IS NULL LOOP
    LOOP
      code := floor(random() * 900 + 100)::int;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM clients WHERE ivr_code = code::text);
    END LOOP;
    UPDATE clients SET ivr_code = code::text WHERE id = r.id;
  END LOOP;
END $$;
