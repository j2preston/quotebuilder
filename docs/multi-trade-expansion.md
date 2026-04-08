# Multi-Trade Expansion — Complexity Assessment

TL;DR: **less work than you'd expect.** The hard architecture is already trade-aware. The actual effort is data, not code.

---

## What already works for any trade

The schema and engine were built trade-agnostic from the start:

- `traders.trade` is a free-text field — nothing enforces "Electrician"
- `master_job_templates` is keyed on `(trade, job_key)` — already supports any trade
- The AI extraction system prompt uses `trader.trade` and `trader.location` directly:
  > *"You are a quoting assistant for Dave's Electrical, an **Electrician** based in Manchester"*
- Job library is per-trader — a plumber and an electrician never see each other's jobs
- Rate card is per-trader — different labour rates, markup, VAT status
- Complexity flags are extracted by Claude based on context — it will infer "ground floor access" vs "roof access" from a description without explicit training

---

## What needs changing per trade

### 1. Job template seeding (data — not code)

This is 90% of the work. For each new trade you need to populate `master_job_templates` with sensible defaults. These get copied into a new trader's `job_library` on registration.

Example for **Plumber**:
```sql
INSERT INTO master_job_templates (trade, job_key, label, labour_hours) VALUES
  ('Plumber', 'tap_replacement',           'Tap Replacement',               1.5),
  ('Plumber', 'toilet_cistern',            'Toilet Cistern Repair',         1.0),
  ('Plumber', 'boiler_service',            'Boiler Service',                1.5),
  ('Plumber', 'boiler_replacement',        'Boiler Replacement',           6.0),
  ('Plumber', 'radiator_replacement',      'Radiator Replacement',          2.0),
  ('Plumber', 'bathroom_full',             'Full Bathroom Installation',   16.0),
  ('Plumber', 'leak_repair',               'Leak Investigation & Repair',   1.5),
  ('Plumber', 'drain_unblock',             'Drain Unblocking',              1.0),
  ('Plumber', 'cylinder_replacement',      'Hot Water Cylinder Replacement', 4.0),
  ('Plumber', 'shower_installation',       'Shower Installation',           3.0)
ON CONFLICT (trade, job_key) DO NOTHING;
```

Same for materials — e.g. a boiler replacement needs a boiler unit, flue kit, TRVs, etc.

The research (correct hours, correct material costs) is the real effort here. Getting it wrong means inaccurate quotes. Worth getting a working plumber to validate the data before launching to that trade.

---

### 2. Complexity flags (minor code change)

Current flags are hard-coded in `pricingEngine.ts` and are electrician-specific:
- `older_property` — adds 0.5hr contingency
- `no_existing_cable_run` — adds 1hr
- `multiple_floors` — adds 1hr

These need to become trade-aware, or expanded to be generic enough to apply cross-trade. Options:

**Option A — move flags to the database** (recommended)
Store complexity flags in a `complexity_flags` table with `trade` and `extra_hours`. The engine loads the relevant flags per trader rather than reading from a hard-coded object. This also enables per-trader overrides.

```sql
CREATE TABLE complexity_flags (
  trade       TEXT NOT NULL,
  flag_key    TEXT NOT NULL,
  label       TEXT NOT NULL,
  extra_hours DECIMAL(5,2) NOT NULL DEFAULT 0.5,
  PRIMARY KEY (trade, flag_key)
);
```

**Option B — use Claude for flag extraction** (simplest short-term)
The AI already extracts `complexityFlags` from a free-text description. Expand the system prompt to include a trade-specific list of valid flags. No schema change needed; the engine silently ignores unknown flags already.

**Option C — keep flags generic** (acceptable if trades overlap)
Some flags apply to any trade: `older_property`, `restricted_access`, `multiple_floors`, `hazardous_materials`. Trades can use whichever subset applies. This is the laziest path and works well enough initially.

---

### 3. Property type multipliers (possibly no change needed)

Current multipliers:
```
house:       1.00
flat_ground: 1.00
flat_upper:  1.15
commercial:  1.25
new_build:   0.90
```

