# RFQClub

A two-sided RFQ (Request-for-Quotation) marketplace for Indian job-shop
manufacturers. Buyers post machining / foundry / sheet-metal requirements;
suppliers submit **total-landed-cost** bids that stay **blinded** (Bid A–E)
until the buyer awards one — at which point only the winner's identity is
revealed.

This repo turns the `design-concepts.html` prototype into a working product.

## Layout
```
rfqclub/
  api/   FastAPI + SQLAlchemy (SQLite) backend, Telegram ingestion bot, concierge review CLI
  web/   Next.js 15 + TypeScript + Tailwind front-end (board / detail / bid / how-it-works)
```

## Backend (`api/`)
```bash
cd rfqclub/api
pip install -r requirements.txt
cp config.env.example config.env      # optional: only needed for bot / LLM-assist
python seed_rfqs.py --demo-bids       # load the 67-row RFQ Demand sheet + demo bids
uvicorn main:app --reload --port 8000 # http://localhost:8000/docs
python test_smoke.py                  # end-to-end API checks
python review.py list                 # concierge human-gate for captured drafts
```

Key endpoints:
- `GET /api/rfqs` — board (filter `sector`, `q`, `sort=deadline|value|bidcount`)
- `GET /api/rfqs/{id}` — detail
- `GET /api/rfqs/{id}/bids` — **blinded** comparison (identity hidden until award)
- `POST /api/rfqs/{id}/bid` — supplier landed-cost bid (server recomputes TLC, enforces routing cap)
- `POST /api/rfqs/{id}/award` — award a bid; reveals the winner's name
- `POST /api/rfqs/{id}/save` — toggle the watchlist flag (per-user when signed in)
- `POST /api/auth/register` · `POST /api/auth/login` — email + password (PBKDF2-SHA256, stdlib `security.py`)
- `POST /api/auth/forgot` · `POST /api/auth/reset` — password recovery (single-use expiring token, emailed as a `/login?reset=` link)
- `POST /api/auth/password` — change (or, for a Google/OTP-only account, set) the signed-in user's password
- `POST /api/auth/google` — "Continue with Google" (Google Identity Services ID token, verified against `GOOGLE_CLIENT_ID`)
- `POST /api/auth/otp/request` · `POST /api/auth/otp/verify` — email-OTP sign-in (stateless HMAC bearer token)
- `GET /api/auth/me` · `GET /api/auth/my/rfqs` · `GET /api/auth/my/bids` — session + per-user lists

### Auth model
Every method issues the **same stateless HMAC-SHA256 bearer token**
(`email|role|exp`). Because the web (Vercel) and API (Render) are different
sites, we send the token as an `Authorization: Bearer` header (not a cookie), so
the CORS allowlist — see `CORS_ORIGIN_REGEX` in `api/config.py` — governs which
browser origins may mutate. Three ways in:

- **Email + password** — hashed with stdlib PBKDF2-HMAC-SHA256 (`api/security.py`),
  no extra dependency; registration sets `password_hash` on the `user` row.
  Recovery issues a single-use, expiring reset token (`/auth/forgot` → `/auth/reset`)
  and emails a `/login?reset=<token>` link that the page follows automatically.
