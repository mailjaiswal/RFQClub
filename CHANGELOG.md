# Changelog

All notable changes to **RFQClub** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches `1.0.0`. Entries are grouped by the development phase that shipped them.

## [Unreleased]

### Performance
- **Console navigation is now cache-first (stale-while-revalidate).** Added
  `web/src/lib/cache.ts`, a small SWR store shared by the console screens. Queue
  pages, the lead record, the dashboard/rail counters, the team roster and reports
  now paint instantly from the last response while a background revalidate brings
  them up to date, instead of blanking and waiting on a 1-2s hosted round-trip
  every time a screen mounts. `meta` is additionally mirrored into sessionStorage
  so a reload renders before the API answers.
- **A lead opens the moment you click it.** Hovering a queue row warms both the
  Next.js route payload and the lead's own API record (debounced 150 ms so
  sweeping the pointer down 100 rows can't bury the free-tier API), and a cold
  deep link still renders the header at once from the row snapshot the queue
  already has.
- **Changes no longer block the next action.** Stage changes, claims/reassignment,
  next-step scheduling and logged touchpoints/tasks write their outcome straight
  into the cache (detail *and* every cached queue row) before the request is sent,
  so the screen is already correct when you navigate to the dashboard, All leads
  or anywhere else; the server confirmation revalidates behind that.
- **Per-request DB connection churn fixed.** `pool_recycle` was 20s on the hosted
  Postgres, which meant nearly every console click rebuilt a Neon connection
  (TCP + TLS + auth, ~0.5-1s). Recycling is now a patient 1800s with a real pool
  (`pool_size=5`, `max_overflow=10`), while `pool_pre_ping` still retires dead
  handles (`api/db.py`).
- **Payloads and queries trimmed.** `GZipMiddleware` added (a 100-row queue page
  ships at roughly a fifth of 43KB); `GET /api/sales/leads/{id}` batch-eager-loads
  company → contacts and owner instead of paying four extra round-trips, and caps
  the activity feed at 200 rows; console search now debounces 300ms instead of
  issuing a queue request per keystroke.

### Added
- **Explicit save for the lead next step.** Editing *Next action* / *Note* on a
  lead no longer relies on a hidden auto-save: a sticky save bar appears at the
  bottom of the record whenever the next step differs from what is stored, with
  **Save changes** (also `Ctrl`/`⌘ + S`), **Discard**, and a "Saved ✓" flash that
  confirms the write. The bar explains that stage, touchpoints and follow-ups
  still commit on their own, so nothing looks like it is waiting when it isn't
  (`leads/[id]/page.tsx`, `internal.css`).
- **Clock-style date + time picker.** Replaced the bare `datetime-local` inputs
  with `ClockPicker.tsx` — a `DateTimeField` popover with an hour/minute dial
  (tap the hour, then the minute), day chips (Today / Tomorrow / In 2 days /
  In 3 days / Next week) plus ◀ ▶ arrows and a calendar input, an AM/PM toggle,
  ±1 / ±5 / ±15 minute fine-stepping, quick times (9am, 10am, 1pm, 5pm, 6pm) and
  Clear/Set. Used by the next-step editor, the touchpoint form and the follow-up
  task form.
- **More quick actions on the lead page.** The Quick row now offers nine
  clock-derived slots computed from the current time (later today, tomorrow
  morning/afternoon, this weekday at 10am, +2/+3/+5 days, next week, plus
  *In 3 hours*) with labels that adapt ("Today 5pm", "Tmrw 10am", "Fri 2pm"), and
  a second **Log result** row of one-tap presets (No answer, Voicemail, Busy,
  Wrong number, WhatsApp sent, Email sent, Connected, Meeting booked, Not
  interested) that write a touchpoint *and* schedule the sensible follow-up in a
  single click. Presets are filtered against the server's `activity_kinds` /
  `activity_outcomes` vocabularies so nothing invalid can be sent.
- **Server-issued capabilities for console access.** `/api/sales/meta` now
  returns `capabilities: {email, manager, owner, impersonating}`, computed
  *after* act-as resolution, and the navigation drives off it instead of
  re-guessing roles from `/me`. Falls back to the old role check if the field is
  absent, so cached payloads can't break the shell (`sales_api.py`,
  `sales-api.ts`, `ConsoleApp.tsx`).
