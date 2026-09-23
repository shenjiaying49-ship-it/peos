import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Daily, type SchedRow } from "../api";

/* ═══════════════════════════════════════════════════════════
   JARVIS · 长期引擎
   - QuickCapture：CH1 首屏「丢给我」（取代自定义任务板块）
   - NowCard：CH1 首屏「现在就做」
   - JarvisBoard：06 章（观察 / 长期目标 / 身心灵 / 闪念箱 / 手表同步）
   积分沿用成就系统（任务/青蛙/日记/数据自动计分），本板块不发分。
   ═══════════════════════════════════════════════════════════ */

const KEY = "jarvis-adhd-v3";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr = () => new Date().toISOString().slice(0, 10);
const dateStrOf = (d: Date) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStrOf(d); };
const parseT = (s: string) => { const [a, b] = (s || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
const fmtMin = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

interface Goal { id: string; name: string; unit: string; start: number; target: number; current: number; dir: 1 | -1; deadline: string; log: { d: string; v: number }[] }
interface Habit { id: string; name: string; log: Record<string, boolean> }
interface Capture { id: string; text: string; time: string }
interface JVState {
  created: string;
  goals: Goal[]; well: { habits: Habit[] };
  days: Record<string, { captures: Capture[]; lateAdds: number }>;
}
function seedGoals(): Goal[] { return [
  { id: uid(), name: "攀岩等级", unit: "级", start: 0, target: 3.5, current: 0, dir: 1, deadline: "2026-12-03", log: [{ d: todayStr(), v: 0 }] },
  { id: uid(), name: "新语言进度", unit: "阶段", start: 0, target: 3, current: 0, dir: 1, deadline: "2026-12-03", log: [{ d: todayStr(), v: 0 }] },
  { id: uid(), name: "读书", unit: "本", start: 0, target: 6, current: 0, dir: 1, deadline: "2026-12-03", log: [{ d: todayStr(), v: 0 }] },
  { id: uid(), name: "体重", unit: "kg", start: 68, target: 64, current: 68, dir: -1, deadline: "2026-12-03", log: [{ d: todayStr(), v: 68 }] },
  { id: uid(), name: "体脂率", unit: "%", start: 26, target: 24, current: 26, dir: -1, deadline: "2026-12-03", log: [{ d: todayStr(), v: 26 }] },
  { id: uid(), name: "大号粉丝", unit: "个(半年翻倍)", start: 0, target: 0, current: 0, dir: 1, deadline: "2027-03-01", log: [{ d: todayStr(), v: 0 }] },
]; }
function load(): JVState {
  let s: JVState | null = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || ""); } catch { /* ignore */ }
  if (!s || !s.goals) s = { created: todayStr(), goals: seedGoals(), well: { habits: [
    { id: uid(), name: "冥想 10min", log: {} }, { id: uid(), name: "阅读 30min", log: {} }, { id: uid(), name: "感恩 3件事", log: {} },
  ] }, days: {} };
  return s;
}

