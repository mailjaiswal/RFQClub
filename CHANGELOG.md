# Changelog

All notable changes to **RFQClub** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches `1.0.0`. Entries are grouped by the development phase that shipped them.

## [Unreleased]

### Added
- **Concierge review workflow — the human gate in front of the board**
  (`api/workflow.py`). A single service is shared by the `review.py` CLI and new
  operator HTTP endpoints (`/api/operator/queue`, `/api/operator/drafts/{id}/approve`,
  `/reject`, `/api/operator/rfqs/{id}/status`), so the two can never drift apart.
  It converges the two kinds of work-in-progress — Telegram/web `pending_draft`
  intake and unpublished `rfq` rows — into one queue, lets an operator correct any
  field while approving, makes **publishing an explicit action**, refuses duplicate
  titles unless forced, freezes awarded RFQs, and records who reviewed each draft
  (new `pending_draft` columns `user_id`/`source`/`reviewed_by`/`reject_reason`,
  added by the same idempotent startup migration).
- **Web "Post an RFQ" form** at `/post` (`POST /api/rfqs/intake`) — the intake path
  the how-it-works page already advertised but that never existed. It files a review
  draft (never a live board row), asks the buyer to clarify what's missing, and
  surfaces status under **My RFQs → In concierge review** (`GET /api/auth/my/submissions`).
- A concierge **review queue** UI at `/review` (approve & publish / approve as draft /
  reject with reason / publish · close unpublished RFQs), operator-gated navigation in
  the app rail, and a **Concierge / staff** role claim on the login screen.
- **Buyer clarify loop** (`api/draft_util.py`, `workflow.answer_clarifications`). The
  intake's missing-field prompts are now *structured* (`{key, question}`) and
  **derived** — a question is open for exactly as long as its field is blank, so a
  buyer answer (or a concierge edit) resolves it with no separate flag to keep in
  sync. Numeric answers reuse the regex parser ("1200 pcs", "₹8–15 Lakh"). New
  owner-only endpoints `GET /api/rfqs/intake/{id}` and
  `POST /api/rfqs/intake/{id}/clarify` back a `/draft/{id}` "add the missing details"
  page; captured answers (and who gave them) now appear on each card in the
  concierge queue.
- **Authorization hardening:** the unblinded supplier-name endpoint
  (`GET /api/admin/rfqs/{id}/bids`) is now **operator-only** (it was public), the
  `operator` role can only be claimed by an email listed in `OPERATOR_EMAILS`
  (empty allowlist keeps the demo self-service), and `require_operator` guards every
  concierge action.
- **Real email delivery** for sign-in codes and password-reset links
  (`api/mailer.py`). **Resend** over HTTPS (`httpx`, already a dependency) when
  `RESEND_API_KEY` is set, otherwise **SMTP** via stdlib `smtplib` (STARTTLS or
  implicit TLS) when `SMTP_HOST` is set; `EMAIL_MODE` forces `auto`/`dev`/`resend`/
  `smtp`. Branded HTML+plain-text templates are sent for both the 6-digit code and
  the single-use `/login?reset=<token>` link, which the login page now opens
  directly from the query string. Delivery is still **optional**: with no provider
  configured — or if a send fails — `OTP_MODE=dev` keeps surfacing the secret
  on-screen (now with a `delivery_warning`) so the demo never dead-ends, while any
  other mode returns `503` rather than claiming an email was sent; successful sends
  report `delivery: "email"`.
- OTP codes and reset tokens are now **persisted on the `user` row** as keyed
  digests (`otp_hash`/`otp_expires_at`, `reset_hash`/`reset_expires_at`, added by
  the idempotent startup migration) instead of process memory, so a pending code or
  reset link survives a Render restart and works across instances. Issuing a new
  reset link supersedes the previous one; both remain strictly single-use.
- **Account & auth hardening:** in-process sliding-window **rate limiting** on the
  sensitive auth endpoints (`login`, `register`, `forgot`, `reset`, `otp/*`,
  `password`) keyed by email + client IP, returning `429` with a wait hint; a
  `last_login` timestamp stamped on every successful sign-in; and a **change / set
  password** endpoint (`POST /api/auth/password`) surfaced in a new in-app
  **Account security** dialog (opened from the app rail) that also shows the
  signed-in email, role, member-since and last-sign-in. Google/OTP-only accounts
  can set a first password without a current one.
- Password recovery: **Forgot password / Reset** flow. `POST /api/auth/forgot`
  issues a single-use, expiring reset token (delivered on-screen in `OTP_MODE=dev`
  as `dev_reset_token`, mirroring the OTP mock delivery); `POST /api/auth/reset`
  consumes it, sets a new PBKDF2-hashed password, and signs the user straight in.
  The login screen gained _Forgot password?_ → _Send reset link_ → _Choose a new
  password_ steps.

## [0.1.0] — deployed product (phases P1–P11)

### Added
- **P1** — FastAPI + SQLAlchemy backend: RFQ board, blinded total-landed-cost
  bids (server-side TLC recompute, routing cap), award, watchlist, Telegram
  ingestion with human-gated concierge review; Next.js board / detail / bid /
  how-it-works pages.
- **P2** — App shell (left rail + ledger board), product tour, Cmd-K command
  palette, rich RFQ tags, rebuilt how-it-works demo, tabbed My Profile.
- **P3** — Card-based board with list toggle, Compare Bids and My RFQs buyer
  screens, per-RFQ demo bids.
- **P4** — Working award flow on Compare Bids (confirm modal, winner reveal,
  change-award); awarded ripple to detail/bid/My-RFQs pages; API blocks
  post-award bids.
- **P5** — Email-OTP demo auth (mock delivery) with stateless HMAC bearer tokens
  and per-user persistence of saved items, posted RFQs and bids.
- **P6** — Deployment prep: psycopg Postgres drivers, portable JSON seed
  snapshot with first-boot auto-seed, guarded admin seed endpoint, Render
  blueprint (`render.yaml`).
- **P9** — Splash screen (scene-machine intro, auto-dismiss to landing) and
  one-click demo Buyer / Supplier login.
- **P10** — Public animated **landing page** at `/` explaining what RFQClub is
  and how it works; the RFQ **board is gated behind login** at `/board` via Next
  middleware (unauthenticated visitors are redirected to `/login`).
- **P11** — Sign-in expanded with **email + password** (register / login, stdlib
  PBKDF2-HMAC-SHA256 — no extra dependency) and **Continue with Google** (Google
  Identity Services ID-token, verified via Google's `tokeninfo` against
  `GOOGLE_CLIENT_ID`). The original OTP / demo paths are kept. New `user`
  columns (`name`, `password_hash`, `google_id`) are added by an idempotent
  startup migration so existing OTP-only accounts keep working.

### Changed
- **P7** — Fixed Postgres portability bugs found against live Neon:
  `Bid.tlc_cents` widened to `BigInteger` (cents overflowed 32-bit int), reset
  the RFQ identity sequence after explicit-id seeding, and child-first delete
  order in the seed to satisfy FK constraints.
- **P8** — Browser mutations from Vercel / Render / localhost origins allowed via
  `CORS_ORIGIN_REGEX`, so cross-site auth / bid / award work without per-host
  env edits (bearer tokens, no credentials).

### Deployed
- Web (Next.js) → `https://rfqclub-web.vercel.app`
- API (FastAPI) → `https://rfqclub-api.onrender.com`
- Database → Neon Postgres

[Unreleased]: https://github.com/mailjaiswal/RFQClub/compare/0.1.0...HEAD
