import { useState } from "react";
import { api, type Daily, type Task } from "../api";

export const stripTime = (s: string) => s.replace(/^\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*/, "");

/* 艾森豪威尔四象限（显式标记优先，关键词兜底） */
const Q_META = [
  { key: "q1", label: "🔴 重要 · 紧急", hint: "现在就做" },
  { key: "q2", label: "🟡 重要 · 不紧急", hint: "安排时间做（长期主义区）" },
  { key: "q3", label: "⚪ 紧急 · 不重要", hint: "速办 / 压缩到 10 分钟" },
  { key: "q4", label: "⚫ 不重要 · 不紧急", hint: "可选 · 状态差就删" },
];

/* 优先级 = 写入任务文字的显式标记，classify 据此定象限 */
export const PRIOS = [
  { key: "q1", marker: "⭐", label: "🔴 重要紧急" },
  { key: "q2", marker: "", label: "🟡 重要" },
  { key: "q3", marker: "⚡", label: "⚡ 速办" },
  { key: "q4", marker: "💤", label: "💤 可选" },
];
export const prioOf = (text: string) =>
  PRIOS.find(p => p.marker && text.includes(p.marker))?.key || "q2";
export const withMarker = (text: string, prio: string) => {
  const bare = text.replace(/^[⭐⚡💤]\s*/, "");
  const mk = PRIOS.find(p => p.key === prio)?.marker || "";
  return mk ? `${mk} ${bare}` : bare;
};

/* 生命周期四分区（写入 Daily 的 section 标题） */
export const QUADS = [
  { key: "mind", label: "🧠 心智" }, { key: "body", label: "💪 身体" },
  { key: "spirit", label: "🤝 精神" }, { key: "voc", label: "🚀 事业" },
];
export const quadOfSection = (s: string) =>
  /心智/.test(s) ? "mind" : /身体/.test(s) ? "body" : /精神/.test(s) ? "spirit" : "voc";