- **Activity Reports tab.** New `/console/reports` page with a configurable date
  range (Today / Last 7 days / This week / This month / Last 30 days / custom)
  showing: summary tiles (activities logged, unique leads contacted, status
  changes, tasks completed), bar charts for activity type and status-transition
  breakdown, current pipeline snapshot, and — for managers — a per-rep team
  table. Backed by `GET /api/sales/reports?from=&to=&owner_email=`
  (`sales_api.py`, `reports/page.tsx`, `ConsoleApp.tsx`).
- **Owner-only "View As" impersonation.** A top-bar dropdown (visible only to
  the `CONSOLE_ADMIN_EMAILS` owner, NOT to regular managers) lets the owner browse
  the console exactly as a specific rep sees it — their queue, summary, lead
  detail, and reports. Propagates via `X-Act-As` header to all `/api/sales/*`
  read endpoints; a prominent banner confirms impersonation with a one-click exit.
  Write endpoints are unaffected (rep view is read-only by scoping).
- **Sortable queue headers + more filters.** Every column header on the lead
  queue (`Company`, `Hub`, `Status`, `Owner`, `Next action`, `Last touch`) is now
  a sorter (click to sort, click again to flip direction); `GET /api/sales/leads`
  gained `dir` (asc/desc) and the sort keys `hub_city`, `category`, `owner`,
  `contacted`. The filter bar adds a **Category** dropdown (fed by a new
  `categories` list in `/api/sales/meta`) and, for managers, an **Assigned to**
  owner dropdown (incl. *Unassigned only*). All sort/filter state lives in the
  URL so a view is shareable and back-button stable.
- **Lead-detail quick-action toolbar.** A one-tap **Quick** row above the columns
  schedules the next step instantly (Today 5pm / Tomorrow AM / +3 days / +7 days,
  plus Clear) without touching the date picker.

### Fixed
- **Research passes marked rows "DROP" and nothing happened.** Every enrichment
  batch since the first pass has occasionally written a `DROP - ...` verdict for
  rows that are real, Indian and registry-alive but are not a business a rep can
  win — a pre-operational project vehicle, a property developer filed under a CNC
  machining NIC, a shell whose director is barred under s.164(2)(a), a permanently
  closed listing. Those words only ever reached the free-text `Data Source`
  column, so the row stayed `Valid Lead` and kept its place in the calling queue.
  `lead_models.map_source_status()` now recognises an `Out of scope - <reason>`
  prefix (matched by prefix like `Dead - ...`, because the reason differs every
  time) and hides the lead from sales *without* disqualifying it, so a human can
  still read the reason and reverse it; `apply_exp_enrichment.py` writes the
  status from a batch's `out_of_scope` key, guarded so it can only replace
  `Valid Lead`/blank and never overwrite or resurrect a `Dead - ...` row.
  Scope rule held throughout: a row is hidden only when research proved it is not
  an operational industrial unit — never merely because its sector is unfashionable.
- **Registry-dead companies were landing in the rep queue.** The lead importer
  mapped the workbook `Lead Status` through an exact-key dict, so the batches'
  `Dead - Strike Off` / `Dead - Amalgamated` / `Dead - Under Liquidation` /
  `Dead - Dissolved` / `Dead - CIRP` values fell through to the default and were
  created as fresh, unhidden `uncontacted` leads — 472 of them after the latest
  harvest. Mapping now goes through `lead_models.map_source_status()`, which
  recognises the `dead` prefix, hides the row from sales *and* disqualifies it
  (the two states keep their own columns), and `import_leads.upsert_lead()`
  re-reads existing leads against it so already-imported dead rows get tightened
  in the same pass (never widened, and never touching a lead a rep has worked).
  `api/lead_models.py`, `api/import_leads.py`.
- **A category re-tag duplicated the lead instead of moving it.** `Lead.track`
  derives from `category.default_track` under `UNIQUE(company_id, track)`, so when
  a harvest corrected a company's category the importer tried to create a *second*
  lead on the new track while the stale old-track row stayed in the queue — the
  same company appeared twice, and the wrong one carried the rep's history.
  `import_leads.py` now retargets the existing lead (track, category and
  `status` recomputed) and prunes any leftover un-worked duplicate of the same
  company, reporting `leads_retargeted` / `duplicate rows cut` / `track conflicts`
  so a collision with real rep work is visible rather than silently overwritten.
