import { useEffect, useState } from "react";
import { api, type MediaItem } from "../api";

/** 书影记录：📖 书 / 🎬 剧 · 评分 /10 · 点开看书评 */
export default function MediaBoard() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [type, setType] = useState<"book" | "show">("book");
  const [title, setTitle] = useState("");
  const [rating, setRating] = useState("8");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => { api.media().then(m => setItems(m.items || [])).catch(() => {}); };
  useEffect(load, []);

  const submit = async () => {
    if (!title.trim()) { setErr("标题不能为空"); return; }
    setBusy(true); setErr(null);
    const r = await api.mediaAdd({
      type, title: title.trim(), rating: parseInt(rating) || 0, review: review.trim(),
      date: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (r.ok) { setTitle(""); setReview(""); load(); } else setErr(r.error || "失败");
  };
  const del = async (id: string) => { await api.mediaDel(id); load(); };

  const books = items.filter(x => x.type === "book");
  const shows = items.filter(x => x.type === "show");
  const avg = (arr: MediaItem[]) => arr.length ? (arr.reduce((s, x) => s + x.rating, 0) / arr.length).toFixed(1) : "—";

  return (
    <div className="media">
      <div className="media-form" data-reveal>
        <div className="seg" role="radiogroup" aria-label="类型">
          <button className={type === "book" ? "on" : ""} onClick={() => setType("book")} role="radio" aria-checked={type === "book"}>📖 书</button>
          <button className={type === "show" ? "on" : ""} onClick={() => setType("show")} role="radio" aria-checked={type === "show"}>🎬 剧</button>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="书名 / 剧名" aria-label="标题" />
        <select value={rating} onChange={e => setRating(e.target.value)} aria-label="评分（10 分制）">
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} 分</option>)}
        </select>
        <button className="btn-solid" onClick={submit} disabled={busy}>{busy ? "…" : "记录"}</button>
        {err && <span className="err" role="alert">✗ {err}</span>}
        <textarea rows={2} value={review} onChange={e => setReview(e.target.value)}
          placeholder="书评 / 观后感（可选，点开记录卡可看全文）" aria-label="书评" />
      </div>

      <div className="media-grid">
        <div data-reveal>
          <div className="col-head mono">📖 书 · {books.length} 本 · 平均 {avg(books)}</div>
          {books.map(x => (
            <div key={x.id} className={`mrow ${open === x.id ? "open" : ""}`} onClick={() => setOpen(open === x.id ? null : x.id)}
              tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === x.id ? null : x.id); } }}>
              <span className="m-title">{x.title}</span>
              <span className="m-stars">{"★".repeat(Math.round(x.rating / 2))}<span className="dim">{"☆".repeat(5 - Math.round(x.rating / 2))}</span><i className="mono">{x.rating}/10</i></span>
              <span className="m-date mono">{x.date.slice(5)}</span>
              {x.review && open === x.id && <p className="m-review">{x.review}</p>}
              {open === x.id && <button className="fr-del" onClick={e => { e.stopPropagation(); del(x.id); }} aria-label="删除">✕ 删除</button>}
            </div>
          ))}
          {!books.length && <p className="muted">还没有书记录。</p>}
        </div>
        <div data-reveal>
          <div className="col-head mono">🎬 剧 · {shows.length} 部 · 平均 {avg(shows)}</div>
          {shows.map(x => (
            <div key={x.id} className={`mrow ${open === x.id ? "open" : ""}`} onClick={() => setOpen(open === x.id ? null : x.id)}
              tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === x.id ? null : x.id); } }}>
              <span className="m-title">{x.title}</span>
              <span className="m-stars">{"★".repeat(Math.round(x.rating / 2))}<span className="dim">{"☆".repeat(5 - Math.round(x.rating / 2))}</span><i className="mono">{x.rating}/10</i></span>
              <span className="m-date mono">{x.date.slice(5)}</span>
              {x.review && open === x.id && <p className="m-review">{x.review}</p>}
              {open === x.id && <button className="fr-del" onClick={e => { e.stopPropagation(); del(x.id); }} aria-label="删除">✕ 删除</button>}
            </div>
          ))}
          {!shows.length && <p className="muted">还没有剧记录。</p>}
        </div>
      </div>
    </div>
  );
}
