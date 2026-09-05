// Resets both MySQL (raw_logs / processed_logs / anomalies) and Redis
// (the BullMQ queue) together. These two stores track the same logical
// data from different angles — a raw_log row and its corresponding
// BullMQ job are two halves of one thing. Clearing only one of them
// leaves stale references behind: an old queued/failed job pointing at
// a raw_log_id that no longer exists (or worse, now belongs to a
// different row after AUTO_INCREMENT resets), or MySQL rows with no
// job ever created for them.
//
// Usage: npm run reset

import { pool } from '../db/pool.js';
import { redisConnection } from '../queue/connection.js';

async function reset() {
  console.log('[reset] truncating MySQL tables...');
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('TRUNCATE anomalies');
  await pool.query('TRUNCATE processed_logs');
  await pool.query('TRUNCATE raw_logs');
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('[reset] MySQL tables cleared.');

  console.log('[reset] flushing Redis...');
  await redisConnection.flushall();
  console.log('[reset] Redis cleared.');

  console.log('[reset] done — safe to run npm run simulate now.');
  await pool.end();
  redisConnection.disconnect();
  process.exit(0);
}

reset().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});
