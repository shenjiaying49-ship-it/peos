import { useState } from "react";
import { api } from "../api";

export function DiaryEditor({ today, initial, onSaved }: {
  today: string; initial: string; onSaved: () => void;
}) {
  const [text, setText] = useState(initial);
  const [hint, setHint] = useState(initial ? "今天已有日记，保存会覆盖日记段（其余内容不动）" : "今天的 Daily 将自动创建");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.diarySave(today, text);
      setHint(r.ok ? `✓ 已写入 ${String(r.path).split("/").pop()}${r.created ? "（新建）" : ""}` : `✗ ${r.error}`);
      if (r.ok) onSaved();
    } catch (e) { setHint(`✗ ${e}`); }
    setBusy(false);
  };

  return (
    <div className="diary-editor">
      <textarea value={text} rows={4} onChange={e => setText(e.target.value)}
        placeholder="今天做了什么、卡在哪、一句话洞察……保存后自动进入下方日记流，我读完会给你摘要和评分"
        aria-label="今日日记" />
      <div className="split">
        <button className="btn-solid" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存日记"}</button>
        <span className="muted mono">{hint}</span>
      </div>
    </div>
  );
}

export function DiaryStream({ cards }: { cards: import("../api").DiaryCard[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(6);   // 默认只显示 6 张卡片

  const click = async (date: string) => {
    if (open === date) { setOpen(null); return; }
    setOpen(date);
    if (!full[date]) {
      setFull(f => ({ ...f, [date]: "读取中…" }));
      const r = await api.diaryGet(date);
      const t = (r.full || "（空）").replace(/^---\n.*?\n---\n/s, "").replace(/^#\s*.*$/m, "");
      setFull(f => ({ ...f, [date]: t.trim() }));
    }
  };

  if (!cards.length) return <p className="muted">还没有日记。</p>;
  const visible = cards.slice(0, limit);
  return (
    <div className="dstream">
      {visible.map(c => (
        <article key={c.date} className={`dcard ${open === c.date ? "open" : ""}`}
          onClick={() => click(c.date)} tabIndex={0} role="button"
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); click(c.date); } }}
          aria-expanded={open === c.date}>
          <header className="dc-top">
            <span className="dc-emoji" aria-hidden="true">{c.emoji}</span>
            <span className="dc-date mono">{c.date.slice(5)} {c.weekday}</span>
            <span className="dc-stars" aria-label={`评分 ${c.rating} / 5`}>
              {"★".repeat(c.rating)}<span className="dim">{"☆".repeat(5 - c.rating)}</span>
            </span>
          </header>
          <p className="dc-summary">{c.summary}</p>
          <p className="dc-comment">{c.comment}</p>
          {open === c.date && <pre className="dc-full">{full[c.date]}</pre>}
        </article>
      ))}
      {cards.length > limit && (
        <button className="more-btn mono" onClick={() => setLimit(l => l + 12)}>
          ▾ 展开更多 · 还剩 {cards.length - limit} 天
        </button>
      )}
    </div>
  );
}

interface ChatMsg { role: "user" | "bot"; text: string; mode?: string }

export function AgentChat({ engineState }: { engineState: Record<string, unknown> }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    try { return JSON.parse(localStorage.getItem("peos.chat") || "[]"); } catch { return []; }
  });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const push = (m: ChatMsg) => setMsgs(prev => {
    const next = [...prev, m].slice(-40);
    localStorage.setItem("peos.chat", JSON.stringify(next));
    return next;
  });

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ("");
    push({ role: "user", text: question.trim() });
    setBusy(true);
    try {
      const r = await api.ask(question.trim(), engineState);
      push({ role: "bot", text: r.answer, mode: r.mode });
    } catch (e) { push({ role: "bot", text: "请求失败：" + String(e) }); }
    setBusy(false);
  };

  const QUICK = ["今天先做什么？", "要不要换工作？", "这篇发不发？", "太累了怎么办？", "要不要接这个合作？"];

  return (
    <div className="agent">
      <div className="chat-log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div className="b-role mono">{m.role === "user" ? "你" : m.mode === "llm" ? "AGENT·LLM" : "AGENT"}</div>
            <div className="b-text">{m.text}</div>
          </div>
        ))}
        {busy && <div className="bubble bot pending"><div className="b-role mono">AGENT</div><div className="b-text">思考中<span className="dots" /></div></div>}
        {!msgs.length && !busy && <div className="bubble bot"><div className="b-role mono">AGENT</div><div className="b-text">问任何决策问题。我会按判断顺序和你的战略边界回答。</div></div>}
      </div>
      <div className="chips">
        {QUICK.map(x => <button key={x} className="chip" onClick={() => ask(x)}>{x}</button>)}
      </div>
      <div className="chat-row">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask(q)}
          placeholder="问任何决策问题…（结合你的状态、四象限和战略边界）" aria-label="向决策 agent 提问" />
        <button className="btn-solid" onClick={() => ask(q)} disabled={busy}>发送</button>
      </div>
      <p className="muted mono small">规则与人格：peos/agent_skill.md · 接 LLM：config.json → agent</p>
    </div>
  );
}
