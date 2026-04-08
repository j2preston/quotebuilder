# Pricing Engine — Tuneability Ideas

The current engine is deterministic and works well. These are ideas to make it more accurate and more configurable without breaking the "describe it, get a quote" flow.

---

## How the engine works today

```
Labour hours (from job library)
  × property type multiplier (1.0 – 1.25)
  × urgency multiplier (1.0 – 1.50)
+ complexity contingency hours × base labour rate
+ materials cost × (1 + global markup %)
+ travel (miles × pence/mile)
+ call-out fee
= subtotal → VAT → total → deposit
```

Everything flows from four sources:
- **Job library** — hours and material costs
- **Rate card** — labour rate, markup %, call-out fee, travel rate, VAT, deposit %
- **Multiplier tables** — hard-coded in `pricingEngine.ts`
- **Claude extraction** — maps the transcript to these inputs

---

## Ideas, roughly by implementation effort

### Low effort — add fields to existing tables

**1. Per-job minimum charge**
Some jobs aren't worth doing for less than £X. Add `min_charge` to `job_library`. The engine uses `max(calculated total, min_charge)`.

```sql
ALTER TABLE job_library ADD COLUMN min_charge DECIMAL(10,2) DEFAULT 0;
```

Good for: consumer unit swaps that have a hard floor, any job with fixed permit/cert costs.

---

**2. Wastage factor on materials**
Trades over-order by 10–15% as standard (wire by the metre, tiles, plasterboard). Add a `wastage_percent` per material or per job, applied before markup.

```sql
ALTER TABLE job_materials ADD COLUMN wastage_percent DECIMAL(5,2) DEFAULT 0;
```

Engine: `cost × (1 + wastage/100) × (1 + markup/100)`

Avoids the trader having to inflate costs manually.

---

**3. Certificate / sundry fee per job**
Some jobs require an EICR, EPC, Part P notification, building control fee. These are fixed costs that aren't materials and aren't labour. Add a `cert_fee` column to `job_library`.

```sql
ALTER TABLE job_library ADD COLUMN cert_fee DECIMAL(10,2) DEFAULT 0;
```

Appears as its own line item ("Part P notification fee") so the customer can see it.

---

**4. Weekend / out-of-hours rate multiplier on rate card**
Currently urgency covers this loosely. Add an explicit `weekend_rate_multiplier` (default 1.0) to `rate_cards`. Claude extraction adds an `outOfHours: boolean` flag, which the engine applies.

Keeps normal same-day jobs separate from "Saturday emergency" pricing.

---

### Medium effort — make multiplier tables configurable

**5. Trader-configurable property multipliers**
The current multipliers (`flat_upper: 1.15`, `commercial: 1.25`) are hard-coded and generic. Move them to a `rate_modifiers` table — one row per trader, per property type.

```sql
CREATE TABLE rate_modifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id     UUID NOT NULL REFERENCES traders(id),
  modifier_type TEXT NOT NULL,  -- 'property_type' | 'urgency' | 'complexity_flag'
  key           TEXT NOT NULL,  -- 'commercial' | 'same_day' | 'older_property'
  multiplier    DECIMAL(6,4) NOT NULL DEFAULT 1.0,
  extra_hours   DECIMAL(5,2) NOT NULL DEFAULT 0,
  UNIQUE(trader_id, modifier_type, key)
);
```

Seeded from defaults on registration. The settings UI gets a "Pricing Modifiers" section where traders can tune these. Electricians working exclusively commercial can remove the flat/house distinction entirely.

---

**6. Per-job complexity flags**
The current complexity flags (`older_property`, `no_existing_cable_run`, `multiple_floors`) are global. Some only apply to certain job types — `no_existing_cable_run` is irrelevant for a fuse board swap.

Add a `job_complexity_flags` join table that controls which flags are valid for each job, and optionally overrides hours for that specific job.

```sql
CREATE TABLE job_complexity_flags (
  job_library_id UUID NOT NULL REFERENCES job_library(id) ON DELETE CASCADE,
  flag_key       TEXT NOT NULL,
  extra_hours    DECIMAL(5,2) NOT NULL DEFAULT 0.5,
  PRIMARY KEY (job_library_id, flag_key)
);
```

---

**7. Per-material markup (override global)**
Right now all materials are marked up by the same global `markup_percent`. Some materials have no margin at all (e.g. special order, pass-through cost). Add an optional `markup_override` column to `job_materials`.

```sql
ALTER TABLE job_materials ADD COLUMN markup_override DECIMAL(5,2) DEFAULT NULL;
```

`NULL` means "use the global rate card markup". Any value overrides it for that line.

---

### Higher effort — new pricing dimensions

**8. Flat-rate job pricing**
Some traders price by fixed quote, not by hours. An EV charger install is £X regardless of whether it takes 3 or 4 hours. Add `pricing_mode: 'hourly' | 'flat'` to `job_library`, with a `flat_price` field. Urgency and property multipliers can still apply (or not — configurable).

Good for: jobs the trader knows cold, competitive tendering.

---

**9. Job bundling discount**
When a quote contains more than one job on the same visit (e.g. consumer unit + smoke detectors), offer a discount on the second job's labour. Add a `bundle_discount_percent` to `rate_cards` (default 0). Engine detects when multiple job library entries are in one quote and applies the discount to additional jobs.

Requires quoting multiple jobs in one go — small change to the extraction prompt, larger change to the pricing engine.

---

**10. Returning customer discount**
Track `quote_count` per customer WhatsApp number. After N quotes to the same customer, optionally apply a loyalty discount. Entirely optional — set to 0 by default.

Needs a `customers` table and linking quotes by phone number, which is prep work for a CRM-lite view anyway.

---

**11. Tiered deposit by quote size**
Currently deposit is a flat percentage. In practice, tradespeople ask for a higher percentage deposit on smaller jobs (they're lower risk) and accept lower deposits on large jobs (cash flow risk for the customer). A simple table:

```
Up to £200 → 50% deposit
£200–£500  → 33% deposit
£500+      → 25% deposit
```

Add a `deposit_tiers` JSONB column to `rate_cards` (or a separate table). The engine picks the right tier based on the calculated total.

---

## What to build first

| Idea | Value | Effort | Build it? |
|---|---|---|---|
| Min charge per job | High — stops underselling | Low | Yes — next sprint |
| Wastage % per material | Medium — accuracy | Low | Yes — when adding materials |
| Cert/sundry fee | High — often forgotten | Low | Yes — especially for electricians |
| Weekend multiplier | Medium | Low | Yes |
| Configurable property multipliers | High for commercial traders | Medium | Yes — before expanding trades |
| Per-job complexity flags | Medium | Medium | Later |
| Per-material markup override | Medium | Low | Yes — add alongside material editing |
| Flat-rate pricing mode | High — common request | Medium | Yes — needed for EV chargers, smart home |
| Job bundling | Low for now | High | Later |
| Tiered deposit | Low for now | Low | Later |

---

## Where each idea fits in the UI

**Job library entry (already exists):**
- Min charge
- Cert/sundry fee
- Pricing mode (hourly vs flat)
- Per-job complexity flags

**Materials row (already exists):**
- Wastage %
- Markup override

**Rate card (already exists):**
- Weekend/out-of-hours multiplier
- Tiered deposit

**New "Pricing Modifiers" settings section:**
- Property type multipliers
- Urgency multipliers
- Complexity contingency hours

None of these require a visible change to the quote output or the dictation flow. They just make the number more accurate.
