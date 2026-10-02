import { useState } from "react";
import { api } from "../api";
import { useEngine } from "../hooks";

/** 智能安排：精力/睡眠 + 工作上下文 → 一键生成今日计划 */
export default function SmartPlan({ onPlanned, budget, spent }: {
  onPlanned: () => void; budget: number; spent: number | null | undefined;
}) {
  const { state, update } = useEngine();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // 工作上下文字段
  const [focus, setFocus] = useState("");
  const [dahaoStage, setDahaoStage] = useState("");
  const [fixed, setFixed] = useState("");
  const [limitation, setLimitation] = useState("");

  const tier = state.energy <= 2 || state.sleep < 6.5 ? "低精力" : state.energy >= 5 ? "满血" : "默认";
  const remain = Math.max(0, budget - (spent || 0));

  const plan = async () => {
    setBusy(true);
    try {
      const r = await api.plan(state.energy, state.sleep, {
        focus, dahao_stage: dahaoStage, fixed, limitation,
      });
      if (r.ok) {
        const ctxParts: string[] = [];
        if (r.day_context?.active) ctxParts.push(`📍 ${r.day_context.mode}`);
        if (r.strength_day) ctxParts.push("💪 力量日");
        if (r.progress_suggestions?.length) ctxParts.push(`📖 ${r.progress_suggestions[0].title} +${r.progress_suggestions[0].suggested}${r.progress_suggestions[0].unit}`);
        setMsg(`✓ ${r.tier}方案 · 重点 ${(r.frogs || []).length} 件 · ${r.tasks ?? 0} 项任务${ctxParts.length ? " · " + ctxParts.join(" · ") : ""}`);
        onPlanned();
      } else setMsg("✗ " + r.error);
    } catch (e) { setMsg("✗ " + String(e)); }
    setBusy(false);
  };

  return (
    <div className="smartplan">
      <div className="sp-row">
        <label className="sp-cell">
          <span>精力</span>
          <input type="number" min={1} max={5} step={1} value={state.energy}
            onChange={e => update({ energy: clamp(+e.target.value, 1, 5) })}
            aria-label="今日精力 1 到 5" />
        </label>
        <label className="sp-cell">
          <span>睡眠</span>
          <input type="number" min={0} max={12} step={0.5} value={state.sleep}
            onChange={e => update({ sleep: clamp(+e.target.value, 0, 12) })}
            aria-label="昨晚睡眠小时数" />
        </label>
        <button className="btn-solid" onClick={plan} disabled={busy}>
          {busy ? "安排中…" : "智能安排 ▸"}
        </button>
      </div>
      {/* 工作上下文字段（每日 30 秒输入） */}
      <details className="sp-context" style={{ marginTop: "8px", fontSize: "0.9em" }}>
        <summary style={{ cursor: "pointer", opacity: 0.7 }}>📋 今日上下文（可选）</summary>
        <div className="sp-context-fields" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
          <label className="sp-cell" style={{ flex: "1 1 200px" }}>
            <span style={{ fontSize: "0.85em" }}>最重要的在线工作</span>
            <input type="text" placeholder="如：回复客户提案" value={focus} maxLength={60}
              onChange={e => setFocus(e.target.value)} />
          </label>
          <label className="sp-cell" style={{ flex: "1 1 160px" }}>
            <span style={{ fontSize: "0.85em" }}>大号推进阶段</span>
            <select value={dahaoStage} onChange={e => setDahaoStage(e.target.value)}>
              <option value="">— 未指定 —</option>
              <option value="选题">选题</option>
              <option value="素材">素材</option>
              <option value="草稿">草稿</option>
              <option value="修改">修改</option>
              <option value="发布">发布</option>
              <option value="复盘">复盘</option>
            </select>
          </label>
          <label className="sp-cell" style={{ flex: "1 1 200px" }}>
            <span style={{ fontSize: "0.85em" }}>固定安排/截止</span>
            <input type="text" placeholder="如：14:00 会议" value={fixed} maxLength={60}
              onChange={e => setFixed(e.target.value)} />
          </label>
          <label className="sp-cell" style={{ flex: "1 1 160px" }}>
            <span style={{ fontSize: "0.85em" }}>旅行/身体限制</span>
            <input type="text" placeholder="如：腰酸" value={limitation} maxLength={60}
              onChange={e => setLimitation(e.target.value)} />
          </label>
        </div>
      </details>
      <p className="sp-note mono">
        {tier}档：{tier === "低精力" ? "只保重点 + 语言最低闭环，其余自动删除"
          : tier === "满血" ? "三件事 + 运动一项 + 兴趣探索"
          : "三件事 + 运动，不贪"}　·　每天首次刷新会按历史自动生成
      </p>
      <div className={`budget-bar ${remain <= 0 ? "over" : ""}`}>
        <span className="mono">今日预算 ¥{budget}</span>
        <span className="b-bar"><i style={{ width: `${Math.min(100, ((spent || 0) / budget) * 100)}%` }} /></span>
        <span className="mono">已花 ¥{spent || 0} · 剩 ¥{remain}{remain <= 20 && remain > 0 ? " · 接近上限" : ""}{remain <= 0 ? " · 已超" : ""}</span>
      </div>
      {msg && <p className="sp-msg mono">{msg}</p>}
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => (isNaN(v) ? a : Math.min(b, Math.max(a, v)));
