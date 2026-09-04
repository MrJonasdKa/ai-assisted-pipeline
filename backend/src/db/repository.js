import { pool } from './pool.js';

/**
 * Insert a raw log line. Idempotent: if line_hash already exists,
 * returns the existing row instead of creating a duplicate.
 */
export async function insertRawLog({ lineHash, rawLine }) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO raw_logs (line_hash, raw_line, status) VALUES (?, ?, 'queued')`,
      [lineHash, rawLine]
    );
    return { id: result.insertId, alreadyExisted: false };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [rows] = await pool.execute(
        `SELECT id FROM raw_logs WHERE line_hash = ?`,
        [lineHash]
      );
      return { id: rows[0].id, alreadyExisted: true };
    }
    throw err;
  }
}

export async function setRawLogStatus(id, status, { incrementAttempts = false } = {}) {
  const attemptsClause = incrementAttempts ? ', attempts = attempts + 1' : '';
  await pool.execute(
    `UPDATE raw_logs SET status = ?${attemptsClause} WHERE id = ?`,
    [status, id]
  );
}

export async function getRawLogAttempts(id) {
  const [rows] = await pool.execute(
    `SELECT attempts FROM raw_logs WHERE id = ?`,
    [id]
  );
  return rows[0]?.attempts ?? 0;
}

export async function insertProcessedLog(rawLogId, extracted) {
  const [result] = await pool.execute(
    `INSERT INTO processed_logs
      (raw_log_id, log_timestamp, host, process_name, pid, event_category,
       severity, summary, remote_host, user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rawLogId,
      extracted.timestamp ?? null,
      extracted.host ?? null,
      extracted.process ?? null,
      extracted.pid ?? null,
      extracted.event_category,
      extracted.severity,
      extracted.summary,
      extracted.entities?.remote_host ?? null,
      extracted.entities?.user ?? null,
    ]
  );
  return result.insertId;
}

export async function insertAnomaly(processedLogId, { bucketKey, score, reason }) {
  await pool.execute(
    `INSERT INTO anomalies (processed_log_id, bucket_key, score, reason) VALUES (?, ?, ?, ?)`,
    [processedLogId, bucketKey, score, reason]
  );
}

/**
 * Recent event counts for a bucket, used to seed/refresh the in-memory
 * baseline on worker startup so restarts don't reset anomaly detection
 * to zero history.
 */
export async function getRecentBucketCount(processName, eventCategory, remoteHost, sinceMs) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count FROM processed_logs
     WHERE process_name = ? AND event_category = ?
       AND (remote_host = ? OR (remote_host IS NULL AND ? IS NULL))
       AND processed_at >= (NOW(3) - INTERVAL ? SECOND)`,
    [processName, eventCategory, remoteHost, remoteHost, Math.ceil(sinceMs / 1000)]
  );
  return rows[0]?.count ?? 0;
}
