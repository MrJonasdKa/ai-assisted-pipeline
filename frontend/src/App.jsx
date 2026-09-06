import { useEffect, useState } from 'react';
import { socket } from './socket.js';
import { CategoryBarChart, ThroughputChart } from './Charts.jsx';
import './App.css';

const MAX_FEED_ITEMS = 100;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const BUCKET_MS = 2000;
const BUCKET_COUNT = 24; // ~48 seconds of visible history

function emptyBuckets() {
  return Array.from({ length: BUCKET_COUNT }, () => ({ count: 0, anomaly: false }));
}

function incrementCategory(byCategory, category) {
  const existing = byCategory.find((row) => row.event_category === category);
  if (existing) {
    return byCategory.map((row) =>
      row.event_category === category ? { ...row, count: row.count + 1 } : row
    );
  }
  return [...byCategory, { event_category: category, count: 1 }];
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [stats, setStats] = useState({ done: 0, deadLetter: 0, anomalies: 0, byCategory: [] });
  const [buckets, setBuckets] = useState(emptyBuckets);

  // WebSocket only tells you what happens *while connected* — it never
  // replays past events. So on load, backfill from the REST API (which
  // reads the durable MySQL data) before listening live for new events.
  useEffect(() => {
    async function loadHistory() {
      try {
        const [logsRes, anomaliesRes, statsRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/logs/recent`),
          fetch(`${BACKEND_URL}/api/anomalies`),
          fetch(`${BACKEND_URL}/api/stats`),
        ]);
        const logs = await logsRes.json();
        const anomalyRows = await anomaliesRes.json();
        const statsData = await statsRes.json();

        setFeed(
          logs
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

        setStats({
          done: statsData.done,
          deadLetter: statsData.deadLetter,
          anomalies: statsData.anomalies,
          byCategory: statsData.byCategory.map((r) => ({ event_category: r.event_category, count: r.count })),
        });
      } catch (err) {
        console.error('Failed to load history from API', err);
      }
    }
    loadHistory();
  }, []);

  // Scroll the throughput chart forward on a fixed cadence, independent of
  // when events actually arrive — this is what gives it the "live strip
  // chart" feel rather than a static bar that only updates on data.
  useEffect(() => {
    const id = setInterval(() => {
      setBuckets((prev) => [...prev.slice(1), { count: 0, anomaly: false }]);
    }, BUCKET_MS);
    return () => clearInterval(id);
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

      setStats((prev) => ({
        ...prev,
        done: prev.done + 1,
        anomalies: payload.anomaly ? prev.anomalies + 1 : prev.anomalies,
        byCategory: incrementCategory(prev.byCategory, payload.extracted.event_category),
      }));

      setBuckets((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = {
          count: last.count + 1,
          anomaly: last.anomaly || Boolean(payload.anomaly),
        };
        return next;
      });

      if (payload.anomaly) {
        setAnomalies((prev) => [{ ...payload, at: Date.now() }, ...prev].slice(0, MAX_FEED_ITEMS));
      }
    }
    function onDeadLetter(payload) {
      setFeed((prev) => [{ type: 'dead_letter', ...payload, at: Date.now() }, ...prev].slice(0, MAX_FEED_ITEMS));
      setStats((prev) => ({ ...prev, deadLetter: prev.deadLetter + 1 }));
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

  const totalOutcomes = stats.done + stats.deadLetter;
  const successRate = totalOutcomes > 0 ? Math.round((stats.done / totalOutcomes) * 100) : null;

  return (
    <div className="sheet">
      <div className="masthead">
        <h1>System log monitor</h1>
        <div className="status-line">
          <span className={`status-dot ${connected ? 'connected' : ''}`} />
          {connected ? 'Connected — receiving live updates' : 'Disconnected'}
        </div>
      </div>

      <hr className="perforation" />

      <section>
        <h2>Session tally</h2>
        <div className="tally">
          <div className="tally-item">
            <span className="tally-value">{stats.done}</span>
            <span className="tally-label">processed</span>
          </div>
          <div className="tally-item">
            <span className="tally-value">{stats.anomalies}</span>
            <span className="tally-label">anomalies</span>
          </div>
          <div className="tally-item">
            <span className="tally-value">{stats.deadLetter}</span>
            <span className="tally-label">dead-lettered</span>
          </div>
          <div className="tally-item">
            <span className="tally-value">{successRate === null ? '\u2014' : `${successRate}%`}</span>
            <span className="tally-label">success rate</span>
          </div>
        </div>

        <h2 className="chart-heading">Throughput</h2>
        <ThroughputChart buckets={buckets} />

        <h2 className="chart-heading">By category</h2>
        <CategoryBarChart data={stats.byCategory} />
      </section>

      <hr className="perforation" />

      <section>
        <h2>Anomalies ({anomalies.length})</h2>
        {anomalies.length === 0 ? (
          <p className="empty-note">
            No anomalies yet. The detector needs a handful of events from the same source before it
            can tell what's normal — bursts will show up here once it does.
          </p>
        ) : (
          anomalies.map((a, i) => (
            <div className="stamp" key={i}>
              <span className="stamp-tag">Burst</span>
              {a.anomaly.bucketKey} — z={a.anomaly.zScore}
              <div className="stamp-detail">{a.anomaly.reason}</div>
            </div>
          ))
        )}
      </section>

      <hr className="perforation" />

      <section>
        <h2>Live feed</h2>
        {feed.length === 0 ? (
          <p className="empty-note">Waiting for log lines to arrive.</p>
        ) : (
          feed.map((item, i) => (
            <div className="feed-line" key={i}>
              {item.type === 'dead_letter' ? (
                <>
                  <span className="tag failed">[FAILED]</span>
                  <span>raw_log {item.rawLogId} — {item.reason}</span>
                </>
              ) : (
                <>
                  <span className={`tag ${item.extracted.severity}`}>[{item.extracted.event_category}]</span>
                  <span>{item.extracted.summary}</span>
                </>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