- **Continue with Google** — the browser hands back a Google ID token which the
  API validates via Google's `tokeninfo` endpoint (audience must equal
  `GOOGLE_CLIENT_ID`); the account is created or linked by email. Hidden in the
  UI until `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set.
- **Email-OTP** — a 6-digit code, emailed when a mail provider is configured and
  shown on-screen (`dev_code`) otherwise, so the flow — and the one-click demo
  Buyer/Supplier — keeps working without a mailer.

**Email delivery** (`api/mailer.py`) is provider-optional and adds no dependency:
**Resend** (HTTP via `httpx`) when `RESEND_API_KEY` is set, else **SMTP** (stdlib
`smtplib`, STARTTLS or implicit TLS) when `SMTP_HOST` is set, else nothing is sent.
`EMAIL_MODE` picks `auto` (default) / `dev` / `resend` / `smtp`. When there is no
provider — or a send fails — and `OTP_MODE=dev`, the code/token is returned in the
API response with a `delivery_warning` so the demo never dead-ends; with `OTP_MODE`
set to anything else the endpoint answers `503` instead of pretending an email went
out. Responses carry `delivery: "email"` once a message is actually queued.

New `user` columns are added on startup by an idempotent migration in `api/db.py`
(`_ensure_user_columns`): `name`, `password_hash`, `google_id`, `last_login`, and
the short-lived secrets `otp_hash`/`otp_expires_at` + `reset_hash`/`reset_expires_at`.
Those are stored as keyed digests (never plaintext) and live on the row, so a
pending code or reset link survives a server restart and works across instances;
existing OTP-only users keep working and simply have no password until they set one.
A `last_login` timestamp is stamped on every successful sign-in (login, Google, OTP,
register, reset) and surfaced in the account-security dialog.

**Abuse protection:** the sensitive auth endpoints (`login`, `register`, `forgot`,
`reset`, `otp/*`, `password`) share a small in-process sliding-window rate limiter
(`api/auth.py` `_throttle`), keyed by email and client IP (from `X-Forwarded-For`),
returning `429` with a wait hint. It's in-memory because Render runs one free-tier
process; move it to Redis before scaling horizontally.

Ingestion is human-gated: the Telegram bot (`ingest_bot.py`) parses messy text
with `rfq_parser.py` (+ optional `llm_structurer.py`) into `pending_draft`
rows; an operator publishes them with `review.py approve`. Nothing unreviewed
reaches the board.

## Frontend (`web/`)
```bash
cd rfqclub/web
npm install
cp .env.local.example .env.local      # points at the API base URL
npm run dev                           # http://localhost:3000
```

## Design system
Tokens, fonts (Fraunces / Hanken Grotesk / JetBrains Mono), the 7-sector colour
palette, a global light/dark theme (`next-themes`) and a Cmd-K command palette
are ported from `design-concepts.html`.

## Deployment (live)
| Layer | Where | Notes |
| --- | --- | --- |
| Web (Next.js) | `https://rfqclub-web.vercel.app` | Vercel project `swaniki/rfqclub-web`. Build env `NEXT_PUBLIC_API_BASE` points at the API. |
| API (FastAPI) | `https://rfqclub-api.onrender.com` | Render web service from this repo's `api/` (blueprint: `api/render.yaml`). |
| Database | Neon Postgres | Provisioned via the **Vercel Neon integration**; seeded on first boot. |

- The API auto-seeds the board on startup when the RFQ table is empty
  (`bootstrap.ensure_seeded` reads the committed `api/seed_data/rfqs.json`
  snapshot, so no workbook is needed in the deploy). `POST /api/admin/seed`
  re-runs it and is guarded by `AUTH_SECRET`.
- Required Render env: `DATABASE_URL` (Neon pooled URL — `postgresql://` is
  normalised to the `psycopg3` driver in `api/db.py`), `AUTH_SECRET` (token
  signing key), and optionally `OTP_MODE=dev`. For Google sign-in set
  `GOOGLE_CLIENT_ID` (API) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel build env,
  same value); leave both unset to hide the Google button.
- Google OAuth: one **Web application** Client ID with Authorized JavaScript
  origins `https://rfqclub-web.vercel.app` and `http://localhost:3000` (no
  redirect URI needed for the ID-token popup flow).
- To email codes and reset links for real, add two dashboard-only env vars on
  Render: `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `RFQClub <no-reply@yourdomain.com>`;
  Resend requires a **verified domain** for addresses outside `onboarding@resend.dev`,
  which only ever delivers to your own Resend account). Alternatively set
  `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_SECURITY`.
  `WEB_BASE_URL` (committed) is the origin used to build reset links.
- Set `DATABASE_URL` to empty/omit it to fall back to local SQLite.

## License
Proprietary — **All rights reserved**. See [LICENSE](LICENSE). The code is not
open-source; use, modification or redistribution requires prior written
permission from Swaniki. See [CHANGELOG.md](CHANGELOG.md) for release history.
