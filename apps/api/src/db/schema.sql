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
ALTER TABLE traders ADD COLUMN IF NOT EXISTS onboarding_complete    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS postcode               TEXT;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS materials_reviewed_at  TIMESTAMPTZ;

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

-- Idempotent column adds for existing databases
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS minimum_charge         DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_property_type  TEXT          NOT NULL DEFAULT 'house';
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_urgency        TEXT          NOT NULL DEFAULT 'standard';
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS default_distance_miles DECIMAL(8,2)  NOT NULL DEFAULT 0;

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

CREATE INDEX IF NOT EXISTS idx_quotes_trader_id           ON quotes (trader_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status              ON quotes (trader_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_created             ON quotes (trader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_whatsapp   ON quotes (customer_whatsapp);

-- Idempotent column adds for existing databases
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS job_key TEXT;

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

-- ─── Seed: master job templates for Plumber ──────────────────────────────────

INSERT INTO master_job_templates (trade, job_key, label, labour_hours) VALUES
  ('Plumber', 'tap_replacement',         'Tap Replacement',                     1.0),
  ('Plumber', 'stop_cock_replacement',   'Stop Cock Replacement',               1.0),
  ('Plumber', 'toilet_cistern_repair',   'Toilet Cistern Repair',               1.0),
  ('Plumber', 'toilet_replacement',      'Toilet Replacement',                  2.5),
  ('Plumber', 'basin_replacement',       'Basin Replacement',                   2.5),
  ('Plumber', 'bath_replacement',        'Bath Replacement',                    5.0),
  ('Plumber', 'shower_electric',         'Electric Shower Installation',        3.0),
  ('Plumber', 'shower_mixer',            'Mixer Shower Installation',           4.0),
  ('Plumber', 'outdoor_tap',             'Outdoor Tap Fitting',                 1.5),
  ('Plumber', 'radiator_installation',   'Radiator Installation',               2.0),
  ('Plumber', 'leak_repair',             'Leak Investigation & Repair',         1.0),
  ('Plumber', 'powerflush',              'Central Heating Powerflush',          4.0),
  ('Plumber', 'unvented_cylinder',       'Unvented Cylinder Replacement',       6.0),
  ('Plumber', 'bathroom_full',           'Full Bathroom Installation',         16.0)
ON CONFLICT (trade, job_key) DO NOTHING;

-- Default materials for common plumber jobs
INSERT INTO master_job_materials (template_id, item, cost)
SELECT t.id, m.item, m.cost
FROM master_job_templates t
JOIN (VALUES
  ('toilet_replacement',   'Close-coupled toilet (inc. seat)', 120.00),
  ('toilet_replacement',   'Isolation valve',                   12.00),
  ('toilet_replacement',   'Flexible connector',                 6.00),
  ('toilet_replacement',   'Silicone & fixings',                 8.00),
  ('basin_replacement',    'Basin',                             75.00),
  ('basin_replacement',    'Basin tap (pair)',                  45.00),
  ('basin_replacement',    'Pop-up waste',                      12.00),
  ('basin_replacement',    'Flexible hoses (pair)',              8.00),
  ('shower_electric',      'Electric shower unit',             180.00),
  ('shower_electric',      '10mm² twin & earth cable',          22.00),
  ('shower_electric',      'Shower enclosure',                 120.00),
  ('unvented_cylinder',    'Unvented hot water cylinder',      650.00),
  ('unvented_cylinder',    'Expansion vessel',                  45.00),
  ('unvented_cylinder',    'Pressure reducing valve',           35.00),
  ('unvented_cylinder',    'Discharge pipe & fittings',         20.00)
) AS m(job_key, item, cost) ON m.job_key = t.job_key
WHERE t.trade = 'Plumber'
ON CONFLICT DO NOTHING;

-- ─── Seed: master job templates for Gas Engineer ──────────────────────────────

INSERT INTO master_job_templates (trade, job_key, label, labour_hours) VALUES
  ('Gas Engineer', 'boiler_service',          'Boiler Service',                      1.5),
  ('Gas Engineer', 'boiler_repair',           'Boiler Repair',                       2.0),
  ('Gas Engineer', 'boiler_replacement',      'Boiler Replacement (like-for-like)',  6.0),
  ('Gas Engineer', 'gas_safety_certificate',  'Gas Safety Certificate (CP12)',       1.0),
  ('Gas Engineer', 'gas_leak_investigation',  'Gas Leak Investigation',              1.0),
  ('Gas Engineer', 'radiator_installation',   'Radiator Installation',               1.5),
  ('Gas Engineer', 'thermostat_upgrade',      'Thermostat & Controls Upgrade',       1.0),
  ('Gas Engineer', 'pressure_relief_valve',   'Pressure Relief Valve Replacement',   1.0),
  ('Gas Engineer', 'flue_replacement',        'Flue Installation / Replacement',     2.0),
  ('Gas Engineer', 'system_flush',            'Central Heating System Flush',        4.0)
ON CONFLICT (trade, job_key) DO NOTHING;

-- Default materials for common gas engineer jobs
INSERT INTO master_job_materials (template_id, item, cost)
SELECT t.id, m.item, m.cost
FROM master_job_templates t
JOIN (VALUES
  ('boiler_replacement',     'Combi boiler (mid-range)',           900.00),
  ('boiler_replacement',     'Flue kit',                           75.00),
  ('boiler_replacement',     'Gas valve',                          85.00),
  ('boiler_replacement',     'Magnetic system filter',             65.00),
  ('boiler_replacement',     'Chemical inhibitor',                 15.00),
  ('boiler_service',         'Service kit (seals, gaskets)',       18.00),
  ('boiler_service',         'Chemical inhibitor top-up',         12.00),
  ('thermostat_upgrade',     'Smart thermostat (e.g. Hive)',      120.00),
  ('thermostat_upgrade',     'Receiver unit',                      45.00),
  ('pressure_relief_valve',  'Pressure relief valve',              22.00),
  ('pressure_relief_valve',  'Discharge pipe & fittings',         12.00)
) AS m(job_key, item, cost) ON m.job_key = t.job_key
WHERE t.trade = 'Gas Engineer'
ON CONFLICT DO NOTHING;
