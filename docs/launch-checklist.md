# Launch checklist — sendquota.com

Production runbook for the test → live cutover. **Cutover completed 2026-07-25**;
the one step still unverified is the live transaction test at the bottom.

- **Host:** Vercel project `quota-prod` (org `woobin0413s-projects`), domain `sendquota.com`
- **Database (prod):** Supabase project `Quota`, ref `duxxnbkjbihwchywwkvh`, us-west-2
- **Database (preview):** Supabase project `Quota Preview`, ref `pflvjkpwdntstojikpsz`
- **Auth:** Auth0 tenant `dev-qrsz8wxxdzb26k8s.us.auth0.com`, app **Quota Prod** (`wM68uKn…`)
- **Email:** Resend, sending domain `sendquota.com`
- **Billing:** Stripe account `acct_1So9mA44C9HSIGvD` — **live mode**

## Environment split

Production and Preview hold **separate entries** for the vars below — same name,
one entry per environment. Anything not listed is a single shared entry.

| Variable | Production | Preview |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` |
| `STRIPE_PRICE_PRO` | live price | test price |
| `STRIPE_WEBHOOK_SECRET` | live endpoint secret | test endpoint secret |
| `NEXT_PUBLIC_SUPABASE_URL` | `duxxnbkjbihwchywwkvh` | `pflvjkpwdntstojikpsz` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod | preview |
| `SUPABASE_SERVICE_ROLE_KEY` | prod | preview |

Keep it that way. Sharing a Stripe key means branch deploys charge real cards;
sharing a Supabase key means branch code writes to customer data with a
service-role key that bypasses RLS.

`STRIPE_PRICE_ULTIMATE` is deliberately still shared and still test-mode —
Ultimate is gated by `UNAVAILABLE_TIERS`, and `change-plan` returns 400
`TIER_UNAVAILABLE` before the price is ever read. Create a live price for it
when Ultimate becomes purchasable.

> **Supabase CLI:** use `~/.local/share/supabase/supabase` for anything that
> connects to a database. The shim on `PATH` can't find its `supabase-go`
> companion and fails with "Could not find the `supabase-go` binary".

---

## Already done

Verified by probing the live deployment and the hosted services — not by reading
config, so these reflect what production actually does.

| # | Item | Evidence |
|---|---|---|
| 1 | Deployed and serving | `GET https://sendquota.com/` → 200 |
| 2 | Domain attached | `sendquota.com` is the production URL for `quota-prod` |
| 3 | Anon lockdown (migration 011) live | `verify-anon-lockdown.sh` → 12/12 tables 401, for **both** the legacy anon JWT and the new `sb_publishable_…` key |
| 4 | Migration 012 applied | PostgREST schema reports `subscription_tier` `required: true`, `default: "free"` |
| 5 | Migration history repaired | `20260725000000` was applied by hand via the SQL editor but missing from the remote ledger; `supabase migration repair --status applied` fixed it, so a future `db push` won't replay it |
| 6 | `ALLOW_DEV_TIER_SWITCH` **not** set in prod | Absent from `vercel env ls production` — the free-money hole is closed |
| 7 | `RESEND_MOCK` / `RESEND_TEST_REDIRECT` not set in prod | Absent from prod env; real sends go to real recipients |
| 8 | `CRON_SECRET` set | `POST /api/cron/reconcile-billing` with no auth → 401 (would be 500 if unset) |
| 9 | `STRIPE_WEBHOOK_SECRET` set | `POST /api/webhooks/stripe` unsigned → 400 `Missing signature` (would be `Webhook not configured` if unset) |
| 10 | `ADMIN_EMAILS` set | Present in prod env |
| 11 | Auth0 prod app wired to the real domain | Callbacks + logout + web origins cover `sendquota.com`, `www.sendquota.com`, and both Vercel hostnames |
| 12 | Prod uses the prod Auth0 app | `/auth/login` redirects with `client_id=wM68uKnGk9CaxWJxOhYzYr3eIf8pUcgg` (**Quota Prod**), not the localhost app |
| 13 | Resend domain verified | DKIM `resend._domainkey.sendquota.com` present; SPF `v=spf1 include:amazonses.com ~all`; bounce MX on `send.sendquota.com` |
| 14 | Daily reconcile cron declared | `vercel.json` → `/api/cron/reconcile-billing` at `0 9 * * *` |
| 15 | Stripe live products + prices created | Quota Pro $15/mo USD recurring, live mode |
| 16 | Live keys deployed | `sk_live_` / `pk_live_` / live `price_` / live `whsec_` on Production only; test values retained on Preview |
| 17 | Live Stripe webhook endpoint | `https://sendquota.com/api/webhooks/stripe`, subscription created/updated/deleted |
| 18 | Preview database isolated | `Quota Preview` (`pflvjkpwdntstojikpsz`), 13/13 migrations applied, `verify-anon-lockdown.sh` PASS |
| 19 | Test-mode billing state cleared | `e2e-test@sitequote.test` deleted from prod; remaining user reset to `free` with a null `stripe_customer_id` |

