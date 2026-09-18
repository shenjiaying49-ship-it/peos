import { useState } from "react";
import { api, type Daily } from "../api";

export const stripTime = (s: string) => s.replace(/^\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*/, "");

/* 艾森豪威尔四象限（自动分类） */
const Q_META = [
  { key: "q1", label: "🔴 重要 · 紧急", hint: "现在就做" },
  { key: "q2", label: "🟡 重要 · 不紧急", hint: "安排时间做（长期主义区）" },
  { key: "q3", label: "⚪ 紧急 · 不重要", hint: "速办 / 压缩到 10 分钟" },
  { key: "q4", label: "⚫ 不重要 · 不紧急", hint: "可选 · 状态差就删" },
];

function classify(text: string): string {
  const t = text;
  if (/🐸|青蛙|上课|完成.{0,4}课程|考试|截止/.test(t)) return "q1";
  if (/回填|预览|回复|记 1 条|短句|明日青蛙|确认.{0,2}课表/.test(t)) return "q3";
  if (/自由块|发呆|闲聊|散步|泡沫轴|兴趣|泛听/.test(t)) return "q4";
  return "q2";
}

/** 今日 TODO：艾森豪威尔四象限分组 · 纯文本 · 点击勾选 */
export function TodayTodos({ daily, onChanged }: { daily: Daily | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async (date: string, section: string, raw: string, key: string, nowDone: boolean) => {
    setBusy(key); setErr(null);
    const r = await api.toggle({ date, section, raw, done: nowDone });
    setBusy(null);
    if (!r.ok) setErr(r.error || "写回失败");
    else onChanged();
  };

  const all = (daily?.tasks_by_section || []).flatMap(g =>
    g.tasks.map(t => ({ ...t, section: g.section })));
  if (!all.length) return <p className="muted">今天还没有任务。</p>;

  const buckets: Record<string, typeof all> = { q1: [], q2: [], q3: [], q4: [] };
  all.forEach(t => buckets[classify(t.text)].push(t));

  return (
    <div className="todolist">
      {err && <p className="err">{err}</p>}
      {Q_META.map(q => buckets[q.key].length ? (
        <div key={q.key} className={`tl-group eq-${q.key}`}>
          <div className="tl-head mono">{q.label}
            <span className="tl-count">{buckets[q.key].filter(t => t.done).length}/{buckets[q.key].length}</span>
            <span className="tl-hint">{q.hint}</span>
          </div>
          {buckets[q.key].map((t, i) => {
            const key = `${q.key}|${t.section}|${i}`;
            return (
              <div key={key} className={`lrow ${t.done ? "is-done" : ""} ${busy === key ? "busy" : ""}`}
                onClick={() => busy !== key && toggle(daily!.date, t.section, t.raw, key, !t.done)}
                role="checkbox" aria-checked={t.done} tabIndex={0}
                onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && busy !== key) { e.preventDefault(); toggle(daily!.date, t.section, t.raw, key, !t.done); } }}>
                <span className="lbox" data-on={t.done} aria-hidden="true" />
                <span className="ltxt">{stripTime(t.text)}</span>
              </div>
            );
          })}
        </div>
      ) : null)}
    </div>
  );
}

/** 半小时时间槽列表 */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

/** 自定义任务：挑时间 → 进入今日 todo + 右侧时间表 */
export function TaskComposer({ date, onAdded }: { date: string; onAdded: () => void }) {
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("19:30");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api.taskAdd({ date, time: `${start}–${end}`, text: text.trim(), quad: "voc" });
    setBusy(false);
    if (r.ok) { setText(""); setMsg(`✓ 已加入 ${r.time}`); onAdded(); }
    else setMsg("✗ " + r.error);
  };

  return (
    <div className="composer">
      <div className="cp-row">
        <select value={start} onChange={e => setStart(e.target.value)} aria-label="开始时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="mono cp-dash">–</span>
        <select value={end} onChange={e => setEnd(e.target.value)} aria-label="结束时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="cp-text" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="自定义任务…（标题含 🐸/课 = 重要紧急）" aria-label="任务内容" />
        <button className="btn-solid" onClick={add} disabled={busy}>{busy ? "…" : "加入"}</button>
      </div>
      {msg && <p className="sp-msg mono">{msg}</p>}
    </div>
  );
}