/** 半小时时间槽列表 */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const timeOf = (s: string): [string, string] | null => {
  const m = s.match(/(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/);
  return m ? [m[1].padStart(5, "0"), m[2].padStart(5, "0")] : null;
};

function classify(text: string): string {
  const explicit = PRIOS.find(p => p.marker && text.includes(p.marker));
  if (explicit) return explicit.key;
  if (/🐸|青蛙|上课|完成.{0,4}课程|考试|截止/.test(text)) return "q1";
  if (/回填|预览|回复|记 1 条|短句|明日青蛙|确认.{0,2}课表/.test(text)) return "q3";
  if (/自由块|发呆|闲聊|散步|泡沫轴|兴趣|泛听/.test(text)) return "q4";
  return "q2";
}

/* 任务编辑表单（行内复用：TODO 行 & 时间线弹层共用同一套交互） */
export function TaskEditForm({ initText, initStart, initEnd, initQuad, initPrio, lockedQuad, busy: busyProp, onSave, onCancel }: {
  initText: string; initStart: string; initEnd: string; initQuad: string; initPrio: string;
  lockedQuad?: boolean; busy?: boolean;
  onSave: (v: { text: string; time: string; quad?: string; prio: string }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initText);
  const [start, setStart] = useState(initStart);
  const [end, setEnd] = useState(initEnd);
  const [quad, setQuad] = useState(initQuad);
  const [prio, setPrio] = useState(initPrio);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!text.trim() || busy || busyProp) return;
    setBusy(true);
    const err = await onSave({
      text: text.trim(),
      time: `${start}–${end}`,
      quad: lockedQuad ? undefined : quad,
      prio,
    });
    setBusy(false);
    if (err) onCancel();          // 出错时收起，由外层展示错误
  };

  return (
    <div className="tedit" onClick={e => e.stopPropagation()}>
      <input value={text} onChange={e => setText(e.target.value)} autoFocus
        onKeyDown={e => e.key === "Enter" && save()} placeholder="任务内容…" aria-label="任务内容" />
      <div className="cp-row" style={{ marginTop: 8 }}>
        <select value={start} onChange={e => setStart(e.target.value)} aria-label="开始时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="mono cp-dash">–</span>
        <select value={end} onChange={e => setEnd(e.target.value)} aria-label="结束时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="pill-row">
        {QUADS.map(q => (
          <button key={q.key} type="button" className={`pill ${quad === q.key ? "on" : ""}`}
            onClick={() => setQuad(q.key)}>{q.label}</button>
        ))}
      </div>
      <div className="pill-row">
        {PRIOS.map(p => (
          <button key={p.key} type="button" className={`pill ${prio === p.key ? "on" : ""}`}
            onClick={() => setPrio(p.key)}>{p.label}</button>
        ))}
      </div>
      <div className="cp-row" style={{ marginTop: 10 }}>
        <button className="btn-solid" onClick={save} disabled={busy}>{busy ? "…" : "保存"}</button>
        <button className="cp-cancel" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/** 今日 TODO：四象限分组 · 点击勾选 · ✏️ 行内编辑 */
export function TodayTodos({ daily, onChanged }: { daily: Daily | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const toggle = async (date: string, section: string, raw: string, key: string, nowDone: boolean) => {
    setBusy(key); setErr(null);
    const r = await api.toggle({ date, section, raw, done: nowDone });
    setBusy(null);
    if (!r.ok) setErr(r.error || "写回失败");
    else onChanged();
  };

  const all = (daily?.tasks_by_section || []).flatMap(g =>
    g.tasks.map(t => ({ ...t, section: g.section })));
  if (!all.length && !editing) return <p className="muted">今天还没有任务。</p>;

  const buckets: Record<string, typeof all> = { q1: [], q2: [], q3: [], q4: [] };
  all.forEach(t => buckets[classify(t.text)].push(t));

  const saveEdit = (t: Task, section: string) =>
    async (v: { text: string; time: string; quad?: string; prio: string }): Promise<string | null> => {
      const r = await api.taskEdit({
        date: daily!.date, raw: t.raw, section,
        text: withMarker(v.text, v.prio), time: v.time, quad: v.quad,
      });
      if (!r.ok) { setErr(r.error || "保存失败"); return r.error || "保存失败"; }
      setEditing(null);
      onChanged();
      return null;
    };

  return (
    <div className="quad-cross">
      <span className="qc-axis-v mono" aria-hidden="true">重要 ↑</span>
      <span className="qc-axis-h mono" aria-hidden="true">紧急 →</span>
      {/* 十字排布：q2 左上 / q1 右上 / q3 左下 / q4 右下 */}
      {["q2", "q1", "q3", "q4"].map(key => {
        const q = Q_META.find(x => x.key === key)!;
        const list = buckets[q.key];
        return (
          <div key={q.key} className={`quad-cell eq-${q.key}`}>
            <div className="qc-head mono">{q.label}
              <span className="tl-count">{list.filter(t => t.done).length}/{list.length}</span>
            </div>
            <div className="qc-hint mono">{q.hint}</div>
            {list.length === 0 && <p className="muted small qc-empty">空</p>}
            {list.map((t, i) => {
              const key2 = `${q.key}|${t.section}|${i}`;
              return editing === key2 ? (
                <TaskEditForm key={`e${key2}`}
                  initText={stripTime(t.text).replace(/^[⭐⚡💤]\s*/, "")}
                  initStart={timeOf(t.text)?.[0] || "12:00"}
                  initEnd={timeOf(t.text)?.[1] || "12:30"}
                  initQuad={quadOfSection(t.section)} initPrio={prioOf(t.text)}
                  onSave={saveEdit(t, t.section)} onCancel={() => setEditing(null)} />
              ) : (
                <div key={key2} className={`lrow ${t.done ? "is-done" : ""} ${busy === key2 ? "busy" : ""}`}
                  onClick={() => busy !== key2 && toggle(daily!.date, t.section, t.raw, key2, !t.done)}
                  role="checkbox" aria-checked={t.done} tabIndex={0}
                  onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && busy !== key2) { e.preventDefault(); toggle(daily!.date, t.section, t.raw, key2, !t.done); } }}>
                  <span className="lbox" data-on={t.done} aria-hidden="true" />
                  <span className="ltxt">{stripTime(t.text)}</span>
                  <button className="edit-btn" aria-label="编辑任务" title="编辑文字 / 时间 / 分类"
                    onClick={e => { e.stopPropagation(); setEditing(key2); setErr(null); }}>✏️</button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** 自定义任务：挑时间 + 选分类/重要度 → 进入今日 todo + 右侧时间表 */
export function TaskComposer({ date, onAdded }: { date: string; onAdded: () => void }) {
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("19:30");
  const [text, setText] = useState("");
  const [quad, setQuad] = useState("voc");
  const [prio, setPrio] = useState("q2");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api.taskAdd({ date, time: `${start}–${end}`, text: withMarker(text.trim(), prio), quad });
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
          placeholder="自定义任务…" aria-label="任务内容" />
        <button className="btn-solid" onClick={add} disabled={busy}>{busy ? "…" : "加入"}</button>
      </div>
      <div className="pill-row">
        {QUADS.map(q => (
          <button key={q.key} type="button" className={`pill ${quad === q.key ? "on" : ""}`}
            onClick={() => setQuad(q.key)}>{q.label}</button>
        ))}
        <span className="cp-sep" aria-hidden="true" />
        {PRIOS.map(p => (
          <button key={p.key} type="button" className={`pill ${prio === p.key ? "on" : ""}`}
            onClick={() => setPrio(p.key)}>{p.label}</button>
        ))}
      </div>
      {msg && <p className="sp-msg mono">{msg}</p>}
    </div>
  );
}
