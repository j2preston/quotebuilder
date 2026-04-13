# Early User Backlog

Items that should be resolved before or shortly after onboarding first paying users.
Ordered by impact on first impressions and quote accuracy.

---

## P0 — Embarrassing if seen by a real user

- [x] **Remove or implement the Upgrade button** — replaced with "coming soon" text
- [x] **Fix quote usage tracking** — `quotes_used_this_month` now incremented inside the quote insert transaction
- [x] **Lock quotes to draft-only editing** — `canEdit` now checks `status === 'draft'` only
- [x] **PDF failure should surface to the user** — `onError` callback on PDF mutation shows alert
- [x] **Browser compatibility warning** — banner shown on page load; text input fallback shown for non-Chrome/Safari

---

## P1 — Core product promise (quote accuracy)

- [x] **Onboarding: trader sets labour hours per job** — covered by onboarding wizard (step 2)
- [x] **Add minimum charge to rate card** — prevents embarrassingly low quotes on short jobs (e.g. 15-min callout quoting £12 labour)
- [x] **Extract-then-confirm on dictate page** — after AI extraction, show trader a summary card (job, property, urgency, customer) to confirm or correct before pricing runs. Teaches traders what to include and catches misidentification before a wrong quote is created
- [x] **Property/urgency quick-tap chips on dictate page** — covered by the confirmation card: property and urgency shown as tap-to-select chips before pricing runs
- [x] **Customer WhatsApp: structured first response with gaps** — extracts fields from first message, replies with ✅/❓ summary. Quotes immediately if name + job captured; max 2 rounds before quoting with defaults
- [x] **Surface the calibration loop** — after hour corrections, shows green "Estimate updated to Xhrs" banner (calibrated) or blue "X/3 corrections logged" progress (in-progress)
- [x] **Material cost refresh prompt** — amber banner in Settings → Job Library when material costs haven't been reviewed in 90 days; auto-cleared when materials are saved, or manually via "Mark reviewed" button
- [x] **Travel distance input** — postcode lookup in confirmation card; computes Haversine distance via postcodes.io. Trader postcode stored in profile/onboarding.
- [x] **Extraction fallback defaults** — when AI cannot confidently extract a field, apply a trader-configured default rather than failing or guessing. Defaults set in Settings: property type (e.g. "House"), urgency (e.g. "Standard"), distance (e.g. 0). Shown as pre-filled values in the extract-then-confirm card so trader can override before the quote runs — no field is ever left blank silently
---

## P2 — Reliability and correctness

- [x] **Idempotency on Twilio webhook** — MessageSid checked against Redis SET NX (10-min TTL); duplicate requests get an empty TwiML response
- [x] **WhatsApp customer flow: restart command** — "start", "reset", "restart", "/start" keywords wipe the session and send a fresh greeting
- [x] **Enforce quota on generate endpoint** — server-side check on POST /generate, /confirm, and Twilio trader flow; returns 429 with plan/limit detail (trial=5, starter=50, pro=∞)
- [x] **Re-validate line item totals server-side** — PUT /:id/line-items already recomputes total=qty×unitPrice and all quote totals server-side; saveConfirmedQuote uses the pricing engine throughout
- [x] **Add index on `quotes.customer_whatsapp`** — idx_quotes_customer_whatsapp added to schema.sql
- [x] **Standardise Claude model** — all active services use claude-sonnet-4-6; whatsappSession delegates to quoteAI so it was always consistent; stale ai-extract.ts updated to match

---

## P3 — Other trades / growth

- [ ] **Seed job templates for Plumber** — second trade, highest demand; schema is already trade-aware
- [ ] **Seed job templates for Gas Engineer** — often same operator as plumber
- [ ] **Onboarding wizard** — walk new trader through: trade → key jobs → labour hours → materials → first test quote
- [ ] **Quote acceptance rate visible to trader** — basic dashboard metric: sent vs accepted this month
- [ ] **Email fallback for quote delivery** — WhatsApp-only locks out customers who prefer email

---

## P4 — Nice to have post-MVP

- [ ] Stripe subscription + payment links
- [ ] Quote versioning / edit history
- [ ] Logo upload on quotes and PDFs
- [ ] CSV export of quotes
- [ ] Bulk status updates
- [ ] Soft-delete / quote archival (currently hard delete)
- [ ] Multi-user / team accounts

---

## Schema / infra notes

- `schema.sql` and `migrations/001_initial.sql` are out of sync — clarify canonical migration path before adding users
- No monthly cron to reset `quotes_used_this_month` — needed for quota enforcement to be meaningful
- Session TTL (24h Redis) with no DB fallback — customer mid-conversation loses state if Redis restarts


