import { useState } from "react";
import { api, type Daily } from "../api";

const FIELDS: { k: string; label: string; unit: string; step: string }[] = [
  { k: "weight", label: "体重", unit: "kg", step: "0.1" },
  { k: "mood", label: "心情", unit: "/5", step: "1" },
  { k: "sleep_hours", label: "睡眠", unit: "h", step: "0.5" },
  { k: "water", label: "饮水", unit: "ml", step: "100" },
  { k: "protein", label: "蛋白质", unit: "g", step: "10" },
  { k: "spend", label: "总支出", unit: "元", step: "1" },
];

/** 身体数据网页直填 → 写入 Daily frontmatter（不再需要手动编辑 frontmatter） */
export default function DailyDataForm({ today, daily, onSaved }: {
  today: string; daily: Daily | null; onSaved: () => void;
}) {
  const init = () => {
    const v: Record<string, string> = {};
    FIELDS.forEach(f => { v[f.k] = daily && (daily as any)[f.k] != null ? String((daily as any)[f.k]) : ""; });
    return v;
  };
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const fields: Record<string, number | ""> = {};
    FIELDS.forEach(f => { fields[f.k] = vals[f.k] === "" ? "" : Number(vals[f.k]); });
    try {
      const r = await api.dailyData(today, fields);
      setHint(r.ok ? `✓ 已写入 ${String(r.path).split("/").pop()}${r.created ? "（新建）" : ""}` : `✗ ${r.error}`);
      if (r.ok) onSaved();
    } catch (e) { setHint(`✗ ${e}`); }
    setBusy(false);
  };

  return (
    <div className="ddform">
      {FIELDS.map(f => (
        <label key={f.k} className="dd-cell">
          <span className="dd-label">{f.label}<i className="mono">{f.unit}</i></span>
          <input inputMode="decimal" step={f.step} value={vals[f.k]}
            onChange={e => setVals(v => ({ ...v, [f.k]: e.target.value }))}
            placeholder="—" aria-label={`${f.label}${f.unit}`} />
        </label>
      ))}
      <div className="dd-actions">
        <button className="btn-solid" onClick={save} disabled={busy}>{busy ? "…" : "记入今日"}</button>
        <span className="muted mono small">{hint}</span>
      </div>
    </div>
  );
}
