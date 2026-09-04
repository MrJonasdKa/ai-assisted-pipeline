import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { insertRawLog } from '../db/repository.js';
import { logQueue } from '../queue/logQueue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hashLine(line) {
  return createHash('sha256').update(line).digest('hex');
}

function randomDelay() {
  const { minDelayMs, maxDelayMs } = config.ingestion;
  return minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const sourcePath = path.resolve(__dirname, config.ingestion.sourceFile);
  console.log(`[simulator] streaming from ${sourcePath}`);

  const rl = createInterface({
    input: createReadStream(sourcePath),
    crlfDelay: Infinity,
  });

  let count = 0;
  let skippedDuplicates = 0;

  for await (const rawLineWithMaybeCR of rl) {
    const rawLine = rawLineWithMaybeCR.replace(/\r$/, '').trim();
    if (!rawLine) continue;

    const lineHash = hashLine(rawLine);

    // Idempotent insert: if this exact line was already ingested
    // (e.g. simulator restarted mid-stream), skip re-queuing it.
    const { id: rawLogId, alreadyExisted } = await insertRawLog({ lineHash, rawLine });

    if (alreadyExisted) {
      skippedDuplicates += 1;
    } else {
      await logQueue.add('process-log-line', { rawLogId, rawLine }, {
        jobId: lineHash, // BullMQ-level dedupe as a second idempotency layer
      });
      count += 1;
    }

    await sleep(randomDelay());
  }

  console.log(`[simulator] done. queued ${count} lines, skipped ${skippedDuplicates} duplicates.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('[simulator] fatal error', err);
  process.exit(1);
});
