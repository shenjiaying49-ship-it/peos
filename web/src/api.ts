/* PEOS v2 — API 层：与 peos/server.py 完全对接 */

export interface Task { text: string; raw: string; done: boolean; section: string }
export interface WeekDay { date: string; weekday: string; total: number; done: number; incomplete: string[]; tasks: Task[] }
export interface SchedRow { block: string; start: string; end: string; energy: string; task: string; type: string; goal: string }
export interface Daily {
  date: string; total: number; done: number; weight?: number | null; mood?: number | null;
  sleep_hours?: number | null; water?: number | null; protein?: number | null; spend?: number | null;
  frog?: string; frogs?: string[];
  conclusion?: string; not_today?: string; diary?: string; schedule?: SchedRow[];
  tasks_by_section?: { section: string; tasks: Task[] }[];
}
export interface Quad { id: string; name: string; icon: string; current: number; after90: number; ideal: number; stage: string; diagnosis: string; action: string; kpi_weekly: string }
export interface DiaryCard { date: string; weekday: string; emoji: string; summary: string; rating: number; comment: string; done: number; total: number }
export interface CourseBlock { code: string; name: string; start: string; end: string; location: string; session: string; weekday_cn: string; is_makeup?: boolean }
export interface Deadline { date: string; days_away: number; course: string; course_name: string; item: string; weight?: number | null; note: string; weekday_cn: string }
export interface CalendarInfo { is_holiday: boolean; is_makeup: boolean; makeup_weekday: number | null; holidays: string[] }
export interface Overview {
  today: string; today_daily: Daily | null; latest_daily: Daily | null; latest_rich_daily: Daily | null;
  week: WeekDay[]; body_trend: Record<string, any>[]; diary_cards: DiaryCard[];
  content: { stats: Record<string, number>; todo: { topic: string; status: string; plan: string }[]; recent_published: { topic: string; date: string }[] };
  timeline: { date: string; days_away: number; item: string }[];
  today_courses: CourseBlock[];
  upcoming_deadlines: Deadline[];
  today_deadlines: Deadline[];
  calendar?: CalendarInfo;
  decisions: { date: string; text: string }[];
  kpi_counts: Record<string, number>;
  fitness: Record<string, any>;
  config: {
    user: { name: string; identity: string };
    quadrants: { current_total: number; after90_total: number; ideal_total: number; items: Quad[] };
    kpi_weekly: { targets: { id: string; label: string; target: number }[] };
    semester: { name: string; start: string; end: string; goals: { id: string; label: string; status: string; note?: string }[] };
    decision_order: { id: string; name: string; desc: string }[];
  };
}
export interface Finance {
  ok: boolean; month: string; month_in: number; month_out: number; month_net: number;
  balance: number | null; records: { id: string; date: string; type: "in" | "out"; amount: number; category: string; note: string }[];
  daily_spend: { date: string; spend: number }[]; notes: string[]; opening_balance: number | null;
  daily_budget: number;
}
export interface WeatherPack {
  weather: { ok: boolean; city?: string; temp?: number; desc?: string; emoji?: string; tmax?: number; tmin?: number; rain?: number; error?: string };
  quote: { text: string; author: string } | null;
}
export interface MediaItem { id: string; date: string; type: "book" | "show"; title: string; rating: number; review: string; }

export interface GameState {
  ok: boolean; points: number; base: number; ach_pts: number; spent: number;
  breakdown: Record<string, number>;
  streak: number; streak_bonus: number;
  level: { name: string; index: number; next: number | null; next_name: string | null };
  level_skills: string[];
  stats: Record<string, number>;
  unlocked: string[]; achievements: any[];
  earth_today: { idx: number; text: string; done: boolean }[];
  earth_done_total: number;
  earth_today_date: string;
  rewards: { id: string; label: string; cost: number; tier: string; pool?: string }[];
  pools: Record<string, { cap: number; used: number; reset: string }>;
  rewards_tiered: Record<string, { name: string; items: { id: string; label: string; cost: number; tier: string; pool?: string }[] }>;
  ledger: { ts: string; kind: string; points: number; label: string }[];
  month_net: number | null;
  precommitments: { id: string; label: string; stake: number; days: number; start: string; frogs_required: number; frogs_done: number; resolved: boolean }[];
  double_days_remaining: string[];
  surprise_available: boolean;
  surprise_pending: { task: string; bonus: number } | null;
}

