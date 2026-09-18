import { useEffect, useState } from "react";
import { api } from "../api";

export interface TopicItem { id: string; date: string; text: string; note: string; done: boolean }

/** 我的待写清单 —— 手动维护（不再自动解析内容排期表） */
export default function TopicsBoard() {
  const [items, setItems] = useState<TopicItem[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => { api.topics().then(t => setItems(t.items || [])).catch(() => {}); };
  useEffect(load, []);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api.topicAdd({ text: text.trim(), note: note.trim(), date: new Date().toISOString().slice(0, 10) });
    setBusy(false);
    if (r.ok) { setText(""); setNote(""); load(); }
  };
  const toggle = async (id: string) => { await api.topicToggle(id); load(); };
  const del = async (id: string) => { await api.topicDel(id); load(); };

  const open = items.filter(x => !x.done);
  const done = items.filter(x => x.done);

  return (
    <div className="topics">
      <div className="topic-form">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="添加待写选题…" aria-label="待写选题" />
        <input className="tnote" value={note} onChange={e => setNote(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="备注（可选）" aria-label="备注" />
        <button className="btn-solid" onClick={add} disabled={busy}>添加</button>
      </div>
      {open.map(x => (
        <div key={x.id} className="tp-row">
          <button className="tp-box" onClick={() => toggle(x.id)} aria-label="标记已写">✓</button>
          <span className="tp-text">{x.text}{x.note && <em className="tp-note mono"> · {x.note}</em>}</span>
          <button className="fr-del" onClick={() => del(x.id)} aria-label="删除">✕</button>
        </div>
      ))}
      {!open.length && !done.length && <p className="muted">还没有待写选题 —— 上面加第一条。</p>}
      {done.map(x => (
        <div key={x.id} className="tp-row done">
          <button className="tp-box on" onClick={() => toggle(x.id)} aria-label="恢复待写">✓</button>
          <span className="tp-text">{x.text}{x.note && <em className="tp-note mono"> · {x.note}</em>}</span>
          <button className="fr-del" onClick={() => del(x.id)} aria-label="删除">✕</button>
        </div>
      ))}
      {!!done.length && <div className="muted mono small mt8">✓ 已写 {done.length} 条置底</div>}
    </div>
  );
}