- **A stale legacy category could veto a researched match.** `rfq_categories.classify()`
  used the workbook's legacy vertical as a prior, but the prior was only honoured
  when its *exact* label was already a category key, so rows filed under free-text
  variants (`"Foundry and Casting"`, `"Metal Sheet Work"`, `"CNC Job Work"`) fell
  through and the name/address signal decided alone — which is how a fastener-NIC
  row ended up tagged as CNC job work. Aliases now resolve through the same
  legacy-prior path as canonical labels, and the auto-alias is recorded in
  `Category Rationale` so the decision is traceable.
- **Sales reps could see the manager-only "Team & access" tab.** The rail's
  Manager section and `/console/team` were gated on a *client-side* role guess
  derived from `/me`, which drifted from the server's own scoping — most
  reliably while the owner was impersonating a rep (the chrome stayed
  owner-flavoured) and for any cached `meta` that crossed scopes. The gate now
  comes from the server's `capabilities.manager`, which is `false` for reps and
  for a rep being viewed as, and every `meta` cache key is scope-tagged so an
  impersonated payload can never paint owner navigation. The owner's "View As"
  dropdown still works because the team roster fetch keys off the *real* human
  role rather than the impersonated view.
- **Stale "View As" target locked the console with a 404.** An expired or
  removed impersonation target in `localStorage` made every request fail.
  `req()` now detects `404 Cannot impersonate…`, clears the saved scope and
  reloads once into the viewer's own console.
- **"All leads" tab was empty for the console owner.** The queue's `is_manager`
  scope derived purely from `role == "sales_manager"`, but the site owner's
  allowlisted account (`CONSOLE_ADMIN_EMAILS`) keeps a *marketplace* role (e.g.
  `operator`) — so in production they fell into the rep-only branch that filters
  `view=all` to `owner_id == self` (empty, since leads belong to reps). Added a
  `_is_manager()` helper that mirrors `auth.require_sales_manager` (role **or**
  allowlist) and routed the four scope checks (queue scoping, excluded leak-guard,
  assign, summary leaderboard) through it, so the owner's console access behaves
  identically in local SQLite and hosted Postgres.
- **All `/api/sales/leads` requests returned 422 (no data in any queue tab).**
  Pydantic v2.13 validates default values against `pattern` constraints. The
  `dir` param defaulted to `""` but carried `pattern="^(asc|desc)$"`, which `""`
  fails — every GET to the queue endpoint was rejected before reaching the DB.
  Removed the unnecessary pattern guard from `dir` (the ordering logic already
  treats any non-`"desc"` value as ascending).

### Performance
- **Killed the queue N+1.** `list_leads` now eager-loads each row's `company`,
  the company's `contacts`, and the `owner` via `selectinload`, turning a
  100-row page from ~300 lazy per-row round-trips into ~3 batched queries. On
  hosted Neon (where every round-trip has real latency) this is the dominant
  page-load fix.

### Added
- **Cross-linked dashboard drill-down.** Every summary tile on `/console` is now
  a link into the exact queue behind its number, and leaderboard rows link to a
  rep's book. The queue accepts three new filters (`status` was joined by
  `contacted`, `callable`, `owner_email`) and shows removable *"Drilling into…"*
  chips for the active slice. `GET /api/sales/leads` gained `contacted` /
  `callable` flags mirroring the summary's `callable_now` definition so a box and
  the list it opens always agree (`api/sales_api.py`, `sales-api.ts`,
  `console/page.tsx`, `console/leads/page.tsx`).

### Changed
- **Console visual pass (Duotone Soft).** Dashboard/funnel boxes gained the soft
  tinted "corner blob", a per-metric icon chip, centered numbers, and a
  GPU-safe staggered entry + hover lift (all under `prefers-reduced-motion`).
- **Contact detail page restructure.** The "Next step" box is pinned to the top
  of the left column (it no longer falls off the page) and the read-only Company
  block is compacted from a tall key/value list into a tight two-column grid
  (`internal.css`, `console/leads/[id]/page.tsx`).

