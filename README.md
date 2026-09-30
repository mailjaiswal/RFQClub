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
