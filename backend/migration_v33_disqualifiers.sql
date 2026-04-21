-- migration_v33_disqualifiers.sql
-- Wisconsin caregiver statutory bar list per Wis. Stat. § 50.065 + § 48.685
-- and DHS 12. Referenced by eligibilityEngine.js to produce pass / flag /
-- fail decisions on WORCS findings.
--
-- Run with: psql "$DATABASE_URL" -f migration_v33_disqualifiers.sql

CREATE TABLE IF NOT EXISTS caregiver_disqualifiers (
  id SERIAL PRIMARY KEY,
  category        VARCHAR(60) NOT NULL,
  statute         VARCHAR(60) NOT NULL,    -- e.g. Wis. Stat. § 940.01
  short_title     VARCHAR(200) NOT NULL,
  description     TEXT,
  severity        VARCHAR(20) NOT NULL
                  CHECK (severity IN ('permanent_bar','rehab_review','advisory')),
  -- Regex patterns we use to match WORCS findings text (case-insensitive).
  -- Multiple patterns supported; any match counts as a hit.
  match_patterns  TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disqualifiers_active ON caregiver_disqualifiers(is_active, severity);

-- ── Seed with the WI Stat. § 50.065(2)(bd) / DHS 12 bar list ──────────
-- "permanent_bar" = conviction bars the person from being a caregiver
-- with no rehabilitation review available.
-- "rehab_review" = conviction bars UNLESS the person obtains a rehabilitation
-- review finding substantial evidence of rehabilitation.
-- "advisory" = worth flagging but does not legally bar employment.
--
-- This is the authoritative list as of DHS 12.07(1m)(a) — update when the
-- statute changes. Match patterns are intentionally broad (case-insensitive
-- regex fragments against WORCS "charge description" text).

INSERT INTO caregiver_disqualifiers (category, statute, short_title, description, severity, match_patterns) VALUES
  -- Homicide / serious violent crimes (permanent)
  ('violence',      'Wis. Stat. § 940.01',   'First-degree intentional homicide',      'Intentional killing.',                                         'permanent_bar',
    ARRAY['first[- ]degree.*intentional.*homicide','first[- ]degree.*murder','intentional homicide']),
  ('violence',      'Wis. Stat. § 940.02',   'First-degree reckless homicide',         'Reckless killing under circumstances showing depraved mind.',  'permanent_bar',
    ARRAY['first[- ]degree.*reckless.*homicide']),
  ('violence',      'Wis. Stat. § 940.05',   'Second-degree intentional homicide',     'Intentional killing with mitigating circumstances.',           'permanent_bar',
    ARRAY['second[- ]degree.*intentional.*homicide']),
  ('violence',      'Wis. Stat. § 940.19',   'Aggravated battery',                      'Battery causing great bodily harm.',                           'rehab_review',
    ARRAY['aggravated battery','great bodily harm']),
  ('violence',      'Wis. Stat. § 940.225',  'Sexual assault (1st/2nd/3rd degree)',    'Nonconsensual sexual contact or intercourse.',                 'permanent_bar',
    ARRAY['sexual assault','sexual intercourse.*without consent','1st degree sexual','2nd degree sexual','3rd degree sexual']),
  ('violence',      'Wis. Stat. § 940.285',  'Abuse of a vulnerable adult',             'Intentional/negligent abuse of a vulnerable adult.',           'permanent_bar',
    ARRAY['abuse.*vulnerable adult','abuse of elderly','abuse of patient','abuse of resident']),
  ('violence',      'Wis. Stat. § 940.295',  'Abuse/neglect of patients/residents',    'Abuse or neglect in a care setting.',                          'permanent_bar',
    ARRAY['abuse.*patient','abuse.*resident','neglect.*patient','neglect.*resident']),

  -- Crimes against children (permanent)
  ('child_offenses','Wis. Stat. § 948.02',   'Sexual assault of a child',               'Sexual contact/intercourse with person under 16.',             'permanent_bar',
    ARRAY['sexual assault.*child','sexual contact.*child','948\\.02']),
  ('child_offenses','Wis. Stat. § 948.03',   'Physical abuse of a child',               'Physical abuse of a child.',                                   'permanent_bar',
    ARRAY['physical abuse.*child','child abuse','948\\.03']),
  ('child_offenses','Wis. Stat. § 948.04',   'Causing mental harm to a child',          'Intentional mental harm.',                                     'rehab_review',
    ARRAY['mental harm.*child','948\\.04']),
  ('child_offenses','Wis. Stat. § 948.05',   'Sexual exploitation of a child',          'Causing/permitting sexual conduct.',                           'permanent_bar',
    ARRAY['sexual exploitation.*child','948\\.05']),
  ('child_offenses','Wis. Stat. § 948.055',  'Causing child to view/listen to sexual activity', 'Exposing minors to sexual activity.',              'permanent_bar',
    ARRAY['child.*view.*sexual','child.*listen.*sexual','948\\.055']),
  ('child_offenses','Wis. Stat. § 948.06',   'Incest with a child',                     'Sexual contact with child relative.',                           'permanent_bar',
    ARRAY['incest.*child','948\\.06']),
  ('child_offenses','Wis. Stat. § 948.07',   'Child enticement',                        'Enticing a child into a secluded place.',                      'permanent_bar',
    ARRAY['child enticement','948\\.07']),
  ('child_offenses','Wis. Stat. § 948.08',   'Soliciting a child for prostitution',     'Soliciting a child for sex acts.',                             'permanent_bar',
    ARRAY['solicit.*child.*prostitut','948\\.08']),
  ('child_offenses','Wis. Stat. § 948.21',   'Neglect of a child',                      'Negligent failure to act as a parent/guardian.',               'rehab_review',
    ARRAY['neglect.*child','948\\.21']),
  ('child_offenses','Wis. Stat. § 948.22',   'Failure to support (child abandonment)',  'Intentional failure to support.',                              'advisory',
    ARRAY['failure to support','abandon.*child','948\\.22']),

  -- Property / financial crimes against patients (rehab review)
  ('financial',     'Wis. Stat. § 943.20',   'Theft',                                    'Taking property of another.',                                  'rehab_review',
    ARRAY['theft','larceny','943\\.20']),
  ('financial',     'Wis. Stat. § 943.201',  'Identity theft',                           'Using another person''s identity.',                            'rehab_review',
    ARRAY['identity theft','943\\.201']),
  ('financial',     'Wis. Stat. § 943.38',   'Forgery',                                  'Falsification of a writing.',                                  'rehab_review',
    ARRAY['forgery','943\\.38']),
  ('financial',     'Wis. Stat. § 943.41',   'Financial crimes (credit card etc.)',     'Credit/debit card fraud.',                                     'rehab_review',
    ARRAY['credit card.*fraud','943\\.41']),
  ('financial',     'Wis. Stat. § 946.52',   'Theft from a vulnerable person',           'Financial exploitation of a vulnerable adult.',                'permanent_bar',
    ARRAY['theft.*vulnerable','financial.*exploit','946\\.52']),

  -- Drugs (advisory / rehab review)
  ('drugs',         'Wis. Stat. § 961.41',   'Controlled substance manufacture/delivery','Manufacture or delivery of a controlled substance.',           'rehab_review',
    ARRAY['manufacture.*controlled','deliver.*controlled','961\\.41']),
  ('drugs',         'Wis. Stat. § 961.573',  'Drug paraphernalia possession',            'Possession of drug paraphernalia.',                            'advisory',
    ARRAY['drug paraphernalia','961\\.573']),

  -- Weapons
  ('weapons',       'Wis. Stat. § 941.29',   'Possession of firearm by felon',           'Felon in possession of a firearm.',                            'rehab_review',
    ARRAY['felon.*possession.*firearm','941\\.29']),

  -- Driving-related (relevant because caregivers drive to visits)
  ('driving',       'Wis. Stat. § 346.63',   'OWI — 3rd offense or higher',              'Operating while intoxicated, 3rd+ offense.',                   'advisory',
    ARRAY['owi.*3rd','owi.*4th','owi.*5th','owi.*sixth','operating while intoxicated.*3rd','dwi.*3rd']),
  ('driving',       'Wis. Stat. § 346.67',   'Hit and run',                              'Leaving the scene of an accident.',
    'rehab_review',
    ARRAY['hit and run','leaving.*scene','346\\.67']),

  -- OIG / federal exclusions (advisory — separate check from WORCS)
  ('federal',       '42 CFR § 1001',         'OIG exclusion list',                       'Excluded from participation in federal healthcare programs.', 'permanent_bar',
    ARRAY['oig.*exclus','medicaid.*exclus','medicare.*exclus'])
ON CONFLICT DO NOTHING;
