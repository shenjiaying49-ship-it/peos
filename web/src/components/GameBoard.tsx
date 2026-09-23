import { useEffect, useState } from "react";
import { api, pct } from "../api";

interface Ach { id: string; cat: string; name: string; desc: string; points: number; tier: string }
interface TierReward { name: string; items: { id: string; label: string; cost: number; tier: string }[] }
interface Precommitment {
  id: string; label: string; stake: number; days: number;
  start: string; frogs_required: number; frogs_done: number; resolved: boolean;
}
interface GameState {
  ok: boolean; points: number; base: number; ach_pts: number; spent: number;
  breakdown: Record<string, number>;
  streak: number; streak_bonus: number;
  level: { name: string; index: number; next: number | null; next_name: string | null };
  level_skills: string[];
  stats: Record<string, number>; unlocked: string[]; achievements: Ach[];
  earth_today: { idx: number; text: string; done: boolean }[]; earth_done_total: number;
  rewards: { id: string; label: string; cost: number; tier: string; pool?: string }[];
  pools: Record<string, { cap: number; used: number; reset: string }>;
  rewards_tiered: Record<string, TierReward>;
  ledger: { ts: string; kind: string; label: string; points: number }[];
  month_net: number | null;
  precommitments: Precommitment[];
  double_days_remaining: string[];
  surprise_available: boolean;
  surprise_pending: { task: string; bonus: number } | null;
}
const TIER_MARK: Record<string, string> = { "普通": "·", "稀有": "◆", "史诗": "◆◆", "传说": "★" };