These are reasonable for most trades. A plumber replacing a radiator on the 4th floor of a flat will charge more — same model. A roofer doesn't care about flat vs house in the same way, but `commercial` and `new_build` still make sense.

Short-term: use the same table. It's a good-enough approximation.
Long-term: make multipliers configurable per trader (see [pricing-ideas.md](./pricing-ideas.md) — "configurable property multipliers").

---

### 4. Registration flow (minor UX change)

Currently the registration form has a "Trade" free-text input. To properly seed templates, it needs to be a dropdown or type-ahead that maps to known values:

```
Electrician ✓ (live)
Plumber (coming soon)
Gas Engineer (coming soon)
Carpenter / Joiner (coming soon)
Roofer (coming soon)
Plasterer (coming soon)
Painter & Decorator (coming soon)
```

On `POST /auth/register`, the API already copies templates from `master_job_templates WHERE trade = $1` into the new trader's `job_library`. That logic just needs the template data to exist.

---

### 5. AI extraction prompt — no change needed

The extraction prompt dynamically includes the trader's trade and their full job library:
```
"Your job is to extract structured information from a job description..."
"jobKey: closest match from: boiler_service, tap_replacement, radiator_replacement, ..."
```

Claude already understands plumbing, roofing, carpentry terminology. It will correctly map "leaky pipe under the sink" to `leak_repair` without any prompt engineering beyond providing the job key list. This has been validated for electricians; the same approach works for other trades.

---

## Effort estimate by trade

| Trade | Job templates to write | Complexity flags | Known gotchas |
|---|---|---|---|
| **Electrician** | Done | Done | — |
| **Plumber** | ~15–20 jobs | `gravity_fed_system`, `combi_boiler`, `restricted_access` | Gas work (Gas Safe reg required) — separate flow? |
| **Gas Engineer** | ~10 jobs | `old_boiler`, `no_flue_access`, `asbestos_risk` | Gas Safe registration check on signup |
| **Carpenter / Joiner** | ~15 jobs | `bespoke_fit`, `structural`, `period_property` | Wide variance in material costs (hardwood vs softwood) |
| **Roofer** | ~12 jobs | `height_access`, `asbestos_risk`, `lead_flashing` | Scaffold costs often separate — needs its own line item type |
| **Plasterer** | ~10 jobs | `artex_ceiling`, `listed_building`, `damp_present` | Area-based pricing (m²) instead of hours — engine change needed |
| **Painter & Decorator** | ~12 jobs | `multiple_coats`, `bare_plaster`, `wallpaper_removal` | Same — area-based pricing model |

---

## The one structural change that unlocks most trades

**Area-based pricing** (m² or linear metres) is needed for plasterers, decorators, tilers, flooring fitters. The current engine is `hours × rate`. To support these trades, add a `pricing_mode` field to `job_library`:

```
'hourly'  — current model (hours × rate)
'flat'    — fixed price per job
'area'    — price per m² (needs area input from Claude extraction)
```

This is the single biggest architectural addition for expanding to area-based trades. Not complex — probably a day of work — but it needs to be done before those trades make sense.

---

## Recommended launch order

1. **Plumber** — model is identical to electrician, biggest market, lots of crossover with homeowners who already know the app from their electrician
2. **Gas Engineer** — overlaps heavily with plumbers; many hold both qualifications
3. **Carpenter** — large market; mostly hourly-based so no new pricing model needed
4. **Plasterer / Decorator / Tiler** — do these together once area-based pricing is built

---

## What does NOT need to change

- The quote PDF generation — trade-agnostic
- The WhatsApp delivery flow — trade-agnostic
- The Stripe billing / subscription tiers — trade-agnostic
- The frontend entirely — it renders whatever jobs are in the library
- The authentication, rate cards, quote history — all trade-agnostic
- The Azure infrastructure — no changes

The only things that change are: job template data, complexity flag data, and eventually the pricing mode enum. The product is already designed for this.