export interface DayContext {
  id?: string; start?: string; end?: string; location?: string; mode?: string;
  summary?: string; fixed?: string[]; work_policy?: Record<string, any>;
  date: string; day?: number; days?: number; active: boolean;
}

export interface ProgressSuggestion {
  id: string; kind: string; title: string; current: number; total: number;
  suggested: number; unit: string; text: string;
}

export interface PlanContextFields {
  focus?: string; dahao_stage?: string; fixed?: string; limitation?: string;
}

export const api = {
  overview: (): Promise<Overview> => fetch("/api/overview").then(r => r.json()),
  toggle: (b: { date: string; section: string; raw: string; done: boolean }) =>
    fetch("/api/task/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  diaryGet: (date: string) =>
    fetch(`/api/diary?date=${date}`).then(r => r.json()) as Promise<{ ok: boolean; full: string }>,
  diarySave: (date: string, text: string) =>
    fetch("/api/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, text }) }).then(r => r.json()),
  ask: (question: string, engine_state: Record<string, unknown>) =>
    fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, engine_state }) }).then(r => r.json()),
  finance: (): Promise<Finance> => fetch("/api/finance").then(r => r.json()),
  financeAdd: (b: { type: "in" | "out"; amount: number; category: string; note: string; date: string }) =>
    fetch("/api/finance/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  financeDel: (id: string) =>
    fetch("/api/finance/record/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json()),
  weather: (): Promise<WeatherPack> => fetch("/api/weather").then(r => r.json()),
  media: (): Promise<{ items: MediaItem[] }> => fetch("/api/media").then(r => r.json()),
  mediaAdd: (b: { type: "book" | "show"; title: string; rating: number; review: string; date: string }) =>
    fetch("/api/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  mediaDel: (id: string) =>
    fetch("/api/media/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json()),
  dailyData: (date: string, fields: Record<string, number | "">) =>
    fetch("/api/daily-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, ...fields }) }).then(r => r.json()),
  topics: (): Promise<{ items: { id: string; date: string; text: string; note: string; done: boolean }[] }> =>
    fetch("/api/topics").then(r => r.json()),
  topicAdd: (b: { text: string; note: string; date: string }) =>
    fetch("/api/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  topicToggle: (id: string) =>
    fetch("/api/topics/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json()),
  topicDel: (id: string) =>
    fetch("/api/topics/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json()),
  calibration: () => fetch("/api/calibration").then(r => r.json()),
  calibrationSave: (b: { answers: Record<string, string>; scores: Record<string, number> }) =>
    fetch("/api/calibration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  plan: (energy: number, sleep: number, ctx?: PlanContextFields): Promise<{
    ok: boolean; tier?: string; frogs?: string[]; tasks?: number;
    sched_from?: string | null; error?: string;
    day_context?: DayContext; work_context?: Record<string, string>;
    progress_suggestions?: ProgressSuggestion[];
    strength_day?: boolean; strength_text?: string | null; book_show?: string;
  }> =>
    fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ energy, sleep, ...ctx }) }).then(r => r.json()),
  progress: (): Promise<{ items: { id: string; kind: "book" | "show"; title: string; current: number; total: number; date: string; daily_target?: number }[] }> =>
    fetch("/api/progress").then(r => r.json()),
  progressAdd: (b: { kind: "book" | "show"; title: string; total: number; current: number; daily_target?: number }) =>
    fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  progressInc: (id: string, delta: number) =>
    fetch("/api/progress/inc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, delta }) }).then(r => r.json()),
  progressDel: (id: string) =>
    fetch("/api/progress/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json()),
  wereadStatus: (): Promise<{ ok: boolean; cookie_set: boolean; hint?: string }> =>
    fetch("/api/weread/status").then(r => r.json()),
  wereadSync: (): Promise<{ ok: boolean; updated?: string[]; unmatched?: string[]; error?: string; note?: string }> =>
    fetch("/api/weread/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()),
  game: (): Promise<GameState> => fetch("/api/game").then(r => r.json()),
  gameAct: (body: Record<string, unknown>) =>
    fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  taskAdd: (b: { date: string; time: string; text: string; quad: string }) =>
    fetch("/api/task/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  taskEdit: (b: { date: string; raw?: string; section?: string; task?: string; old_time?: string; text?: string; time?: string; quad?: string }): Promise<{ ok: boolean; time?: string; error?: string }> =>
    fetch("/api/task/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
  dayContext: (date?: string): Promise<DayContext> =>
    fetch(`/api/day-context?date=${date || new Date().toISOString().slice(0, 10)}`).then(r => r.json()),
  suggestions: (date?: string): Promise<{ ok: boolean; suggestions: ProgressSuggestion[] }> =>
    fetch(`/api/suggestions?date=${date || new Date().toISOString().slice(0, 10)}`).then(r => r.json()),
  contextGet: (date?: string): Promise<{ ok: boolean; date: string; context: Record<string, string> }> =>
    fetch(`/api/context?date=${date || new Date().toISOString().slice(0, 10)}`).then(r => r.json()),
  contextSave: (b: PlanContextFields & { date?: string }): Promise<{ ok: boolean; date: string; context: Record<string, string> }> =>
    fetch("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()),
};

/* ---- Jarvis 判断顺序（与 server 端同规则） ---- */
export interface EngineState { redFlag: boolean; fixed: boolean; sleep: number; energy: number; budget: boolean }
export const DEFAULT_ENGINE: EngineState = { redFlag: false, fixed: true, sleep: 7, energy: 3, budget: false };

const ORDER_NAMES: Record<string, string> = {
  safety: "安全与医疗", fixed: "固定安排", recovery: "睡眠恢复与饮食",
  finance: "财务安全", mainline: "当前主线", explore: "体验探索", convenience: "临时便利",
};
const VERDICTS: Record<string, string> = {
  safety: "今天只做一件事：处理健康问题。其余全部冻结。",
  fixed: "先把不可移动的保住（课程/考试/已约会议），剩余精力按档位分配。",
  recovery: "降档运行：只保重点 + 语言最低闭环。删任务，不压时间。",
  finance: "今日支出冻结，先清财务红线，再做别的。",
  mainline: "主线还债：大号本周这篇。四象限里唯一在推进 1.X → 2.X 的杠杆动作。",
  explore: "有余力：钢琴/攀岩/校园活动，不带 KPI 地做。",
  convenience: "杂事排最后，能明天就明天。",
};

export function runEngine(st: EngineState) {
  const hits: string[] = [];
  if (st.redFlag) hits.push("safety");
  if (st.fixed) hits.push("fixed");
  if (st.sleep < 6.5 || st.energy <= 2) hits.push("recovery");
  if (st.budget) hits.push("finance");
  hits.push("mainline");
  if (st.energy >= 4 && !st.redFlag) hits.push("explore");
  const seq = ["safety", "fixed", "recovery", "finance", "mainline", "explore", "convenience"];
  const first = seq.find(s => hits.includes(s)) || "mainline";
  let plan: string;
  if (st.energy <= 2) plan = "低精力方案：重点 + 语言最低闭环，其余全砍。目标是明天满血。";
  else if (st.energy <= 4) plan = "默认方案：三件事 + 固定安排。不贪。";
  else plan = "满血方案：默认 + 一项兴趣探索 + 提前还一篇稿债。";
  if (st.sleep < 6.5) plan += ` 睡眠 ${st.sleep}h 不足 → 今晚 23:00 前收尾是硬约束。`;
  return { hits, first, firstName: ORDER_NAMES[first], verdict: VERDICTS[first], plan };
}

export const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
export const WD = ["日", "一", "二", "三", "四", "五", "六"];
export const fmtDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`;
};
export const esc = (s: unknown) => String(s ?? "");
