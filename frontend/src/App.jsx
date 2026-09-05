import { useEffect, useState } from 'react';
import { socket } from './socket.js';

const MAX_FEED_ITEMS = 100;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState([]);
  const [anomalies, setAnomalies] = useState([]);

  // WebSocket only tells you what happens *while connected* — it never
  // replays past events. So on load, backfill from the REST API (which
  // reads the durable MySQL data) before listening live for new events.
  useEffect(() => {
    async function loadHistory() {
      try {
        const [logsRes, anomaliesRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/logs/recent`),
          fetch(`${BACKEND_URL}/api/anomalies`),
        ]);
        const logs = await logsRes.json();
        const anomalyRows = await anomaliesRes.json();

        setFeed(
          logs
            // Skip rows still in-flight (queued/processing) — they have no
            // matching processed_logs row yet, so their fields would all be
            // null. Only show items that actually reached a final state.
            .filter((row) => row.status === 'done' || row.status === 'dead_letter')
            .map((row) => ({
              type: row.status === 'dead_letter' ? 'dead_letter' : 'processed',
              rawLogId: row.id,
              reason: row.status === 'dead_letter' ? 'schema validation failed' : undefined,
              extracted: { event_category: row.event_category, severity: row.severity, summary: row.summary },
              at: new Date(row.ingested_at).getTime(),
            }))
        );

        setAnomalies(
          anomalyRows.map((row) => ({
            anomaly: { bucketKey: row.bucket_key, zScore: row.score, reason: row.reason },
            at: new Date(row.detected_at).getTime(),
          }))
        );
      } catch (err) {
        console.error('Failed to load history from API', err);
      }
    }
    loadHistory();
  }, []);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onProcessed(payload) {
      setFeed((prev) => [{ type: 'processed', ...payload, at: Date.now() }, ...prev].slice(0, MAX_FEED_ITEMS));
      if (payload.anomaly) {
        setAnomalies((prev) => [{ ...payload, at: Date.now() }, ...prev].slice(0, MAX_FEED_ITEMS));
      }
    }
    function onDeadLetter(payload) {
      setFeed((prev) => [{ type: 'dead_letter', ...payload, at: Date.now() }, ...prev].slice(0, MAX_FEED_ITEMS));
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('log:processed', onProcessed);
    socket.on('log:dead_letter', onDeadLetter);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('log:processed', onProcessed);
      socket.off('log:dead_letter', onDeadLetter);
    };
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h1>Log Pipeline Dashboard</h1>
      <p>
        Status:{' '}
        <strong style={{ color: connected ? 'green' : 'crimson' }}>
          {connected ? 'connected' : 'disconnected'}
        </strong>
      </p>

      <h2>Anomalies ({anomalies.length})</h2>
      <ul>
        {anomalies.map((a, i) => (
          <li key={i} style={{ color: 'crimson' }}>
            [{a.anomaly.bucketKey}] z={a.anomaly.zScore} — {a.anomaly.reason}
          </li>
        ))}
      </ul>

      <h2>Live feed</h2>
      <ul>
        {feed.map((item, i) => (
          <li key={i}>
            {item.type === 'dead_letter'
              ? `\u2620 dead-lettered: raw_log ${item.rawLogId} — ${item.reason}`
              : `\u2713 ${item.extracted.event_category} (${item.extracted.severity}) — ${item.extracted.summary}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
