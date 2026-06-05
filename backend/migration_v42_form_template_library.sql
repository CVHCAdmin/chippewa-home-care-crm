-- Migration v42: Pre-built form template library
--
-- Seeds form_templates with 8 high-frequency home-care forms so admins
-- have a baseline to work from in the FormBuilder UI. Each template uses
-- the existing `fields` JSON schema (id/label/type/required/options).
--
-- Re-runnable: NOT EXISTS guard prevents duplicate seeds.

BEGIN;

-- Add a column to mark built-in templates (similar to care_plan_templates)
ALTER TABLE form_templates ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN DEFAULT false;

INSERT INTO form_templates (name, description, category, fields, requires_signature, auto_attach_to, is_active, is_built_in)
SELECT * FROM (VALUES
  (
    'Client Intake Form',
    'Initial demographic + medical history captured at first contact.',
    'intake',
    '[
      { "id": "preferred_name", "label": "What name does the client prefer to go by?", "type": "text", "required": false },
      { "id": "primary_concern", "label": "Primary reason for requesting home care", "type": "textarea", "required": true },
      { "id": "diagnoses", "label": "Current diagnoses (comma-separated)", "type": "textarea", "required": false },
      { "id": "allergies", "label": "Allergies (food, medication, environmental)", "type": "textarea", "required": true },
      { "id": "current_meds", "label": "Current medications (name, dose, frequency)", "type": "textarea", "required": true },
      { "id": "mobility_status", "label": "Mobility status", "type": "radio", "required": true, "options": ["Fully ambulatory", "Walker / cane", "Wheelchair (transfers self)", "Wheelchair (needs transfer assist)", "Bed-bound"] },
      { "id": "cognitive_status", "label": "Cognitive status", "type": "select", "required": true, "options": ["Alert and oriented x3", "Mild forgetfulness", "Moderate dementia", "Advanced dementia", "Non-verbal"] },
      { "id": "fall_risk", "label": "Fall history in last 6 months?", "type": "radio", "required": true, "options": ["No falls", "1 fall", "2-3 falls", "More than 3 falls"] },
      { "id": "primary_caregiver_family", "label": "Primary family caregiver (name + relationship)", "type": "text", "required": false },
      { "id": "advance_directive", "label": "Has an advance directive / POLST on file?", "type": "radio", "required": true, "options": ["Yes (copy provided)", "Yes (not provided)", "No", "Unknown"] },
      { "id": "pets", "label": "Pets in the home?", "type": "text", "required": false },
      { "id": "smoking_in_home", "label": "Smoking in the home?", "type": "radio", "required": true, "options": ["No", "Yes - resident only", "Yes - visitors"] },
      { "id": "weapons_in_home", "label": "Firearms in the home? (safety question)", "type": "radio", "required": true, "options": ["No", "Yes - secured", "Yes - unsecured"] }
    ]'::jsonb,
    false, 'client', true, true
  ),
  (
    'HIPAA Authorization to Release Information',
    'Required release for sharing PHI with named family members or other providers.',
    'consent',
    '[
      { "id": "auth_release_to_name", "label": "Authorize release of my health information to (name)", "type": "text", "required": true },
      { "id": "auth_release_to_relationship", "label": "Relationship to me", "type": "text", "required": true },
      { "id": "auth_release_to_phone", "label": "Phone number of authorized party", "type": "text", "required": true },
      { "id": "info_categories", "label": "Categories of information to release", "type": "checkbox", "required": true, "options": ["Visit schedule", "Care plan", "Medication list", "Vitals / observations", "Billing / invoices", "Incidents", "Discharge information"] },
      { "id": "purpose", "label": "Purpose of disclosure", "type": "select", "required": true, "options": ["At my request", "Care coordination", "Family involvement", "Legal", "Other"] },
      { "id": "expires_in", "label": "This authorization expires in", "type": "select", "required": true, "options": ["6 months", "1 year", "Until revoked", "Upon discharge"] },
      { "id": "right_to_revoke", "label": "I understand I may revoke this authorization in writing at any time.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]'::jsonb,
    true, 'client', true, true
  ),
  (
    'Service Agreement — Private Pay',
    'Contract between agency and private-pay client specifying services, rate, and terms.',
    'general',
    '[
      { "id": "services_authorized", "label": "Services authorized", "type": "checkbox", "required": true, "options": ["Personal care (bathing, grooming)", "Mobility assistance", "Meal preparation", "Light housekeeping", "Errands / transportation", "Companionship", "Medication reminders", "Other (specify in notes)"] },
      { "id": "hours_per_week", "label": "Anticipated hours per week", "type": "number", "required": true },
      { "id": "hourly_rate", "label": "Hourly rate ($)", "type": "number", "required": true },
      { "id": "billing_cycle", "label": "Billing cycle", "type": "select", "required": true, "options": ["Weekly", "Bi-weekly", "Monthly"] },
      { "id": "payment_method", "label": "Preferred payment method", "type": "select", "required": true, "options": ["Check", "ACH / bank transfer", "Credit card", "Long-term care insurance"] },
      { "id": "min_cancel_notice", "label": "Cancellation notice required", "type": "select", "required": true, "options": ["24 hours", "48 hours", "1 week", "No fee for any cancellation"] },
      { "id": "late_fee", "label": "Late payment fee (% per month past 30 days)", "type": "number", "required": false },
      { "id": "agreement_acknowledgement", "label": "I have read and agree to the terms above.", "type": "checkbox", "required": true, "options": ["I agree"] }
    ]'::jsonb,
    true, 'client', true, true
  ),
  (
    'Wisconsin Plan of Care (POC)',
    'Plan of Care required for WI Medicaid personal care services. Replaces the MA-1A elements that apply.',
    'physician_order',
    '[
      { "id": "primary_diagnosis", "label": "Primary diagnosis (ICD-10)", "type": "text", "required": true },
      { "id": "secondary_diagnoses", "label": "Secondary diagnoses", "type": "textarea", "required": false },
      { "id": "functional_limitations", "label": "Functional limitations", "type": "checkbox", "required": true, "options": ["Ambulation", "Transfer", "Bathing", "Toileting", "Dressing", "Eating", "Meal prep", "Medication management", "Communication", "Cognition"] },
      { "id": "adl_assist_level", "label": "Level of ADL assistance required", "type": "radio", "required": true, "options": ["Independent", "Supervision", "Limited assist", "Extensive assist", "Total dependence"] },
      { "id": "skilled_nursing_needed", "label": "Skilled nursing needed?", "type": "radio", "required": true, "options": ["No", "Yes - intermittent", "Yes - daily"] },
      { "id": "frequency_of_visits", "label": "Frequency of visits", "type": "text", "required": true },
      { "id": "duration_per_visit", "label": "Duration per visit (hours)", "type": "number", "required": true },
      { "id": "goals_short_term", "label": "Short-term goals (30-90 days)", "type": "textarea", "required": true },
      { "id": "goals_long_term", "label": "Long-term goals", "type": "textarea", "required": true },
      { "id": "discharge_criteria", "label": "Discharge criteria", "type": "textarea", "required": false },
      { "id": "physician_name", "label": "Ordering physician", "type": "text", "required": true },
      { "id": "physician_signature_date", "label": "Physician signature date", "type": "text", "required": true }
    ]'::jsonb,
    true, 'client', true, true
  ),
  (
    'Medication Administration Authorization',
    'Required when caregivers administer (not just remind) medications.',
    'physician_order',
    '[
      { "id": "client_consent", "label": "Client / legal rep authorizes agency caregivers to administer medications as listed in the current medication list.", "type": "checkbox", "required": true, "options": ["I authorize"] },
      { "id": "administered_categories", "label": "Categories authorized for administration", "type": "checkbox", "required": true, "options": ["Oral medications", "Topical (creams, ointments)", "Eye drops", "Ear drops", "Nasal sprays", "Insulin (per RN training)", "Inhalers / nebulizers", "Suppositories"] },
      { "id": "training_verified", "label": "Caregiver has documented medication training", "type": "checkbox", "required": true, "options": ["Verified by RN", "Verified by agency director", "Pending — admin only until verified"] },
      { "id": "controlled_substances", "label": "Are controlled substances involved?", "type": "radio", "required": true, "options": ["No", "Yes - witnessed administration required"] },
      { "id": "errors_protocol", "label": "Caregiver acknowledges medication-error reporting protocol (notify supervisor immediately).", "type": "checkbox", "required": true, "options": ["Acknowledged"] }
    ]'::jsonb,
    true, 'client', true, true
  ),
  (
    'Emergency Contact Information',
    'Primary + backup contacts for incidents, hospital admissions, schedule changes.',
    'intake',
    '[
      { "id": "ec1_name",         "label": "Primary contact — name", "type": "text", "required": true },
      { "id": "ec1_relationship", "label": "Primary contact — relationship", "type": "text", "required": true },
      { "id": "ec1_phone",        "label": "Primary contact — phone (cell preferred)", "type": "text", "required": true },
      { "id": "ec1_can_decide",   "label": "Primary contact authorized to make care decisions?", "type": "radio", "required": true, "options": ["Yes - durable POA", "Yes - informally", "No"] },
      { "id": "ec2_name",         "label": "Secondary contact — name", "type": "text", "required": false },
      { "id": "ec2_relationship", "label": "Secondary contact — relationship", "type": "text", "required": false },
      { "id": "ec2_phone",        "label": "Secondary contact — phone", "type": "text", "required": false },
      { "id": "preferred_hospital", "label": "Preferred hospital", "type": "text", "required": false },
      { "id": "dnr_on_file",      "label": "Do Not Resuscitate order on file?", "type": "radio", "required": true, "options": ["No", "Yes (POLST/MOLST attached)", "Yes (verbal only)"] }
    ]'::jsonb,
    false, 'client', true, true
  ),
  (
    'Caregiver Employment Agreement',
    'At-hire agreement covering scope, confidentiality, pay, conduct, termination.',
    'hr',
    '[
      { "id": "position",        "label": "Position", "type": "select", "required": true, "options": ["Personal Care Worker", "Home Health Aide", "Companion", "CNA", "RN", "LPN"] },
      { "id": "start_date",      "label": "Start date", "type": "text", "required": true },
      { "id": "hourly_rate",     "label": "Hourly rate ($)", "type": "number", "required": true },
      { "id": "weekly_hours",    "label": "Expected weekly hours", "type": "number", "required": true },
      { "id": "employment_type", "label": "Employment classification", "type": "select", "required": true, "options": ["W-2 employee", "1099 contractor"] },
      { "id": "confidentiality", "label": "Confidentiality / HIPAA acknowledgment", "type": "checkbox", "required": true, "options": ["I will keep all client PHI confidential and follow HIPAA + agency privacy policies."] },
      { "id": "boundaries",      "label": "Professional boundaries acknowledgment", "type": "checkbox", "required": true, "options": ["No personal financial transactions with clients, no gifts > $25, no posting client info on social media."] },
      { "id": "at_will",         "label": "I understand employment is at-will and either party may terminate the relationship with notice per policy.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]'::jsonb,
    true, 'caregiver', true, true
  ),
  (
    'Photo / Media Release',
    'Optional consent for using client photo on agency marketing materials.',
    'consent',
    '[
      { "id": "use_in_marketing", "label": "I grant Chippewa Valley Home Care permission to use my photograph / likeness in", "type": "checkbox", "required": false, "options": ["Agency website", "Print brochures", "Social media (Facebook, etc.)", "Training materials (internal only)"] },
      { "id": "no_identification", "label": "My name should not be displayed with my photo.", "type": "checkbox", "required": false, "options": ["Anonymous use only"] },
      { "id": "right_to_revoke", "label": "I understand I may revoke this release in writing at any time. Already-printed materials are not recallable.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]'::jsonb,
    true, 'client', true, true
  )
) AS t(name, description, category, fields, requires_signature, auto_attach_to, is_active, is_built_in)
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates WHERE is_built_in = true
);

COMMIT;
