import { useEffect, useState } from "react";
import { api, type SchedRow, type CourseBlock, type Deadline, type CalendarInfo } from "../api";
import { HALF_HOURS, PRIOS, QUADS, prioOf, quadOfSection, withMarker } from "./TodayTodos";

const MAP: [string, string][] = [["🔴", "▰▰▰"], ["🟠", "▰▰▰"], ["🟡", "▰▰"], ["🟢", "▰"], ["🔵", "▰"]];
const energy = (s: string) => MAP.reduce((a, [e, b]) => a.replace(e, b), s || "");
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const toHM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${min % 60 ? "30" : "00"}`;

/* 时间线上的任务编辑弹层（点时间 / ✏️ 打开；quad 仅在用户显式改过时才提交，避免误搬分区） */
function RailEditForm({ row, date, onDone, onError }: {
  row: SchedRow; date: string; onDone: () => void; onError: (e: string) => void;
}) {
  const [text, setText] = useState(row.task.replace(/^[⭐⚡💤]\s*/, ""));
  const [start, setStart] = useState(row.start);
  const [end, setEnd] = useState(row.end);
  const [quad0] = useState(() => quadOfSection(row.type));
  const [quad, setQuad] = useState(quad0);
  const [prio, setPrio] = useState(prioOf(row.task));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api.taskEdit({
      date, task: row.task, old_time: `${row.start}–${row.end}`,
      text: withMarker(text.trim(), prio), time: `${start}–${end}`,
      quad: quad !== quad0 ? quad : undefined,
    });
    setBusy(false);
    if (!r.ok) onError(r.error || "保存失败");
    else onDone();
  };

  return (
    <div className="rail-edit" onClick={e => e.stopPropagation()}>
      <input value={text} onChange={e => setText(e.target.value)} autoFocus
        onKeyDown={e => e.key === "Enter" && save()} placeholder="任务内容…" aria-label="任务内容" />
      <div className="cp-row" style={{ marginTop: 8 }}>
        <select value={start} onChange={e => setStart(e.target.value)} aria-label="开始时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="mono cp-dash">–</span>
        <select value={end} onChange={e => setEnd(e.target.value)} aria-label="结束时间">
          {HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="pill-row">
        {QUADS.map(q => (
          <button key={q.key} type="button" className={`pill ${quad === q.key ? "on" : ""}`}
            onClick={() => setQuad(q.key)}>{q.label}</button>
        ))}
      </div>
      <div className="pill-row">
        {PRIOS.map(p => (
          <button key={p.key} type="button" className={`pill ${prio === p.key ? "on" : ""}`}
            onClick={() => setPrio(p.key)}>{p.label}</button>
        ))}
      </div>
      <div className="cp-row" style={{ marginTop: 10 }}>
        <button className="btn-solid" onClick={save} disabled={busy}>{busy ? "…" : "保存"}</button>
        <button className="cp-cancel" onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

/** 时间轴：今日重点区 + 课程块 + 时间块 + 缓冲 + 「现在」高亮。
 *  任务块可拖拽换时段（对齐半小时）、±30min 微调、点击时间编辑（参考飞书日历）。 */
export default function ScheduleRail({ rows, isToday, dateLabel, todayCourses, todayDeadlines, calendar, date, onChanged }: {
  rows: SchedRow[]; isToday: boolean; dateLabel: string;
  todayCourses?: CourseBlock[]; todayDeadlines?: Deadline[];
  calendar?: CalendarInfo;
  date?: string; onChanged?: () => void;
}) {
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 30_000);
    return () => clearInterval(t);
  }, []);

  const mutate = async (args: { task: string; old_time: string; time?: string; text?: string; quad?: string }) => {
    if (!date) { setErr("缺少日期，无法保存"); return false; }
    const r = await api.taskEdit({ date, ...args });
    if (!r.ok) { setErr(r.error || "保存失败"); return false; }
    setErr("");
    onChanged?.();
    return true;
  };

  /* 拖拽落地：把 src 挪到 target 的开始时间，时长不变 */
  const reschedule = async (fromRows: number, target: SchedRow) => {
    const src = rows[fromRows];
    if (!src || (src as unknown) === (target as unknown)) return;
    const dur = toMin(src.end) - toMin(src.start);
    const ns = toMin(target.start);
    if (ns === toMin(src.start)) return;
    const ne = Math.min(ns + dur, 23 * 60 + 30);
    await mutate({ task: src.task, old_time: `${src.start}–${src.end}`, time: `${target.start}–${toHM(ne)}` });
  };

  /* ±30 分钟微调 */
  const shift = async (row: SchedRow, delta: number) => {
    const ns = Math.max(0, Math.min(23 * 60 + 30, toMin(row.start) + delta));
    const ne = Math.max(30, Math.min(23 * 60 + 60, toMin(row.end) + delta));
    if (ns === toMin(row.start) && ne === toMin(row.end)) return;
    await mutate({ task: row.task, old_time: `${row.start}–${row.end}`, time: `${toHM(ns)}–${toHM(ne)}` });
  };

  const h = new Date().getHours();
  const morning = h >= 6 && h < 12;
  const fzState = h < 6 ? "🌙 凌晨 —— 先睡，重点等早上的你"
    : morning ? "🌅 上午窗口进行中 —— 现在就做今日重点"
    : "🌤 已过上午 —— 重点顺延为下午第一优先级";

  // 把课程块插入时间表
  const allBlocks: (SchedRow | CourseBlock | { buffer: number })[] = [];

  // 先排序课程和常规行
  const courseAsRow: (SchedRow | CourseBlock)[] = (todayCourses || []).map(c => ({
    __isCourse: true, code: c.code, name: c.name, start: c.start, end: c.end,
    location: c.location, session: c.session,
  } as unknown as SchedRow));

  const merged: { start: string; item: SchedRow | CourseBlock }[] = [];
  rows.forEach((r, i) => merged.push({ start: r.start, item: Object.assign({}, r, { _ridx: i }) }));
  for (const c of courseAsRow) merged.push({ start: (c as unknown as CourseBlock).start, item: c });
  merged.sort((a, b) => toMin(a.start) - toMin(b.start));

  merged.forEach((m, i) => {
    if (i > 0) {
      const prevEnd = "end" in merged[i - 1].item
        ? toMin((merged[i - 1].item as any).end)
        : toMin((merged[i - 1].item as SchedRow).end);
      const curStart = toMin(m.start);
      const gap = curStart - prevEnd;
      if (gap > 5 && gap <= 180) allBlocks.push({ buffer: gap });
    }
    allBlocks.push(m.item);
  });

  if (!rows.length && !todayCourses?.length)
    return <p className="muted">{dateLabel} 没有可解析的总览主表（Daily 里需要「## 总览主表」表格）</p>;

  const isCourseBlock = (x: any): x is CourseBlock => x && typeof x === "object" && "__isCourse" in x;

  return (
    <div className="rail">
      {!isToday && !todayCourses?.length && <div className="rail-note mono">⏳ 今日无时间表 —— 显示 {dateLabel} 的总览主表</div>}

      {/* 今日截止提醒 */}
      {todayDeadlines && todayDeadlines.length > 0 && (
        <div className="deadline-banner">
          <span className="dl-head">📋 今日截止</span>
          {todayDeadlines.map((dl, i) => (
            <div key={i} className="dl-item">
              <span className="dl-course">{dl.course_name}</span>
              <span className="dl-task">{dl.item}</span>
              {dl.weight && <span className="dl-weight">（{dl.weight}）</span>}
              {dl.note && <span className="dl-note">—— {dl.note}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 校历放假 / 调休提示 */}
      {isToday && calendar?.is_holiday && (
        <div className="holiday-banner">
          <span className="hl-head">🏮 校历放假 · 今日无课</span>
          <span className="hl-sub">假期任务照常记录；课程自动顺延，出勤分只按真实上课日计算</span>
        </div>
      )}
      {isToday && calendar?.is_makeup && (
        <div className="holiday-banner makeup">
          <span className="hl-head">🔄 调休补课日</span>
          <span className="hl-sub">今天按周{["一", "二", "三", "四", "五"][calendar.makeup_weekday! - 1]}课表上课</span>
        </div>
      )}

      {err && <p className="err">{err}</p>}

      {allBlocks.map((row, i) =>
        "buffer" in row ? (
          <div key={`b${i}`} className="sched-row buffer">
            <span className="s-time" />
            <span className="s-rail"><i /></span>
            <span className="s-body"><span className="s-meta">⏸ 缓冲 {row.buffer}min —— 切换 / 迟到保护 / 走神额度</span></span>
          </div>
        ) : isCourseBlock(row) ? (
          <div key={`c${i}`} className="sched-row course-block">
            <span className="s-time">{row.start}<br /><span className="s-end">{row.end}</span></span>
            <span className="s-rail"><i className="course-dot" /></span>
            <span className="s-body">
              <span className="s-head">📚 {row.code} {row.name}</span>
              <span className="s-meta">📍 {row.location}{row.session ? ` · ${row.session}` : ""}</span>
            </span>
          </div>
        ) : (() => {
          const cur = isToday && nowMin >= toMin(row.start) && nowMin < toMin(row.end);
          const ridx = (row as any)._ridx as number;
          const editing = editKey === `s${i}`;
          return (
            <div key={`s${i}`}
              className={`sched-row ${cur ? "now" : ""} ${dragFrom === ridx ? "dragging" : ""} ${dragFrom !== null && dragFrom !== ridx && overKey === `s${i}` ? "drop-target" : ""}`}
              draggable={!editing}
              onDragStart={e => {
                e.dataTransfer.setData("text/plain", String(ridx));
                e.dataTransfer.effectAllowed = "move";
                setDragFrom(ridx);
              }}
              onDragEnd={() => { setDragFrom(null); setOverKey(null); }}
              onDragOver={e => {
                if (dragFrom === null || dragFrom === ridx) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverKey(`s${i}`);
              }}
              onDragLeave={() => setOverKey(k => (k === `s${i}` ? null : k))}
              onDrop={e => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                setDragFrom(null); setOverKey(null);
                void reschedule(from, row as SchedRow);
              }}>
              <span className="s-time" title="点击编辑时间 / 内容"
                onClick={() => { setEditKey(editing ? null : `s${i}`); setErr(""); }}>
                {row.start}<br /><span className="s-end">{row.end}</span>
              </span>
              <span className="s-rail"><i /></span>
              <span className="s-body">
                {editing ? (
                  <RailEditForm row={row as SchedRow} date={date || ""}
                    onDone={() => setEditKey(null)}
                    onError={e => { setEditKey(null); setErr(e); }} />
                ) : (
                  <>
                    <span className="s-head"><span className="grip" title="拖动调整时间">⠿</span>
                      {cur && <em className="now-chip">现在</em>}{(row as SchedRow).task}</span>
                    <span className="s-meta">{energy((row as SchedRow).energy)}{(row as SchedRow).type ? ` · ${(row as SchedRow).type}` : ""}</span>
                    {(row as SchedRow).goal && <span className="s-goal">完成线：{(row as SchedRow).goal}</span>}
                    <span className="rail-ops">
                      <button className="mini-btn" title="提前 30 分钟" onClick={() => void shift(row as SchedRow, -30)}>−30</button>
                      <button className="mini-btn" title="推后 30 分钟" onClick={() => void shift(row as SchedRow, +30)}>+30</button>
                      <button className="mini-btn" title="编辑任务" onClick={() => { setEditKey(`s${i}`); setErr(""); }}>✏️</button>
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })())}
    </div>
  );
}
