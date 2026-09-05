/**
 * Frequency-based anomaly detection, independent of the LLM classification.
 *
 * Approach: for each bucket (process + event_category + remote_host), track
 * the time between consecutive events using Welford's online algorithm for
 * mean/variance of inter-arrival times. When a new event arrives much
 * *faster* than the bucket's historical average (z-score below
 * -threshold), that's a burst — exactly the shape of an SSH brute-force
 * attempt or an FTP connection flood, both of which show up in the raw
 * Linux dataset.
 *
 * This is deliberately simple and explainable (no ML dependency): a
 * rolling mean/std per bucket is enough to catch real bursts, and it's
 * cheap to compute per-event in a worker.
 */

const buckets = new Map(); // bucketKey -> { lastEventAt, n, mean, m2 }

const MIN_SAMPLES_BEFORE_SCORING = 5; // don't flag anomalies until we have a baseline

// LLM extraction isn't perfectly consistent call-to-call — e.g. Groq
// sometimes returns "sshd" and sometimes "sshd(pam_unix)" for the exact
// same raw line. Strip a trailing "(module)" annotation before bucketing
// so the same real burst doesn't get silently split across two buckets
// and never reach the sample threshold in either.
function normalizeProcess(process) {
  if (!process) return 'unknown';
  const stripped = process.replace(/\([^)]*\)\s*$/, '').trim();
  return stripped || 'unknown';
}

export function bucketKeyFor({ process, event_category, remote_host }) {
  return [normalizeProcess(process), event_category, remote_host ?? 'none'].join('|');
}

/**
 * Records a new event for its bucket and returns an anomaly verdict.
 * Call this once per processed log line, after LLM extraction succeeds.
 */
export function recordAndCheck({ process, event_category, remote_host }, timestampMs, thresholdZ) {
  const key = bucketKeyFor({ process, event_category, remote_host });
  const bucket = buckets.get(key) ?? { lastEventAt: null, n: 0, mean: 0, m2: 0 };

  let verdict = { isAnomaly: false, zScore: null, bucketKey: key };

  if (bucket.lastEventAt !== null) {
    const interArrivalMs = timestampMs - bucket.lastEventAt;

    if (bucket.n >= MIN_SAMPLES_BEFORE_SCORING) {
      const variance = bucket.n > 1 ? bucket.m2 / (bucket.n - 1) : 0;
      const std = Math.sqrt(variance);
      // Guard against a degenerate (zero-variance) baseline.
      if (std > 0) {
        const z = (interArrivalMs - bucket.mean) / std;
        if (z <= -thresholdZ) {
          verdict = {
            isAnomaly: true,
            zScore: Number(z.toFixed(3)),
            bucketKey: key,
            reason: `Event arrived ${Math.abs(z).toFixed(1)}\u03c3 faster than this bucket's baseline (burst pattern)`,
          };
        } else {
          verdict.zScore = Number(z.toFixed(3));
        }
      }
    }

    // Welford update of running mean/variance for inter-arrival time.
    bucket.n += 1;
    const delta = interArrivalMs - bucket.mean;
    bucket.mean += delta / bucket.n;
    const delta2 = interArrivalMs - bucket.mean;
    bucket.m2 += delta * delta2;
  } else {
    bucket.n = 0; // first event in this bucket — nothing to compare yet
  }

  bucket.lastEventAt = timestampMs;
  buckets.set(key, bucket);

  return verdict;
}

/** Exposed for tests / debugging — not used in the normal pipeline path. */
export function _resetBaseline() {
  buckets.clear();
}