---

## Remaining — blocking

### A. The live transaction test — the only unproven step

Everything above confirms *configuration*. None of it proves the live key, live
price, and live webhook actually work together, and live mode has no test cards,
so this has to be a real charge.

1. Sign up a fresh account at `https://sendquota.com/signup`
2. Confirm it lands on Free, 3 quotes/month
3. Upgrade to Pro, enter a real card
4. **Watch the tier flip to Pro within a few seconds**
5. Send a quote by email; confirm it arrives from `sendquota.com`
6. Cancel, confirm `cancel_at_period_end` shows on `/billing`
7. Refund yourself in the Stripe dashboard

Step 4 is the assertion. `lib/stripe-webhook.ts` is the sole writer of
`subscription_tier`; if the charge succeeds but the tier stays Free, the webhook
secret is wrong — the endpoint's delivery log in Stripe will show 400s.

### B. Disable the test-mode webhook endpoint

A test-mode endpoint still points at `https://quota-prod.vercel.app/api/webhooks/stripe`.
Production now verifies against the **live** signing secret, so its events fail
verification and accumulate as failed deliveries; Stripe eventually auto-disables
endpoints that fail persistently.

Keep it until step A passes — it is the rollback path — then disable it.

### C. `RESEND_WEBHOOK_SECRET` is missing from production

```
POST https://sendquota.com/api/webhooks/resend  →  500 {"error":"Webhook not configured"}
```

The route fails closed, so nothing is exposed, and **setting the secret alone
buys almost nothing today**: `updateEmailStatus` in `lib/email-sender.ts` is a
stub (`// TODO: Update in database`), no `email_activity` table exists, and
`/api/send-quote` never persists Resend's `email_id` — so an incoming event
carries an ID that matches no row.

Worth building properly, as a feature rather than a config step:

1. Persist the Resend `email_id` at send time
2. Implement `updateEmailStatus` against it
3. Surface Delivered / Bounced on the quote page
4. Then create the webhook (Resend → Settings → Webhooks) and set the secret

Until then a contractor who typos a client's address sees "Sent" forever on an
invoice that hard-bounced — and email is a Pro-tier paid benefit.

### D. Auth hardening (2026-07-26)

> **ORDER MATTERS — read this before touching anything else in this section.**
> The `feat/auth-hardening` code enforces `email_verified` on every request.
> The tenant has had **no working email provider until now**, so every account
> created before this deploy — including the one production user (item 19) —
> almost certainly has `email_verified: false` in Auth0. If the code reaches
> production before the three items below are done, that user is locked out on
> their very next request, with no self-service way back in: the resend button
> itself depends on the same three things. **Steps 1–3 must be complete —
> provider, template, env — and step 4 (mark existing accounts verified) must
> be done before or in the same deploy as the code.** Do not deploy first and
> check these off after; by then the lockout has already happened.
>
> Order to follow:
> 1. Set `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` in production.
> 2. Point the Auth0 email provider at Resend SMTP.
> 3. Enable Branding → Email Templates → Verification Email.
> 4. Mark every pre-existing account `email_verified: true` (below).
> 5. Only then deploy/release `feat/auth-hardening` to production.