export default function GameBoard() {
  const [g, setG] = useState<GameState | null>(null);
  const [cat, setCat] = useState("全部");
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState("");
  const [tier, setTier] = useState("micro");
  const [msg, setMsg] = useState("");
  const [pcLabel, setPcLabel] = useState("");
  const [pcStake, setPcStake] = useState("");
  const [pcDays, setPcDays] = useState("3");
  const [savorNote, setSavorNote] = useState("");
  const [savorRid, setSavorRid] = useState("");

  const load = () => { api.game().then(setG).catch(() => {}); };
  useEffect(load, []);

  const act = async (body: Record<string, unknown>, note?: string) => {
    const r = await api.gameAct(body);
    if (!r.ok) setMsg("✗ " + (r.error || "失败"));
    else if (note) setMsg(note);
    load();
  };

  if (!g) return <p className="muted">成就系统读取中…</p>;

  const cats = ["全部", ...Array.from(new Set(g.achievements.map(a => a.cat)))];
  const shown = cat === "全部" ? g.achievements : g.achievements.filter(a => a.cat === cat);
  const lv = g.level;
  const prevTh = [0, 500, 1500, 3000, 6000, 10000, 15000, 25000][lv.index - 1] || 0;
  const lvPct = lv.next ? pct(g.points - prevTh, lv.next - prevTh) : 100;

  const activePc = g.precommitments.filter(p => !p.resolved);
  const pastPc = g.precommitments.filter(p => p.resolved);

  return (
    <div className="game">
      {/* 头部：积分 + 等级 + Streak */}
      <div className="game-head" data-reveal>
        <div className="gh-main">
          <span className="gh-pts mono">{g.points.toLocaleString()}</span>
          <span className="gh-unit mono">PTS</span>
          <span className="gh-title">LV{lv.index} · {lv.name}</span>
          {g.streak > 1 && (
            <span className="gh-streak mono" title={`连续活跃 ${g.streak} 天 · 每任务额外 +${g.streak_bonus}`}>
              🔥 {g.streak}天 · +{g.streak_bonus}/任务
            </span>
          )}
        </div>
        <div className="gh-lv">
          <div className="bar"><i style={{ width: `${lvPct}%` }} /></div>
          <span className="mono small muted">{lv.next ? `${g.points} / ${lv.next} → ${lv.next_name}` : "已满级：地球 Online 主宰"}</span>
        </div>
        <div className="gh-breakdown mono">
          {Object.entries(g.breakdown).map(([k, v]) => v > 0 && <span key={k}>{k} +{v}</span>)}
          <span>成就奖励 +{g.ach_pts}</span>
          {g.spent > 0 && <span>已兑换 −{g.spent}</span>}
          {g.streak > 1 && <span>连续奖 +{g.streak_bonus}</span>}
        </div>
      </div>

      {/* 等级技能 */}
      {g.level_skills.length > 0 && (
        <div className="skills-panel" data-reveal>
          <div className="col-head mono">⚡ 等级技能（{lv.name}）</div>
          <div className="skills-grid">
            {g.level_skills.map((s, i) => <span key={i} className="skill-chip">{s}</span>)}
          </div>
        </div>
      )}

      {/* 地球 Online · 每日任务 */}
      <div className="earth-panel" data-reveal>
        <div className="col-head mono">🌍 地球 Online · 今日任务</div>
        <div className="earth-list">
          {g.earth_today.map(t => (
            <div key={t.idx} className={`earth-row ${t.done ? "done" : ""}`}
                 onClick={() => act({ action: "earth", idx: t.idx, done: !t.done })}>
              <span className="earth-check">{t.done ? "✅" : "⬜"}</span>
              <span className="earth-text">{t.text}</span>
            </div>
          ))}
        </div>
        <p className="muted mono small">累计完成 {g.earth_done_total} 个地球任务</p>
      </div>

      {/* 双倍日 / 惊喜 */}
      <div className="game-quick" data-reveal>
        {g.surprise_available && (
          <button className="btn-outline sm" onClick={() => act({ action: "surprise_claim" })}>
            🎁 今日惊喜
          </button>
        )}
        {g.surprise_pending && (
          <div className="surprise-pending">
            <span className="mono">🎁 惊喜任务：{g.surprise_pending.task}（+{g.surprise_pending.bonus} 分）</span>
            <button className="btn-solid sm" onClick={() => act({ action: "surprise_complete" }, "🎉 惊喜完成！")}>
              ✓ 完成惊喜
            </button>
          </div>
        )}
        {g.level.index >= 5 && g.double_days_remaining.length === 0 && (
          <button className="btn-outline sm" onClick={() => act({ action: "double_day" }, "💥 双倍日！今天积分 ×2")}>
            💥 激活双倍日
          </button>
        )}
        {g.double_days_remaining.length > 0 && (
          <span className="chip on double-day-badge">💥 ×2 双倍积分日进行中</span>
        )}
      </div>

      {/* 挑战押金 */}
      <div className="pc-panel" data-reveal>
        <div className="col-head mono">🔥 挑战押金（预先承诺）</div>
        {msg && <p className="sp-msg mono">{msg}</p>}
        {activePc.length > 0 && (
          <div className="pc-list">
            {activePc.map(pc => (
              <div key={pc.id} className="pc-card">
                <span className="pc-label">{pc.label}</span>
                <span className="pc-info mono">押金 {pc.stake} · {pc.frogs_done}/{pc.frogs_required} 青蛙</span>
                <button className="btn-solid sm" onClick={() => act({ action: "precommitment_resolve", id: pc.id })}>
                  结算
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="pc-form">
          <input value={pcLabel} onChange={e => setPcLabel(e.target.value)} placeholder="挑战名称" aria-label="挑战名称" />
          <input className="pp-total" value={pcStake} onChange={e => setPcStake(e.target.value)} inputMode="numeric" placeholder="押金积分" aria-label="押金积分" />
          <select value={pcDays} onChange={e => setPcDays(e.target.value)} aria-label="天数">
            <option value="3">3 天</option>
            <option value="5">5 天</option>
            <option value="7">7 天</option>
          </select>
          <button className="btn-solid sm" onClick={async () => {
            const stake = parseInt(pcStake) || 0;
            if (!pcLabel.trim() || stake <= 0) { setMsg("✗ 填写挑战名称和押金"); return; }
            const r = await api.gameAct({ action: "precommitment_create", label: pcLabel.trim(), stake, days: parseInt(pcDays) });
            if (!r.ok) setMsg("✗ " + r.error); else { setPcLabel(""); setPcStake(""); setMsg(r.msg || "🔥 挑战已创建"); }
            load();
          }}>创建挑战</button>
        </div>
        {pastPc.length > 0 && (
          <details className="pc-history"><summary className="muted small">已完成挑战（{pastPc.length}）</summary>
            {pastPc.map(pc => (
              <div key={pc.id} className="pc-card muted">
                <span className="pc-label">{pc.label}</span>
                <span className="pc-info mono">{pc.frogs_done}/{pc.frogs_required} · 押金 {pc.stake}</span>
              </div>
            ))}
          </details>
        )}
      </div>

      {/* 奖励商店（每周池 / 每月池 · 带上限防上头） */}
      <div className="shop" data-reveal>
        <div className="col-head mono">🎁 奖励池 · 限时限量，别玩太欢</div>
        {msg && <p className="sp-msg mono">{msg}</p>}
        {(["weekly", "monthly"] as const).map(pk => {
          const pool = g.pools?.[pk] || { cap: pk === "weekly" ? 2 : 1, used: 0, reset: "" };
          const items = g.rewards.filter(r => (r.pool || (r.cost > 500 ? "monthly" : "weekly")) === pk);
          const left = pool.cap - pool.used;
          return (
            <div key={pk} className="tier-section">
              <div className="tier-title mono">
                {pk === "weekly" ? "🗓 每周池 · 每周一刷新" : "👑 每月池 · 每月 1 日刷新（高价值）"}
                <span className={`mono pool-cap ${left <= 0 ? "cap-out" : ""}`}>
                  本期 {pool.used}/{pool.cap}{left <= 0 ? " · 已用完，下期再来" : ""}
                </span>
              </div>
              {items.map(r => {
                const noCap = left <= 0;
                const noPts = g.points < r.cost;
                return (
                  <div key={r.id} className="shop-row">
                    <span className="sr-label">{r.label}</span>
                    <span className="sr-cost mono">{r.cost} 分</span>
                    <button className="btn-solid sm" disabled={noCap || noPts}
                      onClick={async () => {
                        const res = await api.gameAct({ action: "redeem", id: r.id });
                        if (!res.ok) setMsg("✗ " + (res.error || "失败"));
                        else {
                          setMsg(res.savor_prompt || `🎁 已兑换「${r.label}」−${r.cost} 分`);
                          if (res.redeem_id) setSavorRid(res.redeem_id);
                        }
                        load();
                      }}>
                      {noCap ? "已满" : noPts ? `还差 ${r.cost - g.points}` : "兑换"}
                    </button>
                    <button className="fr-del" onClick={() => act({ action: "reward_delete", id: r.id })} aria-label="删除奖励">✕</button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* 品味仪式 */}
        {savorRid && (
          <div className="savor-form">
            <input value={savorNote} onChange={e => setSavorNote(e.target.value)}
              placeholder="🎉 写下享受心得 +5 分" aria-label="品味心得" />
            <button className="btn-solid sm" onClick={async () => {
              if (!savorNote.trim()) { setMsg("✗ 写一句心得吧"); return; }
              const r = await api.gameAct({ action: "savor", rid: savorRid, note: savorNote.trim() });
              if (!r.ok) setMsg("✗ " + r.error); else { setMsg(r.msg || "✨ +5 分"); setSavorRid(""); setSavorNote(""); }
              load();
            }}>+5</button>
          </div>
        )}
        {/* 上架新奖励（选池子） */}
        <div className="pp-form">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="想要的奖励" aria-label="奖励名" />
          <input className="pp-total" value={cost} onChange={e => setCost(e.target.value)} inputMode="numeric" placeholder="所需积分" aria-label="所需积分" />
          <select value={tier} onChange={e => setTier(e.target.value)} aria-label="池子">
            <option value="weekly">🗓 每周池（周一刷新·限2次）</option>
            <option value="monthly">👑 每月池（1日刷新·限1次）</option>
          </select>
          <button className="btn-solid" onClick={async () => {
            const r = await api.gameAct({ action: "reward_add", label: label.trim(), cost: parseInt(cost) || 0, pool: tier });
            if (!r.ok) setMsg("✗ " + r.error); else { setLabel(""); setCost(""); setMsg(""); }
            load();
          }}>上架</button>
        </div>
        {!!g.ledger.length && (
          <div className="ledger mono small">
            {g.ledger.map((e, i) => <span key={i}>{e.ts.slice(5, 16)} {e.label} {e.kind === "redeem" ? "−" : "+"}{e.points}</span>)}
          </div>
        )}
      </div>

      {/* 成就墙（默认收起 · 不刷成就） */}
      <details className="achwall-collapse" data-reveal>
        <summary className="col-head mono">🏆 成就墙 · 已解锁 {g.unlocked.length}/300（收起中，点开查看）</summary>
        <div className="cat-tabs">
          {cats.map(c => (
            <button key={c} className={`chip ${c === cat ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="ach-grid">
          {shown.map(a => {
            const on = g.unlocked.includes(a.id);
            return (
              <div key={a.id} className={`ach ${on ? "on" : ""} t-${a.tier}`} title={a.desc}>
                <span className="ach-mark mono" aria-hidden="true">{TIER_MARK[a.tier] || "·"}</span>
                <span className="ach-name">{on ? a.name : a.name}</span>
                <span className="ach-desc">{a.desc}</span>
                <span className="ach-pts mono">{on ? `+${a.points}` : `${a.points}分`}</span>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}