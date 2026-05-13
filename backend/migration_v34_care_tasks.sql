-- migration_v34_care_tasks.sql
-- Per-client care task templates + per-shift completion logs.
-- Templates are the recurring checklist of tasks for a client; completion
-- logs are how each visit performs against that list.

CREATE TABLE IF NOT EXISTS client_task_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50) DEFAULT 'other' CHECK (category IN ('adl','iadl','medication','companion','safety','other')),
  allotted_minutes INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_tasks_client ON client_task_templates(client_id, is_active);

CREATE TABLE IF NOT EXISTS shift_task_completions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  task_template_id UUID NOT NULL REFERENCES client_task_templates(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped','refused')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (time_entry_id, task_template_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_tasks_entry ON shift_task_completions(time_entry_id);
