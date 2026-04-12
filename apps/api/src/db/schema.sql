-- QuoteBot PostgreSQL Schema
-- Idempotent — safe to re-run on an existing database.
-- Apply: psql $DATABASE_URL -f src/db/schema.sql

-- uuid-ossp is blocked on Azure PostgreSQL; gen_random_uuid() is built-in since PG13

-- ─── Traders ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS traders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  business_name       TEXT        NOT NULL,
  trade               TEXT        NOT NULL,
  location            TEXT        NOT NULL,
  email               TEXT        UNIQUE NOT NULL,
  password_hash       TEXT        NOT NULL,
  whatsapp_number     TEXT        UNIQUE,          -- set after registration
  stripe_customer_id  TEXT,
  plan                TEXT        NOT NULL DEFAULT 'trial'
                        CHECK (plan IN ('trial', 'starter', 'pro')),
  onboarding_complete   BOOLEAN     NOT NULL DEFAULT FALSE,
  postcode              TEXT,
  materials_reviewed_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column adds for existing databases
ALTER TABLE traders    ADD COLUMN IF NOT EXISTS onboarding_complete    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE traders    ADD COLUMN IF NOT EXISTS postcode               TEXT;
ALTER TABLE traders    ADD COLUMN IF NOT EXISTS materials_reviewed_at  TIMESTAMPTZ;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS minimum_charge         DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_property_type  TEXT NOT NULL DEFAULT 'house';
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_urgency        TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_distance_miles DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE quotes     ADD COLUMN IF NOT EXISTS job_key                TEXT;

-- ─── Rate Cards ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_cards (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id             UUID          NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  labour_rate           DECIMAL(10,2) NOT NULL DEFAULT 0,
  call_out_fee          DECIMAL(10,2) NOT NULL DEFAULT 0,
  travel_rate_per_mile  DECIMAL(10,2) NOT NULL DEFAULT 0,
  markup_percent        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  vat_registered        BOOLEAN       NOT NULL DEFAULT FALSE,
  vat_rate              DECIMAL(5,4)  NOT NULL DEFAULT 0.20,
  deposit_percent       DECIMAL(5,2)  NOT NULL DEFAULT 0,
  minimum_charge         DECIMAL(10,2) NOT NULL DEFAULT 0,
  default_property_type  TEXT          NOT NULL DEFAULT 'house',
  default_urgency        TEXT          NOT NULL DEFAULT 'standard',
  default_distance_miles DECIMAL(8,2)  NOT NULL DEFAULT 0,
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT rate_cards_trader_id_unique UNIQUE (trader_id)
);

-- ─── Master Job Templates (global — seeded per trade) ─────────────────────────

CREATE TABLE IF NOT EXISTS master_job_templates (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  trade         TEXT         NOT NULL,
  job_key       VARCHAR(100) NOT NULL,
  label         TEXT         NOT NULL,
  labour_hours  DECIMAL(8,2) NOT NULL DEFAULT 0,
  CONSTRAINT master_job_templates_trade_key_unique UNIQUE (trade, job_key)
);

CREATE TABLE IF NOT EXISTS master_job_materials (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID          NOT NULL REFERENCES master_job_templates(id) ON DELETE CASCADE,
  item         TEXT          NOT NULL,
  cost         DECIMAL(10,2) NOT NULL DEFAULT 0
);

-- ─── Job Library (per-trader copy of templates, editable) ─────────────────────

CREATE TABLE IF NOT EXISTS job_library (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id     UUID         NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  job_key       VARCHAR(100) NOT NULL,
  label         TEXT         NOT NULL,
  labour_hours  DECIMAL(8,2) NOT NULL DEFAULT 0,
  is_custom         BOOLEAN      NOT NULL DEFAULT FALSE,
  active            BOOLEAN      NOT NULL DEFAULT TRUE,
  correction_count  INTEGER      NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT job_library_trader_job_key_unique UNIQUE (trader_id, job_key)
);

CREATE INDEX IF NOT EXISTS idx_job_library_trader_id ON job_library (trader_id);
CREATE INDEX IF NOT EXISTS idx_job_library_active    ON job_library (trader_id, active);

-- ─── Job Materials ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_materials (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_library_id UUID          NOT NULL REFERENCES job_library(id) ON DELETE CASCADE,
  item           TEXT          NOT NULL,
  cost           DECIMAL(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_job_materials_job_id ON job_materials (job_library_id);

-- ─── Quotes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotes (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id         UUID          NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  customer_name     TEXT          NOT NULL,
  customer_whatsapp TEXT          NOT NULL,
  status            TEXT          NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0,
  vat_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total             DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  pdf_url           TEXT,
  notes             TEXT,
  job_key           TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_trader_id ON quotes (trader_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status    ON quotes (trader_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_created   ON quotes (trader_id, created_at DESC);

-- ─── Quote Line Items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quote_line_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     UUID          NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description  TEXT          NOT NULL,
  qty          DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(10,2) NOT NULL DEFAULT 0,
  total        DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order   INTEGER       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote_id ON quote_line_items (quote_id, sort_order);

-- ─── Updated-at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'traders_updated_at') THEN
    CREATE TRIGGER traders_updated_at
      BEFORE UPDATE ON traders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rate_cards_updated_at') THEN
    CREATE TRIGGER rate_cards_updated_at
      BEFORE UPDATE ON rate_cards FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quotes_updated_at') THEN
    CREATE TRIGGER quotes_updated_at
      BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

-- ─── Seed: master job templates for Electrician ───────────────────────────────

INSERT INTO master_job_templates (trade, job_key, label, labour_hours) VALUES
  ('Electrician', 'consumer_unit_replacement', 'Consumer Unit Replacement',       4.0),
  ('Electrician', 'socket_single',             'Single Socket Outlet',            0.5),
  ('Electrician', 'socket_double',             'Double Socket Outlet',            0.75),
  ('Electrician', 'light_fitting',             'Light Fitting Installation',      0.5),
  ('Electrician', 'downlight_single',          'Downlight (per unit)',            0.5),
  ('Electrician', 'rewire_full',               'Full Rewire (3-bed house)',       40.0),
  ('Electrician', 'rewire_partial',            'Partial Rewire',                  8.0),
  ('Electrician', 'ev_charger',               'EV Charger Installation',         3.0),
  ('Electrician', 'outdoor_lighting',          'Outdoor Security Lighting',       2.0),
  ('Electrician', 'fault_finding',             'Fault Finding',                   1.0),
  ('Electrician', 'eicr',                      'EICR Inspection',                 3.0),
  ('Electrician', 'pat_testing',               'PAT Testing (per item)',          0.1)
ON CONFLICT (trade, job_key) DO NOTHING;

-- Default materials for consumer unit replacement
INSERT INTO master_job_materials (template_id, item, cost)
SELECT t.id, m.item, m.cost
FROM master_job_templates t
JOIN (VALUES
  ('consumer_unit_replacement', 'Consumer unit (18-way)',  95.00),
  ('consumer_unit_replacement', 'MCBs (set)',              45.00),
  ('consumer_unit_replacement', 'Cable clips & sundries',  12.00),
  ('ev_charger',                'EV charger unit',        350.00),
  ('ev_charger',                '6mm² twin & earth cable', 28.00),
  ('ev_charger',                'Consumer unit breaker',   18.00)
) AS m(job_key, item, cost) ON m.job_key = t.job_key
WHERE t.trade = 'Electrician'
ON CONFLICT DO NOTHING;
