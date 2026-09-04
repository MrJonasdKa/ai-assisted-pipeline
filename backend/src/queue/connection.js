import IORedis from 'ioredis';
import { config } from '../config/env.js';

// BullMQ requires this specific option; without it, blocking commands
// used internally by BullMQ will throw.
export const redisConnection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
});