- [ ] `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` set in production
      (Vercel env), M2M scopes: `read:users`, `update:users`, `update:prompts`,
      `read:branding`, `update:branding`, `read:emails`, `update:emails`
- [ ] Auth0 email provider points at Resend SMTP
      (`node scripts/auth0-email-provider.mjs`)
- [ ] Branding → Email Templates → Verification Email is **Enabled**
- [ ] **Mark every account created before this deploy `email_verified: true`
      in Auth0**, done before or together with shipping the enforcement code.
      Blast radius is small — per item 19 in the table above, there is exactly
      one remaining production user — so this is a one-off fix, not new code:
      Auth0 Dashboard → User Management → Users → the account → Details tab →
      toggle **Email Verified** to `true`. (Equivalently, one Management API
      `PATCH /api/v2/users/{id}` call with `{"email_verified": true}`.)
- [ ] Verification email delivers to a non-owner address
- [ ] Duplicate signup shows the "account already exists" message, with reset
      reachable
- [ ] Allowed Logout URLs include the production origin
- [ ] Sign out → Back button does not re-render the dashboard
- [ ] `E2E_AUTH0_USER_EMAIL` is marked Email Verified in the tenant

---

## Remaining — non-blocking

Keep the private DMARC report mailbox and project configuration in `.env.local`
(see `.env.example`). Substitute `QUOTA_DMARC_REPORT_EMAIL` when entering the
DNS TXT record; DNS does not expand environment variables.

- **No DMARC record.** `_dmarc.sendquota.com` is empty. DKIM and SPF alone will
  deliver, but Gmail and Yahoo increasingly want a policy on bulk senders. Start
  in monitor mode: `TXT _dmarc.sendquota.com` → `v=DMARC1; p=none; rua=mailto:${QUOTA_DMARC_REPORT_EMAIL}`
- **Auth0 login screen shows the tenant hostname from `AUTH0_DOMAIN`.** Functional,
  but a custom domain (`auth.sendquota.com`) reads better on the login page.
  Paid Auth0 feature.
- **Dev and prod share one Auth0 tenant.** Any account created while testing can
  sign in to production. Fine at this size; revisit if you ever need a clean
  separation between test users and customers.
- **CI e2e job is inert.** `.github/workflows/ci.yml` skips the `e2e` job unless
  the `E2E_AUTH0_USER_EMAIL` secret exists. Add the repo secrets to switch it on:
  `E2E_AUTH0_USER_EMAIL`, `E2E_AUTH0_USER_PASSWORD`, `AUTH0_DOMAIN`,
  `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `STRIPE_SECRET_KEY`
  (test), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test).

---

## Smoke test

Re-run any time production is redeployed. All five passed on 2026-07-25.

```bash
# 1. Serving
curl -s -o /dev/null -w '%{http_code}\n' https://sendquota.com/            # 200

# 2. Stripe webhook configured — "Missing signature", NOT "Webhook not configured"
curl -s -X POST https://sendquota.com/api/webhooks/stripe -d '{}'          # 400

# 3. Cron guarded
curl -s -X POST https://sendquota.com/api/cron/reconcile-billing           # 401

# 4. Dev tier switch must stay dead
curl -s -X PATCH https://sendquota.com/api/subscription \
  -H 'content-type: application/json' -d '{"tier":"ultimate"}'             # 401

# 5. Anon lockdown holds on BOTH projects
# Export the QUOTA_* project URL/key variables from your private configuration first.
./scripts/verify-anon-lockdown.sh "$QUOTA_PRODUCTION_SUPABASE_URL" "$QUOTA_PRODUCTION_SUPABASE_ANON_KEY"
./scripts/verify-anon-lockdown.sh "$QUOTA_PREVIEW_SUPABASE_URL" "$QUOTA_PREVIEW_SUPABASE_ANON_KEY"
```

Expected today: `/api/webhooks/resend` returns **500** — that is section C, not a
regression. It becomes 401 once the secret is set.

Configuration checks only. The live payment path is proven by section A.
