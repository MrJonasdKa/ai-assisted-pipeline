# Log Pipeline — AI-Assisted Data Processing Pipeline

Portfolio Project 3. A simulated Linux system log stream flows through a
queue-backed backend, gets classified/extracted by an LLM stage (schema-
validated), and gets checked against a rolling frequency baseline for
anomalies — all with live status pushed to the frontend over WebSockets.

Dataset: [Loghub Linux dataset](https://github.com/logpai/loghub/tree/master/Linux)
(`/var/log/messages`-style logs, no explicit severity field).

## Architecture

```
data/Linux_2k.log
        │
        ▼
 ingestion/simulator.js  ──(delay per line, hash for idempotency)──▶  BullMQ queue (Redis)
                                                                              │
                                                                              ▼
                                                                     workers/logWorker.js
                                                                     ├─ batch N lines
                                                                     ├─ LLM extraction (stubbed for now)
                                                                     ├─ Zod schema validation (retry → dead-letter)
                                                                     ├─ anomaly/baseline.js (rolling frequency check)
                                                                     └─ persist to MySQL (raw_logs / processed_logs / anomalies)
                                                                              │
                                                                              ▼
                                                                     ws/socket.js → Socket.io → frontend dashboard
```

## Status

Plumbing stage: ingestion → queue → worker → schema validation → DB → WebSocket.
The LLM call in `workers/logWorker.js` (`classifyBatch`) is currently a
stub that returns a deterministic mock extraction so the rest of the
pipeline can be built and tested end-to-end before wiring in a real
provider. Look for `// TODO: replace with real LLM call` to find it.

## Setup

1. Copy `backend/.env.example` to `backend/.env` and fill in real values.
   **Never commit `.env`** — it's already gitignored.
2. `docker compose up -d` — starts Redis and MySQL.
3. `cd backend && npm install`
4. Apply the schema: `mysql -h 127.0.0.1 -u <user> -p <db> < src/db/schema.sql`
5. `npm run dev` — starts the API/WebSocket server and the worker.
6. In a second terminal: `npm run simulate` — starts streaming the log
   dataset into the queue.
7. `cd ../frontend && npm install && npm run dev` — dashboard on
   `http://localhost:5173`.

## Security notes

- All DB credentials, Redis URL, and any LLM API key live in `.env` only —
  never hardcoded, never committed.
- `raw_logs.line_hash` (SHA-256 of the raw line) enforces idempotency at
  the DB level via a unique constraint, so re-ingesting the same line
  (retry, restart, duplicate stream) never creates duplicate work.
- Input from the log stream is treated as untrusted: it's parsed
  defensively (the dataset has known quirks — some entries lack a
  standard date), never interpolated into SQL (parameterized queries
  only), and LLM output is never trusted until it passes schema
  validation.
