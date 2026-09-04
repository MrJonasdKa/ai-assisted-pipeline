import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const LOG_QUEUE_NAME = 'log-lines';

export const logQueue = new Queue(LOG_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600 },   // keep completed jobs 1h then drop
    removeOnFail: false,                // keep failed jobs for inspection / dead-letter review
  },
});
