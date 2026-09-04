import { Worker } from 'bullmq';
import { redisConnection } from '../queue/connection.js';
import { LOG_QUEUE_NAME } from '../queue/logQueue.js';
import { config } from '../config/env.js';
import { validateBatchExtraction } from '../schema/logSchema.js';
import { classifyBatch } from './classify.js';
import {
  setRawLogStatus,
  insertProcessedLog,
  insertAnomaly,
} from '../db/repository.js';
import { recordAndCheck } from '../anomaly/baseline.js';

let pending = []; // { job, resolve, reject, broadcast }
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((err) => console.error('[worker] flush error', err));
  }, config.batching.waitMs);
}

async function flush() {
  if (pending.length === 0) return;
  const batch = pending.splice(0, config.batching.size);
  const lines = batch.map((item) => item.job.data.rawLine);

  await Promise.all(
    batch.map((item) => setRawLogStatus(item.job.data.rawLogId, 'processing'))
  );

  let attempt = 0;
  let result = null;
  let lastError = null;

  while (attempt < config.batching.maxRetries && !result) {
    attempt += 1;
    try {
      const rawExtraction = await classifyBatch(lines);
      const validation = validateBatchExtraction(rawExtraction);
      if (validation.success && validation.data.length === lines.length) {
        result = validation.data;
      } else {
        lastError = validation.error ?? new Error('extraction length mismatch');
        console.warn(`[worker] batch validation failed (attempt ${attempt}/${config.batching.maxRetries})`, lastError);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[worker] classify call failed (attempt ${attempt}/${config.batching.maxRetries})`, err.message);
    }
  }

  if (!result) {
    // Whole batch failed schema validation after max retries — dead-letter
    // every item rather than silently persisting garbage.
    for (const item of batch) {
      await setRawLogStatus(item.job.data.rawLogId, 'dead_letter', { incrementAttempts: true });
      item.broadcast?.('log:dead_letter', {
        rawLogId: item.job.data.rawLogId,
        reason: 'schema validation failed after max retries',
      });
      item.reject(lastError ?? new Error('batch failed'));
    }
    return;
  }

  for (let i = 0; i < batch.length; i += 1) {
    const item = batch[i];
    const extracted = result[i];
    try {
      const processedLogId = await insertProcessedLog(item.job.data.rawLogId, extracted);

      const anomalyVerdict = recordAndCheck(
        {
          process: extracted.process,
          event_category: extracted.event_category,
          remote_host: extracted.entities.remote_host,
        },
        Date.now(),
        config.anomaly.zScoreThreshold
      );

      if (anomalyVerdict.isAnomaly) {
        await insertAnomaly(processedLogId, {
          bucketKey: anomalyVerdict.bucketKey,
          score: anomalyVerdict.zScore,
          reason: anomalyVerdict.reason,
        });
      }

      await setRawLogStatus(item.job.data.rawLogId, 'done');

      item.broadcast?.('log:processed', {
        rawLogId: item.job.data.rawLogId,
        processedLogId,
        extracted,
        anomaly: anomalyVerdict.isAnomaly ? anomalyVerdict : null,
      });

      item.resolve();
    } catch (err) {
      console.error(`[worker] failed to persist raw_log ${item.job.data.rawLogId}`, err);
      await setRawLogStatus(item.job.data.rawLogId, 'failed', { incrementAttempts: true });
      item.reject(err);
    }
  }
}

/**
 * @param {import('socket.io').Server | null} io - pass the Socket.io
 *   server to broadcast live status; pass null to run headless (e.g. tests).
 */
export function startWorker(io) {
  const broadcast = io ? (event, payload) => io.emit(event, payload) : null;

  const worker = new Worker(
    LOG_QUEUE_NAME,
    (job) =>
      new Promise((resolve, reject) => {
        pending.push({ job, resolve, reject, broadcast });
        broadcast?.('log:queued_for_batch', { rawLogId: job.data.rawLogId });

        if (pending.length >= config.batching.size) {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flush().catch((err) => console.error('[worker] flush error', err));
        } else {
          scheduleFlush();
        }
      }),
    {
      connection: redisConnection,
      // Must be >= batch size, or BullMQ won't pull enough jobs concurrently
      // for a batch to ever accumulate.
      concurrency: config.batching.size,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} ultimately failed:`, err.message);
  });

  console.log(`[worker] started — batch size ${config.batching.size}, wait ${config.batching.waitMs}ms`);
  return worker;
}

// Allow running standalone via `npm run worker` (no WebSocket broadcast).
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker(null);
}
