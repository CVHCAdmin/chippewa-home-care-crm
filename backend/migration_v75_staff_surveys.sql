-- v75: anonymous staff surveys ("how are we doing as owners?").
--
-- ANONYMITY BY DESIGN: who was invited / who has answered (survey_invitations) and what
-- was answered (survey_responses) are stored separately with NOTHING linking them — no
-- user id, no token, no invitation id, and only the DATE on a response (no time of day),
-- so a response can't be matched to a person even by someone reading the database.
-- The only identity on a response is a name the respondent chose to type ("contact me").

CREATE TABLE IF NOT EXISTS surveys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  intro       TEXT,
  questions   JSONB NOT NULL,        -- [{ key, type: 'scale5'|'nps'|'text', label }]
  status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS survey_invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id         UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token             VARCHAR(128) NOT NULL UNIQUE,
  email_to          VARCHAR(255),
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded         BOOLEAN NOT NULL DEFAULT false,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  last_reminded_at  TIMESTAMPTZ,
  UNIQUE (survey_id, user_id)
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id     UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  answers       JSONB NOT NULL,
  contact_name  VARCHAR(120),          -- only if the respondent chose to give it
  submitted_on  DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_survey ON survey_invitations (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses (survey_id);
