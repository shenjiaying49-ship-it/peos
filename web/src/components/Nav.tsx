import { useEffect, useState } from "react";

const ITEMS = [
  { id: "today", label: "今日" },
  { id: "tasks", label: "截止" },
  { id: "media", label: "书影" },
  { id: "review", label: "复盘" },
  { id: "jarvis", label: "长期" },
  { id: "game", label: "成就" },
  { id: "state", label: "状态" },
];

export default function Nav() {
  const [active, setActive] = useState("");

  useEffect(() => {
    const obs = new IntersectionObserver(
      es => es.forEach(e => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-40% 0px -55% 0px" },
    );
    ITEMS.forEach(({ id }) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <nav className="nav" aria-label="章节导航">
      <a className="nav-logo" href="#today" aria-label="回到今日">
        <span className="nav-mark" aria-hidden="true" />SJY·PEOS<span className="cursor">▌</span>
      </a>
      <div className="nav-items">
        {ITEMS.map((it, i) => (
          <a key={it.id} href={`#${it.id}`} className={`nav-link ${active === it.id ? "on" : ""}`}>
            <span className="nav-idx">{String(i + 1).padStart(2, "0")}</span>{it.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
