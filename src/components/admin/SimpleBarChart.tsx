type Point = { label: string; value: number };

export function SimpleBarChart({
  title,
  points,
  max,
}: {
  title?: string;
  points: Point[];
  max?: number;
}) {
  const hi = max ?? Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="bar-chart">
      {title ? <div className="bar-chart__title">{title}</div> : null}
      <div className="bar-chart__rows">
        {points.map((p) => {
          const pct = Math.round((p.value / hi) * 100);
          return (
            <div key={p.label} className="bar-chart__row">
              <div className="bar-chart__label" title={p.label}>
                {p.label}
              </div>
              <div className="bar-chart__track">
                <div className="bar-chart__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="bar-chart__val">{p.value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
