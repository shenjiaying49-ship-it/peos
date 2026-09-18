import { useEffect, useState } from "react";
import { type SchedRow, type CourseBlock, type Deadline } from "../api";

const MAP: [string, string][] = [["🔴", "▰▰▰"], ["🟠", "▰▰▰"], ["🟡", "▰▰"], ["🟢", "▰"], ["🔵", "▰"]];
const energy = (s: string) => MAP.reduce((a, [e, b]) => a.replace(e, b), s || "");
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** 时间轴：青蛙区 + 课程块 + 时间块 + 缓冲 + 「现在」高亮。首页与任务章节共用。 */
export default function ScheduleRail({ rows, frogs, isToday, dateLabel, todayCourses, todayDeadlines }: {
  rows: SchedRow[]; frogs: string[]; isToday: boolean; dateLabel: string;
  todayCourses?: CourseBlock[]; todayDeadlines?: Deadline[];
}) {
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 30_000);
    return () => clearInterval(t);
  }, []);

  const h = new Date().getHours();
  const morning = h >= 6 && h < 12;
  const fzState = h < 6 ? "🌙 凌晨 —— 先睡，青蛙等早上的你"
    : morning ? "🌅 上午窗口进行中 —— 现在就做青蛙"
    : "🌤 已过上午 —— 青蛙顺延为下午第一优先级";

  // 把课程块插入时间表
  const allBlocks: (SchedRow | CourseBlock | { buffer: number })[] = [];

  // 先排序课程和常规行
  const courseAsRow: (SchedRow | CourseBlock)[] = (todayCourses || []).map(c => ({
    __isCourse: true, code: c.code, name: c.name, start: c.start, end: c.end,
    location: c.location, session: c.session,
  } as unknown as SchedRow));

  const merged: { start: string; item: SchedRow | CourseBlock }[] = [];
  for (const r of rows) merged.push({ start: r.start, item: r });
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
      <div className={`frog-zone ${morning && isToday ? "am" : ""}`}>
        <div className="fz-head">🐸 今日青蛙 <span className="fz-sub">最重要的事 · 上午做完（1–3 只）</span></div>
        {frogs.length ? frogs.map((f, i) => <div key={i} className="fz-item">▸ {f}</div>)
          : <div className="fz-item muted">这篇 Daily 没写青蛙</div>}
        {isToday && <div className="fz-state">{fzState}</div>}
      </div>
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
          return (
            <div key={`s${i}`} className={`sched-row ${cur ? "now" : ""}`}>
              <span className="s-time">{row.start}<br /><span className="s-end">{row.end}</span></span>
              <span className="s-rail"><i /></span>
              <span className="s-body">
                <span className="s-head">{cur && <em className="now-chip">现在</em>}{row.task}</span>
                <span className="s-meta">{energy(row.energy)}{row.type ? ` · ${row.type}` : ""}</span>
                {row.goal && <span className="s-goal">完成线：{row.goal}</span>}
              </span>
            </div>
          );
        })())}
    </div>
  );
}
