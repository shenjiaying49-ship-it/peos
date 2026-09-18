import { useState } from "react";
import { api, type WeekDay } from "../api";

const stripTime = (s: string) => s.replace(/^\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*/, "");

/** 今日任务台账：行式账本（纯文本），点击勾选直接回写 Daily Note */
export default function TaskLedger({ week, onChanged }: { week: WeekDay[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const freq: Record<string, number> = {};
  week.forEach(w => w.incomplete.forEach(t => { freq[t] = (freq[t] || 0) + 1; }));

  const days = [...week].reverse().filter(d => d.total > 0);

  const toggle = async (date: string, section: string, raw: string, done: boolean, key: string) => {
    setBusy(key); setErr(null);
    const r = await api.toggle({ date, section, raw, done });
    setBusy(null);
    if (!r.ok) setErr(r.error || "写回失败");
    else onChanged();
  };

  if (!days.length) return <p className="muted">今天还没有任务。</p>;

  return (
    <div className="ledger">
      {err && <p className="err" role="alert">✗ {err}</p>}
      {days.map(w => (
        <div key={w.date} className="ledger-day">
          <div className="ledger-head mono">
            {w.date.slice(5)} {w.weekday}
            <span className="ledger-count">{w.done}/{w.total}</span>
            {w.tasks.some(t => t.done) && <span className="ledger-flag">✓</span>}
          </div>
          {w.tasks.filter(t => !t.done).map((t, i) => {
            const key = `${w.date}|${i}`;
            return (
              <div key={key} className={`lrow ${busy === key ? "busy" : ""}`}
                onClick={() => busy !== key && toggle(w.date, t.section, t.raw, true, key)}
                role="checkbox" aria-checked={false} tabIndex={0}
                onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(w.date, t.section, t.raw, true, key); } }}>
                <span className="lbox" aria-hidden="true" />
                <span className="ltxt">{stripTime(t.text)}
                  {freq[t.text] >= 3 && <em className="zombie">🔁 {freq[t.text]} 天未闭环</em>}</span>
              </div>
            );
          })}
          {!w.tasks.some(t => !t.done) && <div className="lrow done-note">✓ 全部完成</div>}
        </div>
      ))}
    </div>
  );
}
