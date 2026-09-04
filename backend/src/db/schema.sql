-- Log Pipeline schema
-- Run against the database created by docker-compose (see .env MYSQL_DATABASE).

CREATE TABLE IF NOT EXISTS raw_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  line_hash     CHAR(64) NOT NULL,          -- SHA-256 of the raw line, enforces idempotency
  raw_line      TEXT NOT NULL,
  ingested_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status        ENUM('queued', 'processing', 'done', 'failed', 'dead_letter')
                  NOT NULL DEFAULT 'queued',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_raw_logs_line_hash (line_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS processed_logs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  raw_log_id      BIGINT UNSIGNED NOT NULL,
  log_timestamp   VARCHAR(64),               -- kept as string: source dataset has malformed dates
  host            VARCHAR(255),
  process_name    VARCHAR(255),
  pid             INT UNSIGNED,
  event_category  ENUM(
                    'auth_failure', 'auth_success', 'session_open',
                    'session_close', 'connection', 'service_restart',
                    'device_event', 'kernel', 'other'
                  ) NOT NULL,
  severity        ENUM('info', 'warning', 'critical') NOT NULL,
  summary         VARCHAR(512) NOT NULL,
  remote_host     VARCHAR(255),
  user            VARCHAR(255),
  processed_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_processed_logs_raw_log
    FOREIGN KEY (raw_log_id) REFERENCES raw_logs(id)
    ON DELETE CASCADE,
  INDEX idx_processed_logs_bucket (process_name, event_category, remote_host)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS anomalies (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  processed_log_id  BIGINT UNSIGNED NOT NULL,
  bucket_key        VARCHAR(512) NOT NULL,   -- process|event_category|remote_host
  score             DECIMAL(6,3) NOT NULL,   -- z-score at time of detection
  reason            VARCHAR(255) NOT NULL,
  detected_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_anomalies_processed_log
    FOREIGN KEY (processed_log_id) REFERENCES processed_logs(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
