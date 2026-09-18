import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { fmtDate, pct } from "./api";
import { useEngine, useFinance, useOverview, useReducedMotion } from "./hooks";
import Nav from "./components/Nav";
import Section from "./components/Section";
import WeatherBar from "./components/WeatherBar";
import ScheduleRail from "./components/ScheduleRail";
import SmartPlan from "./components/SmartPlan";
import ProgressPanel from "./components/ProgressPanel";
import GameBoard from "./components/GameBoard";
import { TaskComposer, TodayTodos } from "./components/TodayTodos";
import DailyDataForm from "./components/DailyDataForm";
import Radar from "./components/Radar";
import Spark from "./components/Spark";
import FinanceBoard from "./components/FinanceBoard";
import MediaBoard from "./components/MediaBoard";
import TopicsBoard from "./components/TopicsBoard";
import CalibrationFlow from "./components/CalibrationFlow";
import { AgentChat, DiaryEditor, DiaryStream } from "./components/Review";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  const { data: d, error, reload } = useOverview();
  const { data: fin, reload: finReload } = useFinance();
  const engine = useEngine();
  const reduced = useReducedMotion();

  /* GSAP 场景装配 */
  useEffect(() => {
    if (reduced) return;
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach(el => {
        gsap.fromTo(el, { y: 64, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 82%" } });
      });
      gsap.utils.toArray<HTMLElement>(".ghost").forEach(el => {
        gsap.fromTo(el, { yPercent: 16 }, { yPercent: -16, ease: "none",
          scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: 1.2 } });
      });
      gsap.utils.toArray<HTMLElement>(".chapter").forEach(sec => {
        ScrollTrigger.create({
          trigger: sec, start: "top 55%", end: "bottom 45%",
          onToggle: self => self.isActive && (document.body.dataset.scene = sec.id),
        });
      });
    });
    return () => ctx.revert();
  }, [reduced, d]);

  if (error) return <div className="boot-error">读取失败：{error}<br /><span className="muted">确认 server.py 运行中 · config.json → vault_root 正确</span></div>;
  if (!d) return <div className="boot mono">SYNCING VAULT<span className="dots" /></div>;

  const today = d.today_daily;
  const rich = d.latest_rich_daily;
  const showDaily = today && today.total > 0 ? today : rich;
  const schedSrc = today?.schedule?.length
    ? { rows: today.schedule, frogs: today.frogs || [], isToday: true, dateLabel: "" }
    : rich?.schedule?.length
      ? { rows: rich.schedule, frogs: rich.frogs || [], isToday: false, dateLabel: fmtDate(rich.date) }
      : null;
  const q = d.config.quadrants;
  const todayWeek = d.week.find(w => w.date === d.today);

  return (
    <div className="stage">
      <Nav />

      {/* ───── CH1 今日 · 日程 ───── */}
      <Section id="today" index="01">
        <WeatherBar />
        <div className="today-grid">
          <div className="today-left">
            <div className="t-date">{fmtDate(d.today)}</div>
            {!today && <div className="t-banner">⏳ 今日 Daily 未创建 —— 日程表显示最近一篇（{rich ? fmtDate(rich.date) : "无"}）；写日记或填身体数据会自动创建</div>}
            <div className="t-focus">
              <div className="col-head mono">今日焦点</div>
              {showDaily?.frogs?.length
                ? showDaily.frogs.map((f, i) => <div key={i} className="frog">🐸 {f}</div>)
                : <p className="muted">这篇 Daily 没有写青蛙（最重要的事放上午做完，可写 1–3 只）</p>}
              {showDaily?.conclusion && <p className="concl mono">「{showDaily.conclusion}」</p>}
            </div>
            <div className="t-engine">
              <div className="col-head mono">智能安排 · 填两个数就好</div>
              <SmartPlan onPlanned={reload} budget={fin?.daily_budget ?? 100} spent={today?.spend} />
            </div>
            <div className="t-todos">
              <div className="col-head mono">今日 TODO · 按四象限 · 点击勾选</div>
              <TodayTodos daily={today} onChanged={reload} />
              <div className="col-head mono" style={{ marginTop: 22 }}>自定义任务 · 挑时间上时间表</div>
              <TaskComposer date={d.today} onAdded={reload} />
            </div>
            <div className="t-data">
              <div className="col-head mono">今日数据 · 网页直填（写入 Daily）</div>
              <DailyDataForm today={d.today} daily={today} onSaved={reload} />
            </div>
          </div>
          <div className="today-right" data-reveal>
            <div className="col-head mono">时间表 · 按时间排布</div>
            {schedSrc
              ? <ScheduleRail rows={schedSrc.rows} frogs={schedSrc.frogs} isToday={schedSrc.isToday} dateLabel={schedSrc.dateLabel} todayCourses={d.today_courses || []} todayDeadlines={d.today_deadlines || []} />
              : <p className="muted">最近一篇 Daily 没有可解析的总览主表。</p>}
            <div style={{ marginTop: 34 }}>
              <ProgressPanel fitness={d.fitness} onChanged={reload} />
            </div>
          </div>
        </div>
      </Section>

      {/* ───── CH2 管道（待写 + 截止；任务勾选在今日页，不再重复） ───── */}
      <Section id="tasks" index="02">
        <div className="tasks-grid">
          <div data-reveal>
            <div className="col-head mono">内容管道 · 我的待写（手动维护）</div>
            <TopicsBoard />
            <div className="col-head mono" style={{ marginTop: 28 }}>已发布参考</div>
            {d.content.recent_published.slice(0, 5).map((p, i) => (
              <div key={i} className="todo-row"><span className="mono tr-st">{p.date}</span>
                <span className="tr-t">{p.topic}</span></div>
            ))}
          </div>
          <div data-reveal>
            <div className="col-head mono">近期截止</div>
            {d.timeline.length ? d.timeline.map((t, i) => (
              <div key={i} className="todo-row"><span className="mono tr-st">{t.date.slice(5)}</span>
                <span className="tr-t">{t.item}</span>
                <span className="mono tr-p muted">{t.days_away === 0 ? "今天" : `${t.days_away} 天`}</span></div>
            )) : <p className="muted">60 天内没有既定截止。</p>}
          </div>
        </div>
      </Section>

      {/* ───── CH3 财务 ───── */}
      <Section id="finance" index="03">
        <FinanceBoard fin={fin} reload={finReload} />
      </Section>

      {/* ───── CH4 书影 ───── */}
      <Section id="media" index="04">
        <MediaBoard />
      </Section>

      {/* ───── CH5 复盘 ───── */}
      <Section id="review" index="05">
        <div className="review-grid">
          <div data-reveal>
            <div className="col-head mono">今日日记</div>
            <DiaryEditor today={d.today} initial={today?.diary || ""} onSaved={reload} />
            <div className="col-head mono" style={{ marginTop: 28 }}>判断顺序</div>
            <p className="mono order-line">{d.config.decision_order.map(o => o.name).join(" → ")}</p>
            <div className="col-head mono" style={{ marginTop: 28 }}>决策 Agent</div>
            <AgentChat engineState={engine.state as unknown as Record<string, unknown>} />
          </div>
          <div data-reveal>
            <div className="col-head mono">日记流 · 近 30 天 · 点击看全文</div>
            <DiaryStream cards={d.diary_cards} />
          </div>
        </div>
      </Section>

      {/* ───── CH6 成就（地球 Online） ───── */}
      <Section id="game" index="06">
        <GameBoard />
      </Section>

      {/* ───── CH7 状态与差距（长期计划 · 月度校准） ───── */}
      <Section id="state" index="07">
        <CalibrationFlow onSaved={reload} />
        <div className="state-grid">
          <div className="state-left" data-reveal>
            <Radar items={q.items} />
            <div className="total-line">
              <span className="tnum">{q.current_total}</span>
              <span className="tarrow mono">→</span>
              <span className="tnum mid">{q.after90_total}</span>
              <span className="tarrow mono">→</span>
              <span className="tnum dim">5.0</span>
            </div>
            <p className="muted center">当前 · 90天目标 · 理想 —— 距理想 <b className="w">{(q.ideal_total - q.current_total).toFixed(1)}</b> 分</p>
          </div>
          <div className="state-right">
            {q.items.map(item => (
              <div key={item.id} className="quad-row" data-reveal>
                <div className="qr-head">
                  <span className="qr-icon">{item.icon}</span>
                  <span className="qr-name">{item.name}</span>
                  <span className="qr-score">{item.current}<i>/{item.ideal}.0</i></span>
                </div>
                <div className="qr-track"><i style={{ width: `${pct(item.current, 5)}%` }} /><em style={{ left: `${pct(item.after90, 5)}%` }} /></div>
                <p className="qr-diag">{item.diagnosis}</p>
                <p className="qr-act"><b className="mono">补课 · {item.kpi_weekly}</b>{item.action}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="state-bottom">
          <div data-reveal><div className="col-head mono">体重 kg</div><Spark rows={d.body_trend} k="weight" label="体重" /></div>
          <div data-reveal><div className="col-head mono">心情 1–5</div><Spark rows={d.body_trend} k="mood" digits={0} label="心情" /></div>
          <div data-reveal><div className="col-head mono">睡眠 h</div><Spark rows={d.body_trend} k="sleep_hours" label="睡眠" /></div>
          <div data-reveal>
            <div className="col-head mono">健身 · {d.fitness.plan}</div>
            <div className="fit-line"><span className="fin-num">W{d.fitness.week_no}<i>/{d.fitness.weeks}</i></span>
              <span className="muted mono">{d.fitness.weight_start}kg → {d.fitness.weight_target}kg{d.fitness.latest_weight ? ` · 最新 ${d.fitness.latest_weight}kg` : " · 待记录"}</span></div>
            <div className="col-head mono" style={{ marginTop: 18 }}>本周 KPI</div>
            {d.config.kpi_weekly.targets.map(t => (
              <div key={t.id} className="kpi-row"><span className="k-name">{t.label}</span>
                <span className="k-bar"><i style={{ width: `${pct(d.kpi_counts[t.id] || 0, t.target)}%` }} /></span>
                <span className="mono k-num">{d.kpi_counts[t.id] || 0}/{t.target}</span></div>
            ))}
          </div>
        </div>
      </Section>

      <footer className="footer mono">
        PEOS v2.1 · 数据源 <code>obsidian x cc/vault</code>（勾选/日记段/身体数据外只读）· 分数口径 HUMAN3.0 v3 · 理想 5 分制
        <br />黑色数字剧场 · 原创像素视觉 · 本地运行 127.0.0.1:8790
      </footer>
    </div>
  );
}
