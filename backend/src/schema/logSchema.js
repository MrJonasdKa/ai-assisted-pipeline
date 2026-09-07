import { z } from 'zod';

// This is the contract the LLM's JSON output must satisfy. Anything
// that doesn't match gets rejected before it ever reaches the database —
// bad extraction should fail loudly (and retry/dead-letter), not
// silently corrupt structured data.
export const EVENT_CATEGORIES = [
  'auth_failure',
  'auth_success',
  'session_open',
  'session_close',
  'connection',
  'service_restart',
  'device_event',
  'kernel',
  'other',
];

export const SEVERITIES = ['info', 'warning', 'critical'];

export const extractedLogSchema = z.object({
  timestamp: z.string().nullable(),
  host: z.string().nullable(),
  process: z.string().nullable(),
  pid: z.union([z.null(), z.coerce.number().int()]),
  event_category: z.enum(EVENT_CATEGORIES),
  severity: z.enum(SEVERITIES),
  summary: z.string().min(1).max(500),
  // Some model responses omit "entities" entirely when there's nothing to
  // report, rather than sending {remote_host: null, user: null}. Default
  // it instead of requiring the model to always include it explicitly.
  entities: z
    .object({
      remote_host: z.string().nullable(),
      user: z.string().nullable(),
    })
    .default({ remote_host: null, user: null }),
});

// A batch response is an array of extractions, one per input line, in order.
export const batchExtractionSchema = z.array(extractedLogSchema);

/**
 * Validates a raw (already-JSON-parsed) LLM response against the batch
 * schema. Returns { success, data } or { success: false, error } —
 * callers decide what to do with a failure (retry / dead-letter).
 */
export function validateBatchExtraction(parsedJson) {
  const result = batchExtractionSchema.safeParse(parsedJson);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // .flatten() collapses nested paths down to just the top-level array
  // index, hiding which field actually failed. .issues has the full
  // path (e.g. [3, 'timestamp']) so we can actually see the real cause.
  return { success: false, error: result.error.issues };
}
