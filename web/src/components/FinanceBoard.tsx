import { useState } from "react";
import { api, type Finance } from "../api";
import Spark from "./Spark";

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;

/** 财务面板：本月大字结余 + 行内记账 + 台账 + Daily 支出走势 */
export default function FinanceBoard({ fin, reload }: { fin: Finance | null; reload: () => void }) {
  const [type, setType] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!fin) return <p className="muted">财务数据读取中…</p>;

  const submit = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("金额必须大于 0"); return; }
    setBusy(true); setErr(null);
    const r = await api.financeAdd({ type, amount: n, category, note: "", date });
    setBusy(false);
    if (r.ok) { setAmount(""); setCategory(""); reload(); }
    else setErr(r.error || "失败");
  };
  const del = async (id: string) => { await api.financeDel(id); reload(); };

  return (
    <div className="fin">
      <div className="fin-hero" data-reveal>
        <div className="fin-cell">
          <div className="fin-label mono">本月收入 IN</div>
          <div className="fin-num in">{yuan(fin.month_in)}</div>
        </div>
        <div className="fin-sep" aria-hidden="true" />
        <div className="fin-cell">
          <div className="fin-label mono">本月支出 OUT</div>
          <div className="fin-num out">{yuan(fin.month_out)}</div>
        </div>
        <div className="fin-sep" aria-hidden="true" />
        <div className="fin-cell">
          <div className="fin-label mono">本月结余 NET</div>
          <div className="fin-num net">{fin.month_net >= 0 ? "+" : ""}{yuan(fin.month_net)}</div>
        </div>
        {fin.balance != null && (
          <>
            <div className="fin-sep" aria-hidden="true" />
            <div className="fin-cell">
              <div className="fin-label mono">累计余额 BAL</div>
              <div className="fin-num">{yuan(fin.balance)}</div>
            </div>
          </>
        )}
      </div>

      <div className="fin-form" data-reveal>
        <span className="mono form-label">记账 ▸</span>
        <div className="seg" role="radiogroup" aria-label="收支类型">
          <button className={type === "out" ? "on" : ""} onClick={() => setType("out")} role="radio" aria-checked={type === "out"}>支出</button>
          <button className={type === "in" ? "on" : ""} onClick={() => setType("in")} role="radio" aria-checked={type === "in"}>收入</button>
        </div>
        <input className="amt" value={amount} onChange={e => setAmount(e.target.value)}
          inputMode="decimal" placeholder="金额" aria-label="金额" />
        <input value={category} onChange={e => setCategory(e.target.value)}
          placeholder="类目（如 食堂 / 兴趣课 / Yuki 分成）" aria-label="类目" />
        <input className="dt" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="日期" />
        <button className="btn-solid" onClick={submit} disabled={busy}>{busy ? "…" : "记一笔"}</button>
        {err && <span className="err" role="alert">✗ {err}</span>}
      </div>

      <div className="fin-grid">
        <div className="fin-ledger" data-reveal>
          <h3 className="col-head mono">收支台账 · {fin.month}</h3>
          {fin.records.length ? fin.records.map(r => (
            <div key={r.id} className="fin-row">
              <span className="fr-date mono">{r.date.slice(5)}</span>
              <span className={`fr-type ${r.type}`}>{r.type === "in" ? "收" : "支"}</span>
              <span className="fr-cat">{r.category || (r.type === "in" ? "收入" : "支出")}</span>
              <span className={`fr-amt ${r.type}`}>{r.type === "in" ? "+" : "−"}{yuan(r.amount)}</span>
              <button className="fr-del" onClick={() => del(r.id)} aria-label="删除该记录">✕</button>
            </div>
          )) : <p className="muted">还没有记录 —— 上面记第一笔。</p>}
        </div>
        <div data-reveal>
          <h3 className="col-head mono">近 30 天 Daily 支出（自动汇总）</h3>
          <Spark rows={fin.daily_spend} k="spend" unit="" digits={0} label="每日总支出 ¥" />
          <h3 className="col-head mono" style={{ marginTop: 26 }}>预算备注</h3>
          <ul className="fin-notes">
            {fin.notes.map((n, i) => <li key={i}>{n}</li>)}
            {fin.opening_balance == null && (
              <li className="muted">期初余额未设定 —— 在 config.json → finance.opening_balance 填数字后，这里会出现累计余额。</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