/* ───────── 中文语义解析 ───────── */
const CNUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
const BODY_KW = ["健身", "游泳", "跑步", "飞盘", "攀岩", "羽毛球", "运动", "锻炼", "瑜伽", "散步", "网球"];
const LIGHT_KW = ["回消息", "邮件", "杂事", "整理", "收拾", "买", "订", "预约", "回复", "缴费", "洗"];
const DEEP_KW = ["写", "论文", "作业", "复习", "准备", "改", "剪", "录", "复盘", "规划", "学", "课程", "方案", "稿"];
const cnNum = (w: string) => (CNUM[w] !== undefined ? CNUM[w] : /^\d+$/.test(w) ? parseInt(w) : null);
interface PTask { text: string; time: string; dur: number; prio: 0 | 1 | 2; quad: string; flags: string[] }
function parseOne(raw: string): PTask | null {
  let text = raw.trim(); if (!text) return null;
  const flags: string[] = [];
  let time = "", dur = 45;
  const tp = text.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2})[点:：时]\s*(半|\d{1,2})?分?/);
  if (tp) {
    let h = parseInt(tp[2]); const m = tp[3] ? (tp[3] === "半" ? 30 : parseInt(tp[3])) : 0;
    const p = tp[1];
    if ((p === "下午" || p === "晚上") && h < 12) h += 12;
    else if (p === "中午" && h < 12) h = 12;
    else if (!p && h < 8) h += 12;
    time = fmtMin(h * 60 + m);
  }
  const td = text.match(/([\d一两二三四五六七八九十]+)\s*个?\s*(小时|h)|(\d+)\s*分钟/);
  if (td) {
    if (td[1] !== undefined) { const n = cnNum(td[1]); if (n) dur = Math.round(n * 60); }
    else if (td[3]) dur = parseInt(td[3]);
  }
  let prio: 0 | 1 | 2 = 1;
  if (/截止|deadline|必须|紧急|马上|今天一定|交/.test(text)) prio = 0;
  else if (/有空|顺便|看看|了解|随便|或许|也许/.test(text)) prio = 2;
  const body = BODY_KW.some(k => text.includes(k));
  const light = !body && LIGHT_KW.some(k => text.includes(k));
  const deep = !body && !light && DEEP_KW.some(k => text.includes(k)) && dur >= 60;
  let quad = "q2";
  if (prio === 0 || /🐸|青蛙|上课|考试/.test(text)) quad = "q1";
  else if (light || prio === 2) quad = "q3";
  else if (deep) quad = "q2";
  if (time && parseT(time) >= 23 * 60) flags.push("排在睡觉时间了——建议提前");
  if (dur > 180) { flags.push("超过 3 小时的大活，建议拆两段"); dur = 180; }
  const clean = text
    .replace(/(早上|上午|中午|下午|晚上)?\s*\d{1,2}[点:：时]\s*(半|\d{1,2})?分?\s*/, "")
    .replace(/[（(]?[^）)]*(截止|deadline)[^）)]*[）)]?/, "")
    .replace(/[，,；;]\s*$/, "").trim();
  return { text: clean || text, time, dur, prio, quad, flags };
}
const parseAll = (raw: string) => raw.split(/\n|；|;|。/).map(parseOne).filter(Boolean) as PTask[];

