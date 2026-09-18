import { useEffect, useState } from "react";
import { api } from "../api";

interface CalibQ { id: string; q: string }
interface CalibPack {
  ok: boolean; questions: CalibQ[]; current: Record<string, number>;
  current_total: number; records: { date: string; answers: Record<string, string>; scores: Record<string, number>; prev: Record<string, number> }[];
  last_date: string | null; days_since: number | null;
}
const QNAMES: Record<string, string> = { mind: "🧠 心智", body: "💪 身体", spirit: "🤝 精神", vocation: "🚀 事业" };

/** 月度校准：引导式深度问答 → 四象限重打分 → 写回 config（HUMAN3.0 Part 5 模板） */
export default function CalibrationFlow({ onSaved }: { onSaved: () => void }) {
  const [pack, setPack] = useState<CalibPack | null>(null);
  const [step, setStep] = useState(-1);          // -1 概览, 0..n-1 问答, n 打分, n+1 完成
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  const load = () => { api.calibration().then(c => { setPack(c); setScores(c.current || {}); }).catch(() => {}); };
  useEffect(load, []);

  if (!pack) return <p className="muted">校准模块读取中…</p>;
  const qs = pack.questions || [];
  const n = qs.length;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.calibrationSave({ answers, scores });
      if (r.ok) {
        const nums = (answers.q1 || "").match(/\d+/);
        const pubs = nums ? parseInt(nums[0]) : null;
        const lines: string[] = [];
        if (pubs != null) lines.push(pubs >= 4
          ? `发布 ${pubs} 篇 ≥ 每周一篇线 —— 心智唯一 KPI 达标，这个月的执行是真的。`
          : `发布 ${pubs} 篇 < 4 篇线 —— 唯一 KPI 未达标，下月其余一切让位给这件事。`);
        if (/减弱|退|不想写/.test(answers.q7 || "")) lines.push("「通道感」出现减弱信号 —— 重读 HUMAN3.0 Part 2.2 的死循环，检查是否在用学习/评估代替创作。");
        else if (/加强|更顺|停不下来/.test(answers.q7 || "")) lines.push("通道感在加强 —— 按 Part 4.3：放掉其他方向，全力沿这条路加深。");
        lines.push(`总分 ${r.prev && Object.keys(r.prev).length ? "" : ""}${pack.current_total} → ${r.current_total}`);
        setResult(lines.join("\n"));
        setStep(n + 1);
        load();
        onSaved();
      } else setResult("✗ " + r.error);
    } catch (e) { setResult("✗ " + String(e)); }
    setBusy(false);
  };

  /* 概览态 */
  if (step === -1) {
    const due = pack.days_since == null || pack.days_since >= 28;
    return (
      <div className="calib" data-reveal>
        <div className="calib-top">
          <div>
            <div className="col-head mono">月度校准 · 深度交流</div>
            <p className="muted">
              {pack.last_date
                ? `上次校准：${pack.last_date}（${pack.days_since} 天前）${due ? " · 已到月度窗口" : ""}`
                : "还没有校准过 —— HUMAN3.0 说这份文档是活的，每月回来一次。"}
            </p>
          </div>
          <button className="btn-solid" onClick={() => setStep(0)}>
            {due ? "开始本月校准 ▸" : "提前校准 ▸"}
          </button>
        </div>
        {!!pack.records?.length && (
          <div className="calib-hist">
            {pack.records.map((r, i) => (
              <div key={i} className="calib-rec mono">
                <span className="cr-date">{r.date.slice(0, 10)}</span>
                {Object.keys(QNAMES).map(k => (
                  <span key={k} className="cr-delta">
                    {QNAMES[k].slice(2)} {(r.scores[k] - r.prev[k] >= 0 ? "+" : "") + (r.scores[k] - r.prev[k]).toFixed(1)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* 完成态 */
  if (step === n + 1) {
    return (
      <div className="calib" data-reveal>
        <div className="col-head mono">✓ 校准完成</div>
        <pre className="calib-result">{result}</pre>
        <div className="split">
          <button className="btn-solid" onClick={() => { setStep(-1); setAnswers({}); setResult(""); }}>回到概览</button>
          <span className="muted mono small">四象限与总分已更新，雷达图即时生效</span>
        </div>
      </div>
    );
  }

  /* 打分态 */
  if (step === n) {
    return (
      <div className="calib" data-reveal>
        <div className="calib-prog mono">{step + 1} / {n + 1} · 重新打分（0–5，可留空跳过）</div>
        {Object.keys(QNAMES).map(k => (
          <div key={k} className="calib-score">
            <label>{QNAMES[k]} <b className="mono">{scores[k]?.toFixed(1) ?? "—"}</b></label>
            <input type="range" min="0" max="5" step="0.1" value={scores[k] ?? 2.5}
              onChange={e => setScores(s => ({ ...s, [k]: parseFloat(e.target.value) }))}
              aria-label={`${QNAMES[k]}分数`} />
          </div>
        ))}
        <div className="split mt8">
          <button className="btn-solid" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存校准"}</button>
          <button className="chip" onClick={() => setStep(step - 1)}>← 上一题</button>
        </div>
      </div>
    );
  }

  /* 问答态 */
  const q = qs[step];
  return (
    <div className="calib" data-reveal>
      <div className="calib-prog mono">{step + 1} / {n + 1} · 深度交流</div>
      <div className="calib-q">{q.q}</div>
      <textarea rows={3} value={answers[q.id] || ""}
        onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
        placeholder="写下真实的答案——校准的是事实，不是愿望" aria-label={q.q} />
      <div className="split mt8">
        <button className="btn-solid" onClick={() => setStep(step + 1)}>{step === n - 1 ? "去打分 ▸" : "下一题 ▸"}</button>
        {step > 0 && <button className="chip" onClick={() => setStep(step - 1)}>← 上一题</button>}
      </div>
    </div>
  );
}
