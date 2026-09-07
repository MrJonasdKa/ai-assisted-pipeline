export function CategoryBarChart({ data }) {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const max = sorted.length > 0 ? sorted[0].count : 1;

  if (sorted.length === 0) {
    return <p className="empty-note">No categories tallied yet.</p>;
  }

  return (
    <div className="bar-chart">
      {sorted.map((row) => (
        <div className="bar-row" key={row.event_category}>
          <span className="bar-label">{row.event_category}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
          <span className="bar-count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 90;

export function ThroughputChart({ buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const stepX = CHART_WIDTH / (buckets.length - 1 || 1);

  const points = buckets.map((b, i) => {
    const x = i * stepX;
    const y = CHART_HEIGHT - (b.count / max) * (CHART_HEIGHT - 10) - 4;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${CHART_WIDTH},${CHART_HEIGHT} L 0,${CHART_HEIGHT} Z`;

  return (
    <svg
      className="throughput-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Events processed per time window, most recent on the right"
    >
      <path d={areaPath} className="throughput-area" />
      <path d={linePath} className="throughput-line" />
      {buckets.map((b, i) =>
        b.anomaly ? (
          <circle
            key={i}
            cx={i * stepX}
            cy={CHART_HEIGHT - (b.count / max) * (CHART_HEIGHT - 10) - 4}
            r="3.5"
            className="throughput-anomaly-dot"
          />
        ) : null
      )}
    </svg>
  );
}