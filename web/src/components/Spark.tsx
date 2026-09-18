/** 迷你走势（SVG 折线 + 面积 + 末值） */
export default function Spark({ rows, k, unit = "", digits = 1, label }: {
  rows: Record<string, any>[]; k: string; unit?: string; digits?: number; label: string;
}) {
  const pts = rows.filter(r => r[k] != null && !isNaN(r[k]));
  if (!pts.length)
    return <div className="spark-empty"><span className="mono">{label}</span><span className="muted">暂无数据 —— 在「今日」页的今日数据表单填过一次，次日自动出现在这里</span></div>;
  const W = 300, H = 84, pad = 26;
  const vals = pts.map(p => p[k] as number);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const X = (i: number) => pad + ((W - pad * 1.6) * i) / (pts.length - 1 || 1);
  const Y = (v: number) => H - pad - ((H - pad * 1.9) * (v - min)) / span;
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[k] as number).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="spark">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <polygon points={`${pad},${H - pad} ${line} ${X(pts.length - 1).toFixed(1)},${H - pad}`} fill="rgba(255,255,255,.06)" />
        <polyline points={line} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p[k] as number)} r={2} fill="#fff" />)}
        <text x={pad} y={13} fill="#686868" fontSize={9.5}>{min.toFixed(digits)}{unit} — {max.toFixed(digits)}{unit}</text>
        <text x={W - pad} y={13} fill="#fff" fontSize={11} fontWeight={700} textAnchor="end">
          {(last[k] as number).toFixed(digits)}{unit} · {String(last.date).slice(5)}
        </text>
      </svg>
    </div>
  );
}
