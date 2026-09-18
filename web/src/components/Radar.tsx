import { type Quad } from "../api";

/** 四象限雷达（0–5 标尺，白描边发光 + 双虚线） */
export default function Radar({ items, size = 330 }: { items: Quad[]; size?: number }) {
  const cx = size / 2, cy = size / 2 + 4, R = size / 2 - 54, max = 5;
  const ang = [-90, 0, 90, 180].map(a => (a * Math.PI) / 180);
  const P = (v: number, i: number): [number, number] =>
    [cx + Math.cos(ang[i]) * R * (v / max), cy + Math.sin(ang[i]) * R * (v / max)];
  const poly = (k: "current" | "after90" | "ideal") =>
    items.map((q, i) => P(q[k], i).map(n => n.toFixed(1)).join(",")).join(" ");
  const LP: [number, number, "middle" | "start" | "end"][] = [
    [cx, cy - R - 36, "middle"], [cx + R + 10, cy, "start"],
    [cx, cy + R + 32, "middle"], [cx - R - 10, cy, "end"],
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="四象限雷达图">
      {[1, 2, 3, 4, 5].map(r => (
        <polygon key={r} points={items.map((_, i) => P(r, i).map(n => n.toFixed(1)).join(",")).join(" ")}
          fill="none" stroke="#1e1e1e" />
      ))}
      {items.map((_, i) => {
        const [x, y] = P(max, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1e1e1e" />;
      })}
      <polygon points={poly("ideal")} fill="rgba(255,255,255,.015)" stroke="#333" strokeDasharray="3 4" />
      <polygon points={poly("after90")} fill="rgba(255,255,255,.03)" stroke="#8f8f8f" strokeDasharray="5 4" />
      <polygon points={poly("current")} fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.22)" strokeWidth={6} strokeLinejoin="round" />
      <polygon points={poly("current")} fill="rgba(255,255,255,.1)" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
      {items.map((q, i) => (
        <g key={q.id}>
          <text x={LP[i][0]} y={LP[i][1]} fill="#fff" fontSize={12} fontWeight={700} textAnchor={LP[i][2]}>
            {q.icon} {q.name.split(" ")[0]}
          </text>
          <text x={LP[i][0]} y={LP[i][1] + 14} fill="#a6a6a6" fontSize={10.5} textAnchor={LP[i][2]}>
            {q.current} → {q.ideal}
          </text>
        </g>
      ))}
    </svg>
  );
}
