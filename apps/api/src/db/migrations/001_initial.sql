-- QuoteBot Initial Schema
-- Run via: psql $DATABASE_URL -f src/db/migrations/001_initial.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Traders ──────────────────────────────────────────────────────────────────

CREATE TABLE traders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                   TEXT UNIQUE NOT NULL,
  password_hash           TEXT NOT NULL,
  full_name               TEXT NOT NULL,
  business_name           TEXT NOT NULL,
  phone                   TEXT NOT NULL,
  vat_number              TEXT,
  logo_url                TEXT,
  address_line1           TEXT NOT NULL DEFAULT '',
  address_line2           TEXT,
  city                    TEXT NOT NULL DEFAULT '',
  postcode                TEXT NOT NULL DEFAULT '',

  -- Defaults for quoting
  default_vat_rate        INTEGER NOT NULL DEFAULT 20,      -- percent
  default_markup          INTEGER NOT NULL DEFAULT 20,      -- percent
  default_labour_rate     INTEGER NOT NULL DEFAULT 4500,    -- pence/hr
  quote_validity_days     INTEGER NOT NULL DEFAULT 30,
  payment_terms_days      INTEGER NOT NULL DEFAULT 14,
  quote_footer_text       TEXT,

  -- Subscription
  subscription_tier       TEXT NOT NULL DEFAULT 'free'
                            CHECK (subscription_tier IN ('free','starter','pro')),
  subscription_status     TEXT NOT NULL DEFAULT 'active'
                            CHECK (subscription_status IN ('active','trialing','past_due','canceled','unpaid')),
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  quotes_used_this_month  INTEGER NOT NULL DEFAULT 0,
  quota_reset_at          TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()) + INTERVAL '1 month',

  -- WhatsApp
  whatsapp_number         TEXT,

  -- Quote sequence
  quote_sequence          INTEGER NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Customers ────────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trader_id    UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city         TEXT,
  postcode     TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_trader_id ON customers(trader_id);

-- ─── Quotes ───────────────────────────────────────────────────────────────────

CREATE TABLE quotes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trader_id             UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','pending_review','ready','sent','viewed','accepted','declined','expired')),
  job_type              TEXT NOT NULL DEFAULT 'other',
  job_description       TEXT NOT NULL DEFAULT '',
  job_address           TEXT,
  internal_notes        TEXT,

  -- AI data
  ai_raw_transcript     TEXT,
  ai_extracted_data     JSONB,

  -- Pricing (pence)
  subtotal_net_pence    INTEGER NOT NULL DEFAULT 0,
  vat_pct               INTEGER NOT NULL DEFAULT 20,
  vat_amount_pence      INTEGER NOT NULL DEFAULT 0,
  total_gross_pence     INTEGER NOT NULL DEFAULT 0,

  -- Meta
  quote_number          TEXT NOT NULL,
  valid_until           DATE,
  sent_at               TIMESTAMPTZ,
  viewed_at             TIMESTAMPTZ,
  accepted_at           TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  stripe_payment_link_url TEXT,
  pdf_url               TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotes_trader_id ON quotes(trader_id);
CREATE INDEX idx_quotes_status ON quotes(trader_id, status);
CREATE INDEX idx_quotes_created ON quotes(trader_id, created_at DESC);

-- ─── Quote Line Items ─────────────────────────────────────────────────────────

CREATE TABLE quote_line_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id            UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  description         TEXT NOT NULL,
  quantity            NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit                TEXT NOT NULL DEFAULT 'each',
  unit_cost_pence     INTEGER NOT NULL DEFAULT 0,
  markup_pct          INTEGER NOT NULL DEFAULT 0,
  labour_minutes      INTEGER NOT NULL DEFAULT 0,
  labour_rate_pence   INTEGER NOT NULL DEFAULT 4500,
  line_net_pence      INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_line_items_quote_id ON quote_line_items(quote_id, sort_order);

-- ─── Refresh Tokens ───────────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trader_id    UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_trader ON refresh_tokens(trader_id);

-- ─── Updated At Trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER traders_updated_at BEFORE UPDATE ON traders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