### Added
- **Admin-managed console access (Team & access).** The inside-sales area moved
  from `/internal` to a readable **`/console`** path and its membership model
  switched from an env allowlist to **100% DB-managed**: only accounts an admin
  creates in the console can sign in. A first manager is seeded on startup from
  `SALES_ADMIN_EMAIL` / `SALES_ADMIN_PASSWORD` (`api/config.py`,
  `bootstrap.ensure_sales_admin()`), flagged `must_change_password` so they must
  rotate the starter password on first entry. `require_sales` now gates purely on
  the DB role + `is_active` + `must_change_password` (409 while still on a temp
  password) and no longer reads `SALES_EMAILS`; the public `POST /api/auth/role`
  refuses to hand out `sales`/`sales_manager`, so a role can never be
  self-claimed. Two new `User` columns (`must_change_password`, `is_active`) are
  added idempotently (`api/db.py`). Manager-only Team endpoints
  (`GET /api/sales/team`, `POST /team/user`, `/team/password`, `/team/status`,
  `/team/role` in `api/sales_api.py`) create users, reset passwords, change roles
  and deactivate/restore access (deactivating releases the member's leads to the
  pool; you can't deactivate yourself or strand the last active manager).
  On the web side the gate (`ConsoleApp.tsx`) drops the old role self-claim
  buttons for a "not a member" screen, adds a forced first-login password-change
  screen, and a **Team & access** panel at `/console/team` (`sales-api.ts` team
  client). Per the product rule, **every password create/change routes through a
  confirmation popup before it is committed** (`ConfirmPopup` reused by the
  panel and the first-login screen). Client: `web/src/app/(console)/console/team/`,
  renamed `(internal)→(console)` route group + `components/internal→console`,
  `middleware.ts` matcher, `api.ts` `AuthUser` fields.
- **Console owner allowlist (`CONSOLE_ADMIN_EMAILS`).** The seeded admin's email
  already existed on the hosted marketplace as a Google/OTP `operator` account,
  and a `User` carries only one `role` — so gating the console on `role` alone
  would have forced the owner to surrender the concierge desk. A new
  `CONSOLE_ADMIN_EMAILS` allowlist (`api/config.py`, defaults to
  `SALES_ADMIN_EMAIL`) grants console/manager access **independent of role**,
  checked alongside the role in `require_sales` / `require_sales_manager` and
  surfaced as `is_console_admin` on `/api/auth/me` and the team rows. An
  allowlisted owner can hold `operator` and run the console at once;
  `ensure_sales_admin` now only *adds* a starter password to such a pre-existing
  row (never touching its role) when it has none. Their role/status are frozen in
  the Team panel (shown as an **Owner** badge) so a manager can't accidentally
  demote or lock out the owner.
- **Inside-sales "internal" workspace — a second, gated side of the app for the
  inside-sales team.** The enriched BnS + Expansion lead book (already modelled
  in `api/lead_models.py`, previously with no API/UI) is now a fully workable CRM
  reachable only at `/internal`, sharing no chrome with the buyer/supplier
  board. Defence-in-depth access: two new roles (`sales`, `sales_manager`) that
  can only be claimed by an address on the **fail-closed** `SALES_EMAILS` /
  `SALES_MANAGER_EMAILS` allowlist (`api/config.py`), an empty allowlist denies
  everyone; a new `/api/sales` router guarded at the router level by
  `require_sales` (a normal buyer/supplier token 403s on every call), and the
  Next.js middleware + client gate keep the area out of the public build.
  Reps work queues (My / Unclaimed / Follow-ups / All / Out-of-scope), advance a
  6-stage status ladder (Not contacted → Potential → In conversation →
  Onboarding → Onboarded) with Declined / On-hold / Dead exits, log every
  touchpoint (kind, outcome, notes, pain-point, objection, competitor), set a
  next-action date + note, file follow-up tasks, and claim / release a lead so
  every contact carries an owner name; managers additionally get the team
  leaderboard, cross-rep assignment and a UTF-8-BOM CSV export. New files:
  `api/sales_api.py`, `web/src/lib/sales-api.ts`, `web/src/components/internal/*`,
  `web/src/app/(internal)/**`, `web/src/styles/internal.css`; wired in
  `api/main.py`, `api/auth.py`, `api/schemas.py`, `web/src/middleware.ts`.
- **Concierge Order-Ops desk on `/review`.** A new `OrderOps` section renders one
  `OpsCard` per awarded RFQ (`GET /api/rfqs?status=awarded`): escrow state,
  managed-QC state and each payment milestone are advanced via dropdowns that
  call the operator-only `POST /api/operator/rfqs/{id}/order` (same validated
  state vocabulary the API enforces server-side), with optimistic local updates
  and per-card error banners. Mirrors the buyer-facing `OrderTracker` but with
  the controls; hidden entirely when nothing is awarded yet
  (`web/src/components/OrderOps.tsx`, `OrderUpdate`/`updateRfqOrder` in
  `web/src/lib/api.ts`, mounted in `ReviewClient.tsx`).

### Changed
- **Board now shows real bids-received, not a flat cap.** Previously every seeded
  RFQ displayed the same "5 bids" because the demo-bid step clamped `bid_count`
  to the 5-shop routing cap and the board used that single number. The board now
  advertises the **true bids-received** figure (recovered per-RFQ from the source
  workbook's `Bids` column, e.g. 36–41) via a new `Rfq.demand_bids` column, while
  the compare screen keeps revealing only the **top ≤5 blinded quotes**
  (`bid_count`). Cards render "N bids · top M quoted", the detail/compare pages
  note the cap, and the "Most bids" sort uses the received figure. `demand_bids`
  is added idempotently (`db._ensure_rfq_columns`) and non-destructively
  backfilled on an already-seeded DB (`bootstrap` → `seed_rfqs.sync_demand_bids`).
- **Guest "Saved" bookmarks are now private to the browser.** The board toggle
  previously flipped a single shared `rfq.saved` flag on the server, so one guest
  saving an RFQ marked it saved for *every* visitor. Guests now keep their
  watchlist in `localStorage` (`web/src/lib/guestSaved.ts`); the API no longer
  reads or writes any global flag — `_card` returns `saved=false` for anonymous
  visitors and `POST /api/rfqs/{id}/save` is a no-op for guests (signed-in users
  still use the per-user `SaveItem` table, which was already private).
- **Google sign-in opted into FedCM.** `accounts.id.initialize` now passes
  `use_fedcm_for_button: true` so the button keeps working once Google makes
  FedCM mandatory and the GSI "displayMoment / skippedMoment" deprecation
  warning is cleared from the console (`LoginPage.tsx`).

### Fixed
- **`/login` crash — "Application error: a client-side exception has occurred."**
  The Google Identity Services (GSI) button was injected into the **same DOM node
  React also owned children of** (`googleBtnRef` held the `!googleReady` loading
  `<span>`). When GSI cleared the node (`node.innerHTML = ""`) and rendered its
  iframe, React later tried to remove its own span — which was no longer a child —
  and threw `NotFoundError: Failed to execute 'removeChild'` during the commit
  phase, blanking the whole page (`LoginPage.tsx`). The GSI button now mounts into
  an imperative host div inside a node React renders **empty** (the loading
  fallback moved to a sibling), and the `renderButton` call is wrapped in try/catch.
  Reproduced and verified against the live deploy with headless Chrome (`/login`
  now renders the app with zero page errors). Also hardened `AppShell`'s avatar so a
  missing/empty stored `rc_user.email` can never throw on the signed-in path.

### Added
- **Post-award trust tracking (escrow · managed QC · milestones).** The
  "Live at launch" promises on How-it-works are now real state, not copy. A new
  set of columns on the `award` row (`escrow_status`, `qc_status`, `milestones`
  JSON, `order_updated_at`, added idempotently via `db._ensure_award_columns`)
  is seeded with the four canonical delivery milestones when an RFQ is awarded.
  Two endpoints drive it: `GET /api/rfqs/{id}/order` (buyer, signed-in) returns
  the escrow/QC/milestone state plus the now-revealed supplier, and
  `POST /api/operator/rfqs/{id}/order` (concierge only) advances escrow, QC and
  any single milestone with strict state validation. A buyer-side
  `OrderTracker` card renders the timeline on awarded RFQ detail pages.
- **`POST /api/admin/purge-users`** — AUTH_SECRET-guarded maintenance endpoint
  to delete test/demo sign-ups (and their bids/awards/saves) by email prefix;
  used to clean up smoke-test accounts without touching real data.
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
- **BnS page-extract importer** (`api/bns_import.py`). Turns a pasted copy of the
  members-only BnS RFQ listing into concierge-review drafts — reusing the exact
  chunking and `rfq_parser.parse_rfq` logic that produced the original seed — so
  each entry lands in the `/review` queue as a `pending_draft` (`source="bns"`),
  **never** straight on the board. Entries already live or already queued are
  skipped; throwaway issuers are dropped. Reachable three ways sharing one service:
  `review.py import-bns --file <path> [--dry-run]`, operator `POST
  /api/operator/import/bns`, and an "Import BnS page-extract" panel on `/review`.
  This is only the *parse-and-file* half; no live website fetch is wired in (that
  needs the site URL, automated-access permission, and login if gated).
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
