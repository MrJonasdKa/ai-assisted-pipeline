import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from './config/env.js';
import { createSocketServer } from './ws/socket.js';
import { startWorker } from './workers/logWorker.js';
import { pool } from './db/pool.js';

const app = express();
app.use(cors({ origin: config.server.corsOrigin }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/anomalies', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.bucket_key, a.score, a.reason, a.detected_at,
              p.process_name, p.event_category, p.summary, p.remote_host
       FROM anomalies a
       JOIN processed_logs p ON p.id = a.processed_log_id
       ORDER BY a.detected_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/logs/recent', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.status, r.ingested_at, p.event_category, p.severity, p.summary
       FROM raw_logs r
       LEFT JOIN processed_logs p ON p.raw_log_id = r.id
       ORDER BY r.ingested_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const [statusRows] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM raw_logs GROUP BY status`
    );
    const [categoryRows] = await pool.execute(
      `SELECT event_category, COUNT(*) AS count FROM processed_logs GROUP BY event_category ORDER BY count DESC`
    );
    const [[{ anomalyCount }]] = await pool.execute(
      `SELECT COUNT(*) AS anomalyCount FROM anomalies`
    );

    const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));
    res.json({
      done: byStatus.done ?? 0,
      queued: byStatus.queued ?? 0,
      processing: byStatus.processing ?? 0,
      deadLetter: byStatus.dead_letter ?? 0,
      anomalies: anomalyCount,
      byCategory: categoryRows,
    });
  } catch (err) {
    next(err);
  }
});

// Centralized error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'internal_server_error' });
});

const httpServer = createServer(app);
const io = createSocketServer(httpServer);

startWorker(io);

httpServer.listen(config.server.port, () => {
  console.log(`[server] listening on :${config.server.port}`);
});
