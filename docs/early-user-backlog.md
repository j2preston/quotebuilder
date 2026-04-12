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
- [ ] **Surface the calibration loop** — after corrections, show "Your average for EV charger is now 3.5hrs (updated from 4hrs)" so trader trusts it's learning
- [ ] **Material cost refresh prompt** — flag in settings when material costs haven't been reviewed in 90 days
- [ ] **Travel distance input** — travel rate per mile exists in the rate card but distance is AI-inferred from transcript; add an explicit distance field (or postcode lookup) on the dictate page so it is never guessed
- [ ] **Extraction fallback defaults** — when AI cannot confidently extract a field, apply a trader-configured default rather than failing or guessing. Defaults set in Settings: property type (e.g. "House"), urgency (e.g. "Standard"), distance (e.g. 0). Shown as pre-filled values in the extract-then-confirm card so trader can override before the quote runs — no field is ever left blank silently
---

## P2 — Reliability and correctness

- [ ] **Idempotency on Twilio webhook** — if Twilio retries a delivery, duplicate quotes are created
- [ ] **WhatsApp customer flow: restart command** — `/start` or `reset` keyword to clear a stuck session
- [ ] **Enforce quota on generate endpoint** — currently a UI-only check; the API will generate quotes regardless
- [ ] **Re-validate line item totals server-side** — totals are calculated client-side and trusted as-is
- [ ] **Add index on `quotes.customer_whatsapp`** — used in customer lookup on every inbound message
- [ ] **Standardise Claude model** — quoteAI uses `claude-sonnet-4-6`, whatsappSession uses `claude-opus-4-6`; pick one or document why they differ

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


