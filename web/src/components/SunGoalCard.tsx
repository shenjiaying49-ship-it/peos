import { useEffect, useState } from "react";
import { api } from "../api";

interface StarGoal { id: string; text: string; due: string; done: boolean }
interface SunGoal { ok: boolean; sun_goal: string; hint?: string; star_goals: StarGoal[]; vision: string[] }

/** 四张便签之一二：太阳目标（5-10年）+ 8周 Star Goals + 远景版图墙 */
export default function SunGoalCard() {
  const [d, setD] = useState<SunGoal | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.sunGoal().then(r => { if (r.ok) { setD(r); setDraft(r.sun_goal || ""); } }).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!d) return null;

  const saveGoal = async () => {
    if (busy) return;
    setBusy(true);
    await api.sunGoalSave({ sun_goal: draft });
    setBusy(false);
    load();
  };
  const toggle = async (id: string) => {
    await api.sunGoalSave({ toggle_star: id });
    load();
  };

  return (
    <div className="sun-card" data-reveal>
      <div className="sun-head mono">☀ 太阳目标 · 8 周 Star Goals</div>
      <div className="sun-goal-row">
        <input value={draft} onChange={e => setDraft(e.target.value)}
               onBlur={saveGoal} placeholder={d.hint || "写下 5-10 年的目标…"} aria-label="太阳目标" />
        {busy && <span className="mono small">存…</span>}
      </div>
      <div className="sun-stars">
        {d.star_goals.map(g => (
          <button key={g.id} className={`sun-star ${g.done ? "done" : ""}`} onClick={() => toggle(g.id)}>
            <span className="ss-box">{g.done ? "✓" : ""}</span>
            <span className="ss-text">{g.text}</span>
            <span className="ss-due mono">{g.due.slice(5)}</span>
          </button>
        ))}
      </div>
      {d.vision.length > 0 ? (
        <div className="sun-vision">
          {d.vision.map(v => <img key={v} src={`/vision/${encodeURIComponent(v)}`} alt={v} loading="lazy" />)}
        </div>
      ) : (
        <p className="muted small">🖼 远景版：把让你心动的目标图片（想去的地方、想成为的样子）丢进 peos/data/vision/ 文件夹，这里会自动变成你的看板。</p>
      )}
    </div>
  );
}
