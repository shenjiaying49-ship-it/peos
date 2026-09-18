import { useEffect, useState } from "react";
import { api, pct } from "../api";
import type { DayContext, ProgressSuggestion } from "../api";

export interface ProgressItem { id: string; kind: "book" | "show"; title: string; current: number; total: number; date: string }

/** 目标进度：读书 / 看剧（可增可 +1）+ 减肥（周 & 体重）+ 日程上下文 + 进度建议——进度条可视化，挂今日右栏 */
export default function ProgressPanel({ fitness, onChanged }: {
  fitness: Record<string, any>; onChanged: () => void;
}) {
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [kind, setKind] = useState<"book" | "show">("book");
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [dayCtx, setDayCtx] = useState<DayContext | null>(null);
  const [suggestions, setSuggestions] = useState<ProgressSuggestion[]>([]);

  const load = () => { api.progress().then(p => setItems(p.items || [])).catch(() => {}); };
  useEffect(load, []);

  // 加载日程上下文和进度建议
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    api.dayContext(today).then(setDayCtx).catch(() => {});
    api.suggestions(today).then(r => { if (r.ok) setSuggestions(r.suggestions || []); }).catch(() => {});
  }, []);

  const add = async () => {
    const r = await api.progressAdd({ kind, title: title.trim(), total: parseInt(total) || 0, current: 0 });
    if (r.ok) { setTitle(""); setTotal(""); setErr(null); load(); }
    else setErr(r.error || "失败");
  };
  const inc = async (id: string, d: number) => { await api.progressInc(id, d); load(); };
  const del = async (id: string) => { await api.progressDel(id); load(); };

  const books = items.filter(x => x.kind === "book");
  const shows = items.filter(x => x.kind === "show");

  // 减肥进度
  const weeks = fitness?.weeks || 12;
  const weekNo = fitness?.week_no || 0;
  const wStart = fitness?.weight_start, wTarget = fitness?.weight_target;
  const wNow = fitness?.latest_weight;
  const wPct = (wStart && wNow && wStart > wTarget)
    ? Math.min(100, Math.round(((wStart - wNow) / (wStart - wTarget)) * 100)) : null;

  const Bar = ({ v, label, right }: { v: number; label: string; right: string }) => (
    <div className="pp-row">
      <span className="pp-name">{label}</span>
      <span className="pp-bar"><i style={{ width: `${v}%` }} /></span>
      <span className="pp-num mono">{right}</span>
    </div>
  );

  const Item = ({ x }: { x: ProgressItem }) => {
    const p = pct(x.current, x.total);
    return (
      <div className="pp-row item">
        <span className="pp-name">{p === 100 ? "✓ " : ""}{x.title}</span>
        <span className="pp-bar"><i style={{ width: `${p}%` }} /></span>
        <span className="pp-num mono">{x.current}/{x.total}</span>
        <span className="pp-btns">
          <button onClick={() => inc(x.id, 1)} aria-label={`进度加一`}>+1</button>
          <button onClick={() => inc(x.id, -1)} aria-label={`进度减一`}>−</button>
          <button onClick={() => del(x.id)} aria-label="删除追踪">✕</button>
        </span>
      </div>
    );
  };

  const tripActive = dayCtx?.active && dayCtx.mode?.includes("旅行");

  return (
    <div className="progress-panel" data-reveal>
      <div className="col-head mono">目标进度</div>

      {/* 🗓️ 今日背景 — 从后端 day_context 动态显示 */}
      <div className="pp-group">🗓️ 今日背景</div>
      {dayCtx?.active ? (
        <div className={`pp-schedule ${tripActive ? "active" : ""}`}>
          <div className="pp-schedule-head">
            <span className="pp-schedule-title">{dayCtx.mode === "旅行" ? "🌴 " : "📅 "}{dayCtx.mode || dayCtx.location || "特殊日程"}</span>
            <span className="mono small">{dayCtx.location || ""}{dayCtx.day ? ` · 第${dayCtx.day}/${dayCtx.days}天` : ""}</span>
          </div>
          {dayCtx.summary && <div className="pp-schedule-line"><span>{dayCtx.summary}</span></div>}
          {dayCtx.fixed && dayCtx.fixed.length > 0 && (
            <div className="pp-schedule-line">
              <span className="mono small">固定事项：{dayCtx.fixed.join(" · ")}</span>
            </div>
          )}
          {dayCtx.work_policy && dayCtx.work_policy.online_work && (
            <div className="pp-schedule-line"><span className="muted small">💻 线上工作日 · 大号内容推进中</span></div>
          )}
          {tripActive && <div className="pp-schedule-line"><span className="muted small">旅行优先，保留关键工作，不安排力量训练</span></div>}
        </div>
      ) : (
        <div className="pp-schedule">
          <div className="pp-schedule-head">
            <span className="pp-schedule-title">📅 常规日</span>
            <span className="mono small">标准工作模式</span>
          </div>
        </div>
      )}

      {/* 📖 今日进度建议 */}
      {suggestions.length > 0 && (
        <>
          <div className="pp-group">📖 今日进度建议</div>
          <div className="pp-suggestions">
            {suggestions.map(s => (
              <div key={s.id} className="pp-row item" style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 8, marginBottom: 4 }}>
                <span className="pp-name">{s.title}</span>
                <span className="pp-num mono">{s.current}/{s.total}</span>
                <span className="pp-hint muted small">→ 建议 {s.suggested}{s.unit}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="pp-group">⚖️ 减肥 · {fitness?.plan || "12 周"}</div>
      <Bar v={pct(weekNo, weeks)} label="周进度" right={`W${weekNo}/${weeks}`} />
      {wPct != null
        ? <Bar v={wPct} label="体重" right={`${wStart}→${wTarget}kg · 现 ${wNow}kg`} />
        : <div className="pp-row"><span className="pp-name">体重</span>
            <span className="muted mono small">填一次「今日数据·体重」即出现进度</span></div>}

      <div className="pp-group">📖 读书</div>
      {books.map(x => <Item key={x.id} x={x} />)}
      {!books.length && <p className="muted small">暂无在读追踪 —— 下方添加。</p>}

      <div className="pp-group">🎬 看剧</div>
      {shows.map(x => <Item key={x.id} x={x} />)}
      {!shows.length && <p className="muted small">暂无追剧追踪。</p>}

      <div className="pp-form">
        <select value={kind} onChange={e => setKind(e.target.value as "book" | "show")} aria-label="类型">
          <option value="book">📖 书</option>
          <option value="show">🎬 剧</option>
        </select>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="书名 / 剧名" aria-label="标题" />
        <input className="pp-total" value={total} onChange={e => setTotal(e.target.value)}
          inputMode="numeric" placeholder="总页数/集数" aria-label="总量" />
        <button className="btn-solid" onClick={add}>追踪</button>
      </div>
      {err && <p className="err" role="alert">✗ {err}</p>}
    </div>
  );
}