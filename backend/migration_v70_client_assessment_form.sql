-- Migration v70: In-Home Client Assessment form
--
-- Seeds one built-in Form Builder template the office fills out at the client's
-- home (initial visit, periodic review, change in condition). Uses the same
-- `fields` JSON schema as v42, plus two display types the filler/PDF now support:
--   "section" - a heading, collects no data
--   "date"    - a date picker
-- A "checkbox" field WITH options is multi-select (value = array of picked options).
--
-- Content should be reviewed by compliance before relying on it for DHS/MCO
-- requirements. Re-runnable: NOT EXISTS guard on the name.

BEGIN;

INSERT INTO form_templates (name, description, category, fields, requires_signature, auto_attach_to, is_active, is_built_in)
SELECT
  'In-Home Client Assessment',
  'Completed in the client''s home at start of care, at each periodic review, and after any change in condition or hospital stay.',
  'assessment',
  '[
    { "id": "sec_visit", "type": "section", "label": "Assessment Visit" },
    { "id": "assessment_type", "label": "Type of assessment", "type": "radio", "required": true, "options": ["Initial (start of care)", "Periodic review", "Change in condition", "After hospital / rehab stay"] },
    { "id": "assessment_date", "label": "Assessment date", "type": "date", "required": true },
    { "id": "present", "label": "Who was present (name + relationship)", "type": "text", "required": false },
    { "id": "payer", "label": "Payer", "type": "select", "required": false, "options": ["Private pay", "Family Care / MCO", "IRIS", "VA", "Long-term care insurance", "Other"] },

    { "id": "sec_health", "type": "section", "label": "Health" },
    { "id": "diagnoses", "label": "Diagnoses", "type": "textarea", "required": false },
    { "id": "allergies", "label": "Allergies (medication, food, environmental) - write NKA if none", "type": "textarea", "required": true },
    { "id": "medications", "label": "Current medications (name, dose, how often)", "type": "textarea", "required": false },
    { "id": "med_management", "label": "Medication management", "type": "radio", "required": true, "options": ["Independent", "Needs reminders", "Needs set-up (pill box filled by family / nurse)", "Managed entirely by others"] },
    { "id": "physician", "label": "Primary physician (name + phone)", "type": "text", "required": false },
    { "id": "hospitalization", "label": "Hospital or ER visit recently?", "type": "radio", "required": false, "options": ["None in 6 months", "Within last 30 days", "Within last 6 months"] },
    { "id": "hospitalization_notes", "label": "Hospital / ER details", "type": "textarea", "required": false },

    { "id": "sec_senses", "type": "section", "label": "Vision, Hearing, Communication" },
    { "id": "vision", "label": "Vision", "type": "radio", "required": false, "options": ["Adequate", "Impaired - uses glasses", "Severely impaired / blind"] },
    { "id": "hearing", "label": "Hearing", "type": "radio", "required": false, "options": ["Adequate", "Hard of hearing", "Uses hearing aids", "Deaf"] },
    { "id": "communication", "label": "Communication", "type": "radio", "required": false, "options": ["Speaks clearly", "Some difficulty", "Non-verbal"] },
    { "id": "language", "label": "Primary language (if not English)", "type": "text", "required": false },

    { "id": "sec_cognition", "type": "section", "label": "Memory, Mood, Behavior" },
    { "id": "cognition", "label": "Memory / orientation", "type": "radio", "required": true, "options": ["Alert and oriented", "Mild forgetfulness", "Moderate impairment", "Severe impairment"] },
    { "id": "dementia_dx", "label": "Diagnosed dementia or Alzheimer''s?", "type": "radio", "required": false, "options": ["No", "Yes", "Suspected, not diagnosed"] },
    { "id": "behaviors", "label": "Behaviors seen or reported", "type": "checkbox", "required": false, "options": ["None", "Wandering", "Agitation", "Verbal aggression", "Physical aggression", "Resists care", "Sundowning", "Hallucinations", "Depression / withdrawal", "Anxiety"] },
    { "id": "safe_alone", "label": "Safe to be left alone?", "type": "radio", "required": true, "options": ["Yes", "Short periods only", "No - needs supervision"] },

    { "id": "sec_adl", "type": "section", "label": "Activities of Daily Living (ADLs)" },
    { "id": "adl_bathing", "label": "Bathing", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_dressing", "label": "Dressing", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_grooming", "label": "Grooming / oral care", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_toileting", "label": "Toileting", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_continence", "label": "Continence", "type": "radio", "required": true, "options": ["Continent", "Occasional accidents", "Incontinent - bladder", "Incontinent - bladder and bowel", "Catheter / ostomy"] },
    { "id": "adl_transfers", "label": "Transfers (bed, chair, toilet)", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_mobility", "label": "Walking / getting around", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_eating", "label": "Eating", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "equipment", "label": "Equipment in use", "type": "checkbox", "required": false, "options": ["None", "Cane", "Walker", "Wheelchair", "Hoyer lift", "Gait belt", "Grab bars", "Shower chair / tub bench", "Raised toilet seat", "Commode", "Hospital bed", "Oxygen"] },
    { "id": "adl_notes", "label": "ADL notes (how the client likes things done)", "type": "textarea", "required": false },

    { "id": "sec_iadl", "type": "section", "label": "Household Tasks (IADLs)" },
    { "id": "iadl_meals", "label": "Meal preparation", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_housekeeping", "label": "Housekeeping", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_laundry", "label": "Laundry", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_shopping", "label": "Shopping / errands", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_transport", "label": "Transportation", "type": "radio", "required": false, "options": ["Drives self", "Needs rides", "Unable to leave home", "Done by family"] },
    { "id": "iadl_phone", "label": "Using the phone", "type": "radio", "required": false, "options": ["Independent", "Needs some help", "Unable"] },
    { "id": "iadl_finances", "label": "Managing money / bills", "type": "radio", "required": false, "options": ["Independent", "Needs some help", "Handled by family / POA"] },

    { "id": "sec_falls", "type": "section", "label": "Fall Risk" },
    { "id": "falls_6mo", "label": "Falls in the last 6 months", "type": "radio", "required": true, "options": ["None", "1", "2-3", "More than 3"] },
    { "id": "fall_factors", "label": "Fall risk factors", "type": "checkbox", "required": false, "options": ["None", "Unsteady gait", "Dizziness", "Fear of falling", "Uses walker / cane inconsistently", "Night-time toileting", "Poor vision", "Medications that cause drowsiness"] },
    { "id": "fall_risk", "label": "Overall fall risk", "type": "radio", "required": true, "options": ["Low", "Moderate", "High"] },

    { "id": "sec_skin", "type": "section", "label": "Skin and Nutrition" },
    { "id": "skin", "label": "Skin condition", "type": "radio", "required": false, "options": ["Intact", "Fragile / bruises easily", "Open area or pressure sore - nurse notified"] },
    { "id": "diet", "label": "Diet", "type": "checkbox", "required": false, "options": ["Regular", "Diabetic", "Low sodium", "Soft / pureed", "Thickened liquids", "Tube feeding", "Other (see notes)"] },
    { "id": "swallowing", "label": "Trouble chewing or swallowing?", "type": "radio", "required": false, "options": ["No", "Yes"] },
    { "id": "appetite", "label": "Appetite / weight change", "type": "radio", "required": false, "options": ["Good, stable", "Poor appetite", "Recent weight loss", "Recent weight gain"] },

    { "id": "sec_home", "type": "section", "label": "Home Safety" },
    { "id": "living", "label": "Lives", "type": "radio", "required": true, "options": ["Alone", "With spouse / partner", "With family", "Other"] },
    { "id": "home_hazards", "label": "Hazards found", "type": "checkbox", "required": false, "options": ["None", "Throw rugs", "Clutter in walkways", "Poor lighting", "Stairs without railing", "No grab bars in bathroom", "Pets underfoot", "Smoking in home", "Oxygen in use", "Firearms (unsecured)", "Hoarding", "Pests / sanitation"] },
    { "id": "smoke_detectors", "label": "Working smoke detectors?", "type": "radio", "required": false, "options": ["Yes", "No", "Not checked"] },
    { "id": "emergency_pendant", "label": "Medical alert / emergency pendant?", "type": "radio", "required": false, "options": ["Yes", "No"] },
    { "id": "entry", "label": "How caregivers get in (key, lockbox code location, door)", "type": "text", "required": false },
    { "id": "pets", "label": "Pets", "type": "text", "required": false },

    { "id": "sec_support", "type": "section", "label": "Support and Wishes" },
    { "id": "family_contact", "label": "Main family contact (name, relationship, phone)", "type": "text", "required": false },
    { "id": "poa", "label": "Power of attorney / guardian (name, phone)", "type": "text", "required": false },
    { "id": "advance_directive", "label": "Advance directive / POLST", "type": "radio", "required": false, "options": ["Yes - copy on file", "Yes - no copy yet", "No", "Unknown"] },
    { "id": "code_status", "label": "Code status", "type": "radio", "required": false, "options": ["Full code", "DNR", "Unknown"] },

    { "id": "sec_plan", "type": "section", "label": "Recommended Services" },
    { "id": "services", "label": "Services recommended", "type": "checkbox", "required": true, "options": ["Personal care", "Bathing", "Medication reminders", "Meal preparation", "Light housekeeping", "Laundry", "Errands / shopping", "Transportation", "Companionship", "Respite", "Overnight"] },
    { "id": "hours_per_week", "label": "Recommended hours per week", "type": "number", "required": false },
    { "id": "visit_schedule", "label": "Preferred days and times", "type": "text", "required": false },
    { "id": "client_goals", "label": "Client / family goals", "type": "textarea", "required": false },
    { "id": "caregiver_prefs", "label": "Caregiver preferences (gender, allergies to pets, non-smoker, etc.)", "type": "textarea", "required": false },
    { "id": "referrals", "label": "Referrals or follow-up needed (nurse, PT, social worker, equipment)", "type": "textarea", "required": false },
    { "id": "next_review", "label": "Next reassessment date", "type": "date", "required": false },
    { "id": "assessor", "label": "Completed by (name and title)", "type": "text", "required": true }
  ]'::jsonb,
  true, 'client', true, true
WHERE NOT EXISTS (SELECT 1 FROM form_templates WHERE name = 'In-Home Client Assessment');

COMMIT;