/* ───────── sparkline ───────── */
function Spark2({ log }: { log: { d: string; v: number }[] }) {
  const pts = log.slice(-30);
  if (pts.length < 2) return <span className="jv-spark-empty mono">记 2 次以上出趋势线</span>;
  const vs = pts.map(p => p.v); const min = Math.min(...vs), max = Math.max(...vs); const rng = max - min || 1;
  const W = 120, H = 30;
  const xy = pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 4 - ((p.v - min) / rng) * (H - 8)).toFixed(1)}`).join(" ");
  return <svg width={W} height={H} aria-hidden><polyline points={xy} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" /></svg>;
}

/* ═════════════ DayTypePicker：今日类型（取代智能安排） ═════════════ */
const DAY_TYPES = [
  { key: "work", label: "正常工作日", load: "100%", hint: "满负荷：青蛙 + 全部安排照跑，TODO 排满也没事" },
  { key: "low",  label: "低精力日",   load: "80%",  hint: "只保青蛙 + 一件要事，其余自动顺延不焦虑" },
  { key: "play", label: "游玩日",     load: "50%",  hint: "玩就是正事：只留一只小青蛙，其余别看" },
];
export function DayTypePicker({ today }: { today: string }) {
  const k = `peos.daytype.${today}`;
  const [v, setV] = useState<string>(() => localStorage.getItem(k) || "work");
  const cur = DAY_TYPES.find(d => d.key === v) || DAY_TYPES[0];
  return (
    <div className="daytype">
      <div className="dt-btns">
        {DAY_TYPES.map(d => (
          <button key={d.key} className={`pill ${v === d.key ? "on" : ""}`}
            onClick={() => { setV(d.key); localStorage.setItem(k, d.key); }}>
            {d.label} · {d.load}
          </button>
        ))}
      </div>
      <p className="jv-hint mono">今日容量 {cur.load} —— {cur.hint}</p>
    </div>
  );
}

/* ═════════════ NOW 卡：现在就做（CH1 首屏） ═════════════ */
export function NowCard({ rows }: { rows: SchedRow[] }) {
  const [, force] = useState(0);
  useEffect(() => { const iv = setInterval(() => force(x => x + 1), 30000); return () => clearInterval(iv); }, []);
  const nm = nowMin();
  const cur = rows.find(r => {
    const s = parseT((r.start || "").slice(0, 5)), e = parseT((r.end || r.start || "").slice(0, 5));
    return s <= nm && nm < e;
  });
  if (cur) {
    const left = Math.max(0, parseT((cur.end || cur.start).slice(0, 5)) - nm);
    const lh = Math.floor(left / 60);
    return (
      <div className="now-card">
        <div className="n-head mono">NOW · {cur.start}–{cur.end} · 还剩 {lh > 0 ? `${lh} 小时 ` : ""}{left % 60} 分</div>
        <div className="n-task">{cur.task || cur.block || "当前时段"}</div>
        {cur.goal && <div className="n-goal mono">目标 {cur.goal}</div>}
      </div>
    );
  }
  const next = rows.find(r => parseT((r.start || "").slice(0, 5)) > nm);
  return (
    <div className="now-card none">
      <div className="n-head mono">当前无安排</div>
      <div className="n-task">{next ? `下一件 ${next.start} · ${next.task || next.block}` : "时间表已走完 / 还没排——下面丢一句就行"}</div>
    </div>
  );
}

/* ═════════════ QuickCapture：丢给我（取代自定义任务） ═════════════ */
export function QuickCapture({ today, onChanged }: { today: string; onChanged: () => void }) {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<PTask[] | null>(null);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(""), 2400); };
  const patch = (i: number, p: Partial<PTask>) =>
    setParsed(prev => (prev ? prev.map((t, j) => (j === i ? { ...t, ...p } : t)) : prev));
  const commit = async () => {
    if (!parsed) return;
    let ok = 0, fail = 0;
    for (const t of parsed) {
      const end = fmtMin(parseT(t.time) + t.dur);
      try {
        const r = await api.taskAdd({ date: today, time: `${t.time}–${end}`, text: t.text, quad: t.quad });
        if (r && (r as { ok?: boolean }).ok === false) fail++; else ok++;
      } catch { fail++; }
    }
    setParsed(null); setRaw("");
    flash(`${ok} 件已上时间表${fail ? `（${fail} 件失败）` : ""}`);
    onChanged();
  };
  return (
    <div className="jv-nl">
      {msg && <div className="jv-toast mono">{msg}</div>}
      <textarea
        value={raw} onChange={e => setRaw(e.target.value)}
        placeholder={"一行一件：\n下午3点开会一小时\n写论文两小时（截止今天）\n健身"}
        rows={3}
      />
      <div className="jv-nl-actions">
        <button className="btn-solid" onClick={() => {
          const ts = parseAll(raw);
          if (!ts.length) { flash("先写点事进来"); return; }
          setParsed(ts);
        }}>解析并上时间表</button>
        <span className="jv-hint mono">自动判象限 · 写「截止」升重要 · 「下午3点」直接落位</span>
      </div>
      {parsed && (
        <div className="jv-preview">
          <div className="jv-ph mono">解析结果（{parsed.length} 件）——改完再落地</div>
          {parsed.map((t, i) => (
            <div key={i} className="jv-ptask">
              <div className="jv-pt-top">
                <span className="jv-pt-txt">{t.text}</span>
                <span className={`jv-prio p${t.prio}`}>{t.prio === 0 ? "高" : t.prio === 1 ? "中" : "低"}</span>
              </div>
              {t.flags.length > 0 && <div className="jv-flags">⚠️ {t.flags.join("；")}</div>}
              <div className="jv-pt-row">
                <input type="time" value={t.time} onChange={e => patch(i, { time: e.target.value })} />
                <select value={t.quad} onChange={e => patch(i, { quad: e.target.value })}>
                  <option value="q1">q1 重要·紧急</option>
                  <option value="q2">q2 重要·不紧急</option>
                  <option value="q3">q3 紧急·不重要</option>
                  <option value="q4">q4 可选</option>
                </select>
                <span className="mono jv-dur">{t.dur}min</span>
              </div>
            </div>
          ))}
          <div className="jv-pt-actions">
            <button className="btn-solid" onClick={commit}>全部写进时间表</button>
            <button className="btn-outline sm" onClick={() => setParsed(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════ 主组件：长期引擎（06 章） ═════════════ */
export default function JarvisBoard({ today, todayDaily, onChanged }: {
  today: string; todayDaily: Daily | null; onChanged: () => void;
}) {
  const [S, setS] = useState<JVState>(load);
  const [msg, setMsg] = useState("");
  const [capText, setCapText] = useState("");
  const [goalDraft, setGoalDraft] = useState<{ id: string; value: string }[]>([]);
  const [habitNew, setHabitNew] = useState("");
  const notified = useRef<Set<string>>(new Set());

  const save = (next: JVState) => { setS(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const day = () => { const t = todayStr(); if (!S.days[t]) S.days[t] = { captures: [], lateAdds: 0 }; return S.days[t]; };
  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(""), 2400); };

  /* 30s 轮询：整点任务桌面通知（手表日历为双保险） */
  useEffect(() => {
    const iv = setInterval(() => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const rows = todayDaily?.schedule || []; const nm = nowMin();
      rows.forEach(r => {
        const st = parseT((r.start || "").slice(0, 5));
        if (st === nm && !notified.current.has(r.start + r.task)) {
          notified.current.add(r.start + r.task);
          new Notification("PEOS · 到点了", { body: r.task });
        }
      });
    }, 30000);
    return () => clearInterval(iv);
  }, [todayDaily]);

  const insights = useMemo(() => {
    const out: { type: "good" | "warn" | "tip"; text: string }[] = [];
    const used = Object.keys(S.days).length;
    if (used < 2) out.push({ type: "tip", text: "先用 3 天，观察区会长出你的行为规律。" });
    const stale = S.goals.filter(g => g.target > 0 && g.log.length <= 1);
    if (stale.length) out.push({ type: "tip", text: `「${stale[0].name}」还没记过进展——长期的事，一周也要动一格。` });
    const gap = S.well.habits.find(h => { for (let i = 0; i < 3; i++) if (h.log[addDays(-i)]) return false; return true; });
    if (gap) out.push({ type: "warn", text: `「${gap.name}」连续 3 天没打卡了，今天补一个 10 分钟最小版。` });
    let backlog = 0; Object.values(S.days).forEach(d => { backlog += d.captures.length; });
    if (backlog >= 6) out.push({ type: "tip", text: `闪念箱积了 ${backlog} 条，花 3 分钟清一清：变任务或删掉。` });
    const late = Object.values(S.days).reduce((a, d) => a + (d.lateAdds || 0), 0);
    if (late >= 2) out.push({ type: "warn", text: `检测到 ${late} 次在 23:30 后还在排任务——睡眠红线，23:00 后只建议睡觉。` });
    if (todayDaily && !todayDaily.frogs?.length && todayDaily.total > 0)
      out.push({ type: "warn", text: "今日 Daily 还没写青蛙——三件事之外的都是杂音，先定那只青蛙。" });
    return out.slice(0, 4);
  }, [S, todayDaily]);

  /* 闪念箱 */
  const capture = () => {
    const v = capText.trim(); if (!v) return;
    if (nowMin() >= 23 * 60 + 30) { const d = day(); d.lateAdds = (d.lateAdds || 0) + 1; }
    const d = day(); d.captures.push({ id: uid(), text: v, time: fmtMin(nowMin()) });
    save({ ...S }); setCapText(""); flash("已收进闪念箱，回到正在做的事");
  };
  const capToTask = async (id: string) => {
    const c = day().captures.find(x => x.id === id); if (!c) return;
    const start = fmtMin(Math.ceil(nowMin() / 30) * 30);
    const end = fmtMin(parseT(start) + 45);
    await api.taskAdd({ date: today, time: `${start}–${end}`, text: c.text, quad: "q3" });
    const d = day(); d.captures = d.captures.filter(x => x.id !== id);
    save({ ...S }); flash("已变成 q3 任务，上了今日时间表"); onChanged();
  };
  const capDel = (id: string) => { const d = day(); d.captures = d.captures.filter(x => x.id !== id); save({ ...S }); };

  /* 长期目标 */
  const goalProg = (g: Goal) => (!g.target || g.target === g.start ? 0 : Math.max(0, Math.min(1, (g.current - g.start) / (g.target - g.start))));
  const goalCheck = (id: string) => {
    const g = S.goals.find(x => x.id === id); if (!g) return;
    const draft = goalDraft.find(d => d.id === id);
    const v = parseFloat(draft?.value || "");
    if (isNaN(v)) { flash("填个数字"); return; }
    g.current = v; g.log.push({ d: todayStr(), v });
    setGoalDraft(prev => prev.filter(d => d.id !== id));
    flash(`${g.name} 已记录 🌱`);
  };
  const goalNew = () => {
    S.goals.push({ id: uid(), name: "新目标", unit: "", start: 0, target: 10, current: 0, dir: 1, deadline: addDays(90), log: [{ d: todayStr(), v: 0 }] });
    save({ ...S });
  };
  const goalDel = (id: string) => save({ ...S, goals: S.goals.filter(g => g.id !== id) });
  const goalRename = (id: string, patchObj: Partial<Goal>) =>
    save({ ...S, goals: S.goals.map(g => (g.id === id ? { ...g, ...patchObj } : g)) });

  /* 身心灵 */
  const toggleHabit = (id: string, ds?: string) => {
    const d = ds || todayStr();
    const habits = S.well.habits.map(h => {
      if (h.id !== id) return h;
      const log = { ...h.log };
      if (log[d]) delete log[d]; else log[d] = true;
      return { ...h, log };
    });
    save({ ...S, well: { habits } });
  };
  const habitStreak = (h: Habit) => { let n = 0; for (let i = 0; i < 365; i++) { if (h.log[addDays(-i)]) n++; else if (i > 0) break; } return n; };
  const habitAdd = () => {
    const v = habitNew.trim(); if (!v) return;
    save({ ...S, well: { habits: [...S.well.habits, { id: uid(), name: v, log: {} }] } });
    setHabitNew("");
  };

  /* ⌚ .ics 同步（数据 = vault 今日时间表） */
  const syncICS = () => {
    const rows = todayDaily?.schedule || [];
    const icsDT = (hm: string) => today.replace(/-/g, "") + "T" + hm.replace(":", "") + "00";
    let ev = "";
    const mk = (st: string, en: string, title: string, desc?: string) => {
      ev += `BEGIN:VEVENT\nUID:${uid()}@peos\nDTSTART;TZID=Asia/Shanghai:${icsDT(st)}\nDTEND;TZID=Asia/Shanghai:${icsDT(en)}\nSUMMARY:${title}\n${desc ? `DESCRIPTION:${desc}\n` : ""}BEGIN:VALARM\nTRIGGER:-PT10M\nACTION:DISPLAY\nDESCRIPTION:PEOS提醒\nEND:VALARM\nEND:VEVENT\n`;
    };
    rows.forEach(r => {
      const st = (r.start || "").slice(0, 5), en = (r.end || r.start || "").slice(0, 5);
      if (!st) return;
      mk(st, en || st, r.task || r.block || "任务", r.goal ? `目标：${r.goal}` : undefined);
    });
    mk("22:30", "22:40", "睡前复盘", "导出 Obsidian + 明天的青蛙想好 + 长期目标看一眼");
    if (!ev) { flash("今日时间表还是空的，先排任务再同步"); return; }
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PEOS//CN\nCALSCALE:GREGORIAN\n${ev}END:VCALENDAR`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `PEOS-${today}.ics`; a.click();
    flash("日历文件已下载 → 双击导入 → 手表会震 ⌚");
  };
  const askNotify = () => {
    if (!("Notification" in window)) { flash("这个浏览器不支持通知"); return; }
    Notification.requestPermission().then(p => flash(p === "granted" ? "已开启本机提醒 ⌚ 双保险" : "被拒也没事，手表日历提醒更可靠"));
  };

  const captures = day().captures;
  const dates14 = Array.from({ length: 14 }, (_, i) => addDays(i - 13));

  return (
    <div className="jv">
      {msg && <div className="jv-toast mono">{msg}</div>}
      <div className="jv-grid">
        {/* 左列：观察 + 闪念箱 */}
        <div>
          <div className="col-head mono">👀 Jarvis 观察</div>
          {insights.map((i, k) => (
            <div key={k} className={`jv-ins ${i.type}`}><span className="jv-ic">{i.type === "good" ? "🌿" : i.type === "warn" ? "⚠️" : "💡"}</span><span>{i.text}</span></div>
          ))}
          <div className="jv-acts">
            <button className="mini-btn" onClick={askNotify}>🔔 本机提醒</button>
            <button className="mini-btn jv-gold" onClick={syncICS}>⌚ 同步今日到苹果日历</button>
            <span className="mono jv-xp">积分沿用成就系统：任务 / 青蛙 / 日记 / 数据 自动计分</span>
          </div>

          <div className="col-head mono" style={{ marginTop: 30 }}>闪念箱——被吸走的注意力，1 秒存这里</div>
          <div className="jv-cap">
            <input
              value={capText} onChange={e => setCapText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") capture(); }}
              placeholder="闯进脑子的念头，写下来就走。存了 ≠ 要做。"
            />
            <button className="mini-btn jv-gold" onClick={capture}>✦ 抓一下</button>
          </div>
          {captures.length === 0 && <p className="muted">空的——干净。</p>}
          {captures.map(c => (
            <div key={c.id} className="jv-cap-row">
              <span className="jv-cap-t">{c.text}</span>
              <span className="mono jv-cap-time">{c.time}</span>
              <button className="mini-btn" onClick={() => capToTask(c.id)}>变任务</button>
              <button className="mini-btn" onClick={() => capDel(c.id)}>×</button>
            </div>
          ))}
        </div>

        {/* 右列：长期目标 + 身心灵 */}
        <div>
          <div className="col-head mono">
            🌱 长期项目追踪（半年框架 seeded）
            <button className="mini-btn" onClick={goalNew} style={{ marginLeft: "auto" }}>＋ 新目标</button>
          </div>
          {S.goals.map(g => {
            const pctv = Math.round(goalProg(g) * 100);
            const draft = goalDraft.find(d => d.id === g.id);
            return (
              <div key={g.id} className="jv-goal">
                <div className="jv-g-top">
                  <input
                    className="jv-g-name" value={g.name}
                    onChange={e => goalRename(g.id, { name: e.target.value })}
                    aria-label="目标名"
                  />
                  <span className="mono jv-g-dead">截 {g.deadline.slice(5)}</span>
                  <button className="mini-btn" onClick={() => goalDel(g.id)}>×</button>
                </div>
                <div className="jv-g-mid">
                  <span className="jv-g-val"><b>{g.current}</b> / {g.target} {g.unit} · {pctv}%</span>
                  <Spark2 log={g.log} />
                </div>
                <div className="jv-gbar"><i style={{ width: `${pctv}%` }} /></div>
                <div className="jv-g-check">
                  {draft ? (
                    <>
                      <input
                        type="number" step="0.1" autoFocus value={draft.value}
                        onChange={e => setGoalDraft(prev => prev.map(d => (d.id === g.id ? { ...d, value: e.target.value } : d)))}
                        onKeyDown={e => { if (e.key === "Enter") goalCheck(g.id); }}
                        placeholder={`现在的${g.unit || "值"}`}
                      />
                      <button className="mini-btn jv-gold" onClick={() => goalCheck(g.id)}>记录</button>
                    </>
                  ) : (
                    <button className="mini-btn" onClick={() => setGoalDraft(prev => [...prev, { id: g.id, value: String(g.current) }])}>＋ 记一笔进展</button>
                  )}
                </div>
              </div>
            );
          })}

          <div className="col-head mono" style={{ marginTop: 30 }}>🧘 身心灵日签（近 14 天）</div>
          <div className="jv-habits">
            <div className="jv-date-lbl mono">{dates14.map(ds => <span key={ds}>{ds.slice(8)}</span>)}</div>
            {S.well.habits.map(h => (
              <div key={h.id} className="jv-habit-row">
                <span className="jv-h-name">{h.name}</span>
                <span className="mono jv-h-streak">🔥{habitStreak(h)}</span>
                <div className="jv-dots">
                  {dates14.map(ds => (
                    <button
                      key={ds}
                      className={`jv-dot ${h.log[ds] ? "on" : ""} ${ds === today ? "today" : ""}`}
                      onClick={() => toggleHabit(h.id, ds)}
                      aria-label={`${h.name} ${ds}`}
                    >{h.log[ds] ? "✓" : ""}</button>
                  ))}
                </div>
              </div>
            ))}
            <div className="jv-habit-add">
              <input value={habitNew} onChange={e => setHabitNew(e.target.value)} onKeyDown={e => { if (e.key === "Enter") habitAdd(); }} placeholder="＋ 加一个习惯：拉伸 / 日记 / 发呆 10 分钟" />
              <button className="mini-btn" onClick={habitAdd}>加入</button>
            </div>
            <p className="jv-hint mono">空圈 = 今天还没喂。点格子可补打卡——长线的事，断了捡回来就行，不惩罚。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
