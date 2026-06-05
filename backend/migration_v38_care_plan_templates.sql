-- Migration v38: Care Plan Templates library
--
-- Eliminates blank-page paralysis when admins create new care plans.
-- A template is the same shape as a care plan with template_name/description
-- and a category. Admin clicks "Use Template" → creates a draft care plan
-- pre-filled with the template's content.

BEGIN;

CREATE TABLE IF NOT EXISTS care_plan_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_name VARCHAR(120) NOT NULL,
  template_description TEXT,
  category VARCHAR(60),
  service_type VARCHAR(80),
  service_description TEXT,
  frequency VARCHAR(80),
  care_goals TEXT,
  special_instructions TEXT,
  precautions TEXT,
  medication_notes TEXT,
  mobility_notes TEXT,
  dietary_notes TEXT,
  communication_notes TEXT,
  is_built_in BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_care_plan_templates_active ON care_plan_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_care_plan_templates_category ON care_plan_templates(category);

-- Seed: starter pack of common home-care templates. is_built_in=true so admin
-- can tell at a glance which are agency-defined vs. system defaults.
INSERT INTO care_plan_templates
  (template_name, template_description, category, service_type, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, is_built_in)
SELECT * FROM (VALUES
  (
    'Personal Care — Independent Adult', 'Bathing, grooming, dressing assistance for a mostly-independent client.',
    'personal_care', 'Personal Care', 'Weekly visits',
    E'Maintain personal hygiene and grooming\nPromote dignity and independence\nMonitor skin integrity',
    E'Allow client to perform tasks they can manage independently — supervise only.\nOffer choices (e.g., shower vs. bath, time of day) to preserve autonomy.',
    E'Watch for skin breakdown around bony prominences.\nReport any falls, bruising, or skin changes.',
    'Refer to medication list. Caregiver may remind but not administer unless trained and authorized.',
    'Ambulatory. Stand-by assistance only — no transfer required unless noted.',
    'Regular diet. Encourage hydration (8 cups water/day).',
    'Speak clearly, face client. No known communication barriers.',
    true
  ),
  (
    'Dementia / Alzheimer''s Care', 'For clients with moderate cognitive decline. Focus on routine, safety, validation.',
    'dementia_care', 'Companion + Personal Care', 'Daily visits, same caregiver preferred',
    E'Maintain consistent daily routine\nMinimize agitation and confusion\nEnsure home safety (no wandering, no falls)\nProvide cognitive engagement',
    E'Same caregiver visits each day if possible — continuity reduces anxiety.\nUse validation therapy, not correction. Do not argue about misremembered facts.\nRedirect rather than refuse.\nKeep environment calm: low noise, soft lighting in evening.\nFollow consistent meal/activity/bedtime schedule.',
    E'Wandering risk — verify all doors locked before leaving.\nFall risk — clear pathways, remove throw rugs.\nDo not leave client alone with stove on.\nReport any new agitation, paranoia, or refusal of care.',
    'Caregiver to remind only. Family/RN administers. Watch for medication refusal — common in dementia.',
    'Stand-by to minimal assist. Gait may be unsteady — encourage cane/walker use.',
    'Soft/easy-chew foods preferred if dental issues. Hydrate often — dementia clients often forget to drink.',
    'Speak slowly, one short sentence at a time. Use name. Make eye contact. Avoid open-ended questions; offer simple choices.',
    true
  ),
  (
    'Post-Surgical Recovery (Hip/Knee)', 'Short-term recovery support after orthopedic surgery.',
    'post_surgical', 'Personal Care + Companion', 'Daily for first 2 weeks, then PRN',
    E'Promote safe healing per surgeon''s instructions\nPrevent falls and re-injury\nManage pain comfort\nAssist with prescribed PT exercises',
    E'Follow weight-bearing restrictions exactly as ordered (TDWB / PWB / FWB).\nAssist with home exercise program — 2x/day at minimum.\nIce 15-20 min after PT exercises.\nElevate surgical leg when resting.',
    E'Watch surgical incision for redness, drainage, swelling — report to RN immediately.\nDVT/PE warning signs: calf pain/swelling, sudden shortness of breath — 911.\nDo NOT bend hip past 90°, cross legs, or twist (hip clients).',
    'Pain meds usually scheduled. Anticoagulant (e.g., Lovenox, Eliquis) common — watch for bruising/bleeding.',
    'Use walker for all transfers. Caregiver provides stand-by assist. No bending below knee level (hip restrictions).',
    'Regular diet. Encourage protein for tissue repair. Hydrate well — anesthesia + opioids cause constipation.',
    'Alert and oriented. Communicate any new pain, fever, or changes promptly.',
    true
  ),
  (
    'Companion Care', 'Social engagement, light housekeeping, errands. No personal care needs.',
    'companion', 'Companion', 'Flexible schedule',
    E'Reduce isolation through social interaction\nMaintain a safe, clean home environment\nAssist with errands and appointments',
    E'Activities client enjoys: reading aloud, cards, light walks, music, reminiscing.\nLight housekeeping: dishes, laundry, dusting, sweeping.\nMeal prep encouraged — eat together when possible.',
    'No major safety concerns. Maintain situational awareness during community outings.',
    'Self-administered. Caregiver does not handle medications.',
    'Independent. Stand-by during community outings.',
    'Per client preference.',
    'Engaged conversationalist. Respect privacy on sensitive topics.',
    true
  ),
  (
    'Diabetes Management Support', 'For diabetic clients needing meal/medication reminders and blood-sugar monitoring.',
    'chronic_condition', 'Personal Care + Companion', 'Daily visits, meal-time aligned',
    E'Maintain stable blood glucose\nSupport diabetic diet adherence\nMonitor for signs of hypo/hyperglycemia\nFoot/skin daily check',
    E'Remind client to check blood sugar per RN schedule.\nLog readings in care notes.\nDaily foot inspection — report any wound, redness, or sensation change immediately.\nEnsure client eats consistent carb portions at consistent times.',
    E'HYPOGLYCEMIA (BG < 70): glucose tabs/juice, recheck in 15 min, call RN if not resolved.\nHYPERGLYCEMIA (BG > 300, fruity breath, confusion): 911.\nAny foot wound that doesn''t heal in 48h: notify RN.',
    'Insulin / oral hypoglycemics. Caregiver reminds; trained/authorized caregivers may administer per care plan.',
    'Ambulatory. Avoid hot water for foot soaks (risk of burns with reduced sensation).',
    'Diabetic / consistent-carb diet. Low sodium if also hypertensive. Limit concentrated sweets.',
    'Alert. Watch for confusion or sluggishness — could indicate blood-sugar swing.',
    true
  ),
  (
    'End of Life / Hospice Support', 'Comfort care for terminally ill clients. Comply with hospice plan of care.',
    'hospice', 'Personal Care + Companion', 'Daily, hours per hospice order',
    E'Maximize comfort and dignity\nSupport client and family emotionally\nFollow hospice plan of care exactly',
    E'Hospice nurse is lead. Caregiver supports, does not direct.\nGentle repositioning q2h to prevent skin breakdown.\nMouth care every 2 hours — terminal dehydration causes dry mouth.\nFamily presence is comforting — do not interrupt unless asked.\nPlay favorite music, read aloud, hold hand. Hearing is the last sense to go.',
    E'Do NOT call 911 for expected death — call hospice nurse first.\nDo not force food/water — terminal anorexia is natural and not painful.\nAny pain or distress: notify hospice immediately.',
    'Comfort meds (morphine, lorazepam, atropine) per hospice. Administered by hospice/family. Caregiver may remind/assist per training.',
    'Bed-bound likely. Two-person transfer if any. Use draw sheet to reposition.',
    'Offer small sips/ice chips per tolerance. Do not pressure intake.',
    'May be non-verbal. Continue to speak to client. Identify self when entering room.',
    true
  )
) AS t(template_name, template_description, category, service_type, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, is_built_in)
WHERE NOT EXISTS (
  -- Don't re-seed if templates already exist
  SELECT 1 FROM care_plan_templates WHERE is_built_in = true
);

COMMIT;
