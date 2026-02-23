-- ═══════════════════════════════════════════════════════
-- MIGRATION v7: Communication Log, No-Show Alerts,
--               Form Builder, Revenue Forecasting
-- ═══════════════════════════════════════════════════════

-- ─── 1. COMMUNICATION LOG ───────────────────────────────
CREATE TABLE IF NOT EXISTS communication_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','caregiver')),
  entity_id       UUID NOT NULL,
  log_type        VARCHAR(30) NOT NULL DEFAULT 'note'
                  CHECK (log_type IN ('note','call','email','text','visit','incident','complaint','compliment','other')),
  direction       VARCHAR(10) CHECK (direction IN ('inbound','outbound','internal')),
  subject         VARCHAR(255),
  body            TEXT NOT NULL,
  logged_by       UUID REFERENCES users(id),
  logged_by_name  VARCHAR(100),
  follow_up_date  DATE,
  follow_up_done  BOOLEAN DEFAULT FALSE,
  is_pinned       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comm_log_entity ON communication_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_created ON communication_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_log_followup ON communication_log(follow_up_date) WHERE follow_up_done = FALSE;

-- ─── 2. NO-SHOW ALERT CONFIG ────────────────────────────
CREATE TABLE IF NOT EXISTS noshow_alert_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grace_minutes   INT NOT NULL DEFAULT 15,
  notify_admin    BOOLEAN DEFAULT TRUE,
  notify_caregiver BOOLEAN DEFAULT TRUE,
  notify_client_family BOOLEAN DEFAULT FALSE,
  admin_phone     VARCHAR(20),
  admin_email     VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Insert default config if none exists
INSERT INTO noshow_alert_config (grace_minutes, notify_admin, notify_caregiver, is_active)
SELECT 15, TRUE, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM noshow_alert_config);

CREATE TABLE IF NOT EXISTS noshow_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID,
  caregiver_id    UUID REFERENCES users(id),
  client_id       UUID REFERENCES clients(id),
  shift_date      DATE NOT NULL,
  expected_start  TIME NOT NULL,
  alerted_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id),
  resolution_note TEXT,
  status          VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','resolved','false_alarm')),
  sms_sent        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_noshow_status ON noshow_alerts(status, shift_date);
CREATE INDEX IF NOT EXISTS idx_noshow_caregiver ON noshow_alerts(caregiver_id);

-- ─── 3. FORM / DOCUMENT BUILDER ─────────────────────────
CREATE TABLE IF NOT EXISTS form_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  category        VARCHAR(50) DEFAULT 'general'
                  CHECK (category IN ('assessment','incident','physician_order','consent','intake','hr','general')),
  fields          JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN DEFAULT TRUE,
  requires_signature BOOLEAN DEFAULT FALSE,
  auto_attach_to  VARCHAR(20) CHECK (auto_attach_to IN ('client','caregiver','both')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_templates_category ON form_templates(category, is_active);

CREATE TABLE IF NOT EXISTS form_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID REFERENCES form_templates(id),
  template_name   VARCHAR(255),
  entity_type     VARCHAR(20) CHECK (entity_type IN ('client','caregiver')),
  entity_id       UUID,
  submitted_by    UUID REFERENCES users(id),
  submitted_by_name VARCHAR(100),
  data            JSONB NOT NULL DEFAULT '{}',
  signature       TEXT,
  signed_at       TIMESTAMPTZ,
  status          VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','signed','archived')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_entity ON form_submissions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_template ON form_submissions(template_id);

-- Seed a few starter templates
INSERT INTO form_templates (name, description, category, requires_signature, auto_attach_to, fields) VALUES
('Initial Client Assessment', 'Standard intake assessment for new clients', 'assessment', TRUE, 'client', '[
  {"id":"f1","type":"text","label":"Primary Diagnosis","required":true},
  {"id":"f2","type":"textarea","label":"Medical History","required":false},
  {"id":"f3","type":"select","label":"Mobility Level","required":true,"options":["Independent","Requires Assistance","Non-Ambulatory"]},
  {"id":"f4","type":"select","label":"Cognitive Status","required":true,"options":["Alert & Oriented","Mild Impairment","Moderate Impairment","Severe Impairment"]},
  {"id":"f5","type":"checkbox","label":"Fall Risk","required":false},
  {"id":"f6","type":"checkbox","label":"Requires Hoyer Lift","required":false},
  {"id":"f7","type":"textarea","label":"Special Instructions for Caregiver","required":false},
  {"id":"f8","type":"text","label":"Emergency Contact Name","required":true},
  {"id":"f9","type":"text","label":"Emergency Contact Phone","required":true}
]'),
('Incident Report', 'Document any incidents during a visit', 'incident', TRUE, 'client', '[
  {"id":"i1","type":"text","label":"Date of Incident","required":true,"inputType":"date"},
  {"id":"i2","type":"text","label":"Time of Incident","required":true,"inputType":"time"},
  {"id":"i3","type":"select","label":"Incident Type","required":true,"options":["Fall","Medication Error","Behavioral Issue","Medical Emergency","Property Damage","Complaint","Other"]},
  {"id":"i4","type":"textarea","label":"Description of Incident","required":true},
  {"id":"i5","type":"textarea","label":"Immediate Actions Taken","required":true},
  {"id":"i6","type":"checkbox","label":"911 Called","required":false},
  {"id":"i7","type":"checkbox","label":"Family Notified","required":false},
  {"id":"i8","type":"checkbox","label":"Supervisor Notified","required":false},
  {"id":"i9","type":"textarea","label":"Follow-up Required","required":false}
]'),
('Caregiver HR Review', 'Annual performance and compliance review', 'hr', TRUE, 'caregiver', '[
  {"id":"h1","type":"select","label":"Review Period","required":true,"options":["Q1","Q2","Q3","Q4","Annual"]},
  {"id":"h2","type":"select","label":"Attendance Rating","required":true,"options":["Excellent","Good","Needs Improvement","Unsatisfactory"]},
  {"id":"h3","type":"select","label":"Performance Rating","required":true,"options":["Exceeds Expectations","Meets Expectations","Below Expectations"]},
  {"id":"h4","type":"textarea","label":"Strengths","required":false},
  {"id":"h5","type":"textarea","label":"Areas for Improvement","required":false},
  {"id":"h6","type":"checkbox","label":"CPR Certification Current","required":false},
  {"id":"h7","type":"checkbox","label":"Background Check Current","required":false},
  {"id":"h8","type":"textarea","label":"Supervisor Comments","required":false}
]')
ON CONFLICT DO NOTHING;
