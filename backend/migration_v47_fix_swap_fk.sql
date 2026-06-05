-- Migration v47: Fix shift_swap_requests FK
--
-- shift_swap_requests.requesting_caregiver_id / target_caregiver_id were
-- originally created as FKs to caregiver_profiles(id) — but every code path
-- (existing /api/shift-swaps POST + the new caregiver self-service flow)
-- passes a users(id) value. This made the entire swap flow throw a FK
-- violation on first insert. Switch the FKs to users(id).

BEGIN;

ALTER TABLE shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swap_requests_requesting_caregiver_id_fkey,
  DROP CONSTRAINT IF EXISTS shift_swap_requests_target_caregiver_id_fkey;

ALTER TABLE shift_swap_requests
  ADD CONSTRAINT shift_swap_requests_requesting_caregiver_id_fkey
    FOREIGN KEY (requesting_caregiver_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE shift_swap_requests
  ADD CONSTRAINT shift_swap_requests_target_caregiver_id_fkey
    FOREIGN KEY (target_caregiver_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
