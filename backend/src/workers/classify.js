// TODO: replace with real LLM call.
//
// This stub exists so the rest of the pipeline (queue, batching, schema
// validation, DB, anomaly detection, WebSocket) can be built and tested
// end-to-end before an LLM provider is wired in. It's a plain regex/
// keyword parser that produces output shaped exactly like the schema in
// schema/logSchema.js expects — swap the body of classifyBatch() for a
// real API call (e.g. to Gemini/DeepSeek) and keep the same return shape.

const LINE_PATTERN =
  /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^[\s]+?)(?:\[(\d+)])?:\s*(.*)$/;

function classifyOne(rawLine) {
  const match = LINE_PATTERN.exec(rawLine);
  if (!match) {
    return {
      timestamp: null,
      host: null,
      process: null,
      pid: null,
      event_category: 'other',
      severity: 'info',
      summary: rawLine.slice(0, 200),
      entities: { remote_host: null, user: null },
    };
  }

  const [, timestamp, host, processName, pidStr, message] = match;

  let event_category = 'other';
  let severity = 'info';

  if (/authentication failure|kerberos authentication failed|permission denied/i.test(message)) {
    event_category = 'auth_failure';
    severity = 'warning';
  } else if (/session opened/i.test(message)) {
    event_category = 'session_open';
  } else if (/session closed/i.test(message)) {
    event_category = 'session_close';
  } else if (/connection from/i.test(message)) {
    event_category = 'connection';
  } else if (/restart|startup succeeded|shutdown succeeded/i.test(message)) {
    event_category = 'service_restart';
  } else if (/^udev/i.test(processName)) {
    event_category = 'device_event';
  } else if (/exited abnormally/i.test(message)) {
    event_category = 'other';
    severity = 'warning';
  }

  const remoteHostMatch = /rhost=(\S+)/i.exec(message) ?? /connection from ([^\s(]+)/i.exec(message);
  const userMatch = /user=(\S+)/i.exec(message) ?? /for user (\w+)/i.exec(message);

  return {
    timestamp,
    host,
    process: processName,
    pid: pidStr ? Number(pidStr) : null,
    event_category,
    severity,
    summary: message.slice(0, 200),
    entities: {
      remote_host: remoteHostMatch ? remoteHostMatch[1] : null,
      user: userMatch ? userMatch[1] : null,
    },
  };
}

/** @param {string[]} rawLines @returns {Promise<object[]>} */
export async function classifyBatch(rawLines) {
  return rawLines.map(classifyOne);
}
