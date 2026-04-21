-- migration_v31_job_postings.sql
-- Adds admin-managed job postings for the website careers page.
-- Run with: psql "$DATABASE_URL" -f migration_v31_job_postings.sql

CREATE TABLE IF NOT EXISTS job_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  employment_type VARCHAR(30) NOT NULL DEFAULT 'part_time'
    CHECK (employment_type IN ('full_time','part_time','prn','contract')),
  location VARCHAR(120),
  pay_range_min NUMERIC(10,2),
  pay_range_max NUMERIC(10,2),
  pay_rate_unit VARCHAR(20) NOT NULL DEFAULT 'hour'
    CHECK (pay_rate_unit IN ('hour','week','year','visit')),
  summary TEXT,                       -- short card description (1-2 sentences)
  description TEXT NOT NULL,          -- full job description (rich text / markdown)
  responsibilities TEXT,
  qualifications TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,              -- NULL = open indefinitely
  applications_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_published
  ON job_postings(is_published, closes_at)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_job_postings_slug ON job_postings(slug);

-- Link applications to postings when submitted via the careers page.
-- Nullable because existing applications predate postings, and the website
-- can still accept general-interest submissions when nothing is posted.
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS posting_id UUID REFERENCES job_postings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_applications_posting
  ON job_applications(posting_id)
  WHERE posting_id IS NOT NULL;
