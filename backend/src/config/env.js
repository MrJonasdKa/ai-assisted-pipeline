import 'dotenv/config';

// Centralizing env access means every required value is checked once,
// at startup, instead of failing deep inside a worker at 2am.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  mysql: {
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    database: required('MYSQL_DATABASE'),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
  },
  redis: {
    host: required('REDIS_HOST'),
    port: Number(process.env.REDIS_PORT || 6379),
  },
  server: {
    port: Number(process.env.PORT || 3000),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  ingestion: {
    sourceFile: process.env.LOG_SOURCE_FILE || '../data/Linux_2k.log',
    minDelayMs: Number(process.env.INGEST_MIN_DELAY_MS || 100),
    maxDelayMs: Number(process.env.INGEST_MAX_DELAY_MS || 400),
  },
  batching: {
    size: Number(process.env.BATCH_SIZE || 5),
    waitMs: Number(process.env.BATCH_WAIT_MS || 2000),
    maxRetries: Number(process.env.MAX_RETRIES || 3),
  },
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
  },
  anomaly: {
    windowMs: Number(process.env.BASELINE_WINDOW_MS || 60000),
    zScoreThreshold: Number(process.env.ANOMALY_ZSCORE_THRESHOLD || 2.5),
  },
};
