/* PEOS 前端渲染 + 决策引擎。无框架、无依赖。 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const fmtDate = iso => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`; };
const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;

let DATA = null;
let CURRENT_TAB = "today";

/* ==================== 初始化 ==================== */

async function boot() {
  try {
    const res = await fetch("/api/overview");
    DATA = await res.json();
    if (DATA.error) throw new Error(DATA.error);
    $("#refreshed").textContent = "↳ " + DATA.generated_at.slice(11, 16) + " 刷新";
    renderAll();
  } catch (e) {
    $("#app").innerHTML = `<div class="error-view">读取失败：${esc(e.message)}<br>
      <span class="muted">确认 server.py 正在运行、Obsidian vault 路径正确（config.json → vault_root）</span></div>`;
  }
}

$("#refreshBtn").onclick = () => { $("#app").innerHTML = `<div class="loading">重新读取…</div>`; boot(); };

$("#tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab"); if (!btn) return;
  CURRENT_TAB = btn.dataset.tab;
  $$(".tab").forEach(t => t.classList.toggle("active", t === btn));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + btn.dataset.tab));
  window.scrollTo({ top: 0 });
});

function renderAll() {
  const app = $("#app");
  app.innerHTML = `
    <section class="view active" id="view-today"></section>
    <section class="view" id="view-tasks"></section>
    <section class="view" id="view-state"></section>
    <section class="view" id="view-decide"></section>`;
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === CURRENT_TAB));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + CURRENT_TAB));
  renderToday();
  renderTasks();
  renderState();
  renderReview();
}

/* 勾选后静默重取数据（去抖），保持当前页签 */
let REFRESH_TIMER = null;
function scheduleRefresh() {
  clearTimeout(REFRESH_TIMER);
  REFRESH_TIMER = setTimeout(boot, 700);
}

async function toggleTask(date, section, raw, done) {
  try {
    const res = await fetch("/api/task/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, section, raw, done })
    });
    return await res.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ==================== SVG 图表 ==================== */

function radarSVG(items, size = 300) {
  const cx = size / 2, cy = size / 2 + 4, R = size / 2 - 52, max = 5;
  const ang = [-90, 0, 90, 180].map(a => a * Math.PI / 180);
  const P = (v, i) => [cx + Math.cos(ang[i]) * R * (v / max), cy + Math.sin(ang[i]) * R * (v / max)];
  const poly = (key) => items.map((q, i) => P(q[key], i).map(n => n.toFixed(1)).join(",")).join(" ");
  let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  [1, 2, 3, 4, 5].forEach(r => {
    s += `<polygon points="${items.map((_, i) => P(r, i).map(n => n.toFixed(1)).join(",")).join(" ")}"
      fill="none" stroke="#1e2833" stroke-width="1"/>`;
  });
  items.forEach((_, i) => {
    const [x, y] = P(max, i);
    s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#1e2833"/>`;
  });
  s += `<polygon points="${poly("ideal")}" fill="rgba(255,255,255,.015)" stroke="#3a3a3a" stroke-dasharray="3 4"/>`;
  s += `<polygon points="${poly("after90")}" fill="rgba(255,255,255,.03)" stroke="#8f8f8f" stroke-dasharray="5 4"/>`;
  s += `<polygon points="${poly("current")}" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.25)" stroke-width="6" stroke-linejoin="round"/>`;
  s += `<polygon points="${poly("current")}" fill="rgba(255,255,255,.1)" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>`;
  const labelPos = [
    [cx, cy - R - 34], [cx + R + 8, cy], [cx, cy + R + 30], [cx - R - 8, cy],
  ];
  const labelAnchor = ["middle", "start", "middle", "end"];
  items.forEach((q, i) => {
    const [x, y] = labelPos[i];
    const colors = { mind: "#ffffff", body: "#d6d6d6", spirit: "#bdbdbd", vocation: "#ececec" };
    s += `<text x="${x}" y="${y}" fill="${colors[q.id]}" font-size="12" font-weight="700" text-anchor="${labelAnchor[i]}">${q.icon} ${q.name.split(" ")[0]}</text>`;
    s += `<text x="${x}" y="${y + 14}" fill="#8b98a5" font-size="10.5" text-anchor="${labelAnchor[i]}">${q.current} → ${q.ideal}</text>`;
  });
  return s + `</svg>`;
}

function sparkline(rows, key, color, unit = "", digits = 1) {
  const pts = rows.filter(r => r[key] != null && !isNaN(r[key]));
  if (!pts.length) return `<div class="trend-empty">暂无数据 —— 在 Daily 笔记 frontmatter 填 <code>${key == "weight" ? "weight" : key}</code>，或在「每日闭环·数据补填」写数字，次日自动出现在这里</div>`;
  const W = 300, H = 90, pad = 26;
  const vals = pts.map(p => p[key]);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const X = i => pad + (W - pad * 1.6) * (i / (pts.length - 1 || 1));
  const Y = v => H - pad - (H - pad * 1.9) * ((v - min) / span);
  const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${X(pts.length - 1).toFixed(1)},${H - pad}`;
  const last = pts[pts.length - 1];
  return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <polygon points="${area}" fill="${color}14"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p[key]).toFixed(1)}" r="2.4" fill="${color}"/>`).join("")}
    <text x="${pad}" y="14" fill="#8b98a5" font-size="9.5">${min.toFixed(digits)}${unit} — ${max.toFixed(digits)}${unit}</text>
    <text x="${W - pad}" y="14" fill="${color}" font-size="11" font-weight="700" text-anchor="end">${last[key].toFixed(digits)}${unit} · ${last.date.slice(5)}</text>
  </svg>`;
}

/* ==================== 决策引擎（Jarvis 判断顺序） ==================== */

const ENGINE_KEY = "peos.engine.state";
function engineState() {
  try { return { ...{ redFlag: false, fixed: true, sleep: 7, energy: 3, budget: false }, ...JSON.parse(localStorage.getItem(ENGINE_KEY) || "{}") }; }
  catch { return { redFlag: false, fixed: true, sleep: 7, energy: 3, budget: false }; }
}

function runEngine(st) {
  const hits = [];
  if (st.redFlag) hits.push("safety");
  if (st.fixed) hits.push("fixed");
  if (st.sleep < 6.5 || st.energy <= 2) hits.push("recovery");
  if (st.budget) hits.push("finance");
  hits.push("mainline");
  if (st.energy >= 4 && !st.redFlag) hits.push("explore");
  const first = hits[0];
  const NAMES = { safety: "安全与医疗", fixed: "固定安排", recovery: "睡眠恢复与饮食", finance: "财务安全", mainline: "当前主线", explore: "体验探索", convenience: "临时便利" };
  const PLANS = {
    safety: "今天只做一件事：处理健康问题。课程能请假就请假，其余全部冻结。",
    fixed: "先把不可移动的保住（课程/考试/已约会议），剩余精力按下面的档位分配。",
    recovery: "降档运行：只保 🐸 青蛙 + 语言最低闭环（日语 15min）。其余删除，不压缩时间——是删掉。",
    finance: "今日支出冻结，先清财务红线（缴费/还款/对账），再做别的。",
    mainline: "主线还债：大号本周这篇。这是四象限里唯一在推进 1.X → 2.X 的杠杆动作。",
    explore: "有余力：钢琴/攀岩/校园活动，不带 KPI 地做。",
    convenience: "杂事排最后，能明天就明天。"
  };
  let plan;
  if (st.energy <= 2) plan = "<b>低精力方案</b>：青蛙 + 语言最低闭环，其余全砍。今天的目标是明天满血。";
  else if (st.energy <= 4) plan = "<b>默认方案</b>：三件事 + 固定安排。不贪。";
  else plan = "<b>满血方案</b>：默认 + 一项兴趣探索 + 提前还一篇稿债。";
  if (st.sleep < 6.5) plan += ` 睡眠 ${st.sleep}h 不足 → 今晚 23:00 前收尾是硬约束。`;
  return { hits, first, firstName: NAMES[first], verdict: PLANS[first], plan, NAMES };
}

/* ==================== 视图：今日 ==================== */

function renderToday() {
  const d = DATA, q = d.config.quadrants;
  const today = d.today_daily, rich = d.latest_rich_daily;
  const hero = document.createElement("div");

  const greet = h => h < 6 ? "凌晨好" : h < 12 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  const banner = !today
    ? (rich ? `<div class="banner">⏳ 今日 Daily（${d.today}）未创建 —— 下面展示最近一篇有内容的日记（${fmtDate(rich.date)}）</div>`
            : `<div class="banner">⏳ vault 里还没有任何 Daily Note</div>`)
    : (today.total === 0 ? `<div class="banner">📋 今天的 Daily 还是空模板，未填写任务</div>` : "");

  const showDaily = (today && today.total > 0 ? today : rich) || today
    || { date: d.today, tasks_by_section: [], done: 0, total: 0, incomplete: [] };
  const sections = (showDaily.tasks_by_section || []).filter(s => s.tasks.length);

  const frog = (showDaily.frogs && showDaily.frogs.length)
    ? showDaily.frogs.map(f => `<div class="frog">🐸 ${esc(f)}</div>`).join("") : "";
  const conclusion = showDaily.conclusion ? `<div class="conclusion">${esc(showDaily.conclusion)}</div>` : "";
  const notToday = showDaily.not_today && !showDaily.not_today.includes("待填写")
    ? `<div class="not-today"><b>今天明确不做：</b>${esc(showDaily.not_today)}</div>` : "";

  const st = engineState(), eng = runEngine(st);

  $("#view-today").innerHTML = `
    <div class="hero">
      <div>
        <div class="hero-date">${fmtDate(d.today)}</div>
        <div class="hero-greet">${greet(new Date().getHours())}，${esc(d.config.user.name)} · ${esc(d.config.user.identity)}</div>
      </div>
      <div class="hero-stats">
        ${q.items.map(item => `<div class="hero-stat ${item.id}"><div class="v">${item.current}</div><div class="l">${item.icon} ${item.name.split(" ")[0]}</div></div>`).join("")}
        <div class="hero-stat"><div class="v" style="color:var(--warn)">${q.current_total}</div><div class="l">总分 / 理想 5.0</div></div>
      </div>
    </div>
    ${banner}
    <div class="grid main-side">
      <div>
        <div class="card frog-card mb16">
          <h3>🎯 今日焦点 <span class="tag muted">${fmtDate(showDaily.date)} 的计划</span></h3>
          ${(showDaily.frogs && showDaily.frogs.length)
            ? showDaily.frogs.map(f => `<div class="frog">🐸 ${esc(f)}</div>`).join("")
            : '<div class="muted">这篇 Daily 没有写青蛙（最重要的事放上午做完，可写 1–3 只）</div>'}
          ${conclusion}${notToday}
        </div>
        <div class="card">
          <h3>✅ 今日任务 <span class="tag muted">${showDaily.done}/${showDaily.total} 完成 · 任务页可直接勾选</span></h3>
          ${sections.length ? sections.map(sec => `
            <div class="section-block">
              <div class="section-title">${esc(sec.section)} <span class="count">${sec.tasks.filter(t => t.done).length}/${sec.tasks.length}</span></div>
              ${sec.tasks.map(t => `<div class="task ${t.done ? "done" : ""}"><div class="box"></div><div class="txt">${esc(t.text)}</div></div>`).join("")}
            </div>`).join("") : '<div class="muted">没有可展示的任务</div>'}
        </div>
      </div>
      <div>
        <div class="card mb16">
          <h3>⚡ 今日第一优先级 <span class="tag">Jarvis 判断顺序 · 可调</span></h3>
          <div class="engine-inputs" style="grid-template-columns:1fr">
            <div class="input-row">
              <label>当前精力 <b>${st.energy}/5</b></label>
              <input type="range" min="1" max="5" step="1" value="${st.energy}" data-k="energy">
            </div>
            <div class="input-row">
              <label>昨晚睡眠 <b>${st.sleep}h</b></label>
              <input type="range" min="3" max="10" step="0.5" value="${st.sleep}" data-k="sleep">
            </div>
            <div class="input-row">
              <div class="switch-row">
                <span class="switch ${st.redFlag ? "on" : ""}" data-k="redFlag">🚑 健康红灯</span>
                <span class="switch ${st.fixed ? "on" : ""}" data-k="fixed">📅 固定安排</span>
                <span class="switch ${st.budget ? "on" : ""}" data-k="budget">💰 预算紧张</span>
              </div>
            </div>
          </div>
          <div class="verdict" style="margin-top:10px">
            <div class="v-main">${esc(eng.firstName)}</div>
            <div class="v-sub">${esc(eng.verdict)}</div>
            <div class="v-plan">${eng.plan}</div>
          </div>
        </div>
        <div class="card mb16">
          <h3>📊 身体快照 <span class="tag muted">Daily frontmatter</span></h3>          <div class="chips">
            <span class="pill">体重 <b>${showDaily.weight ?? "—"}${showDaily.weight ? "kg" : ""}</b></span>
            <span class="pill">心情 <b>${showDaily.mood ?? "—"}</b></span>
            <span class="pill">睡眠 <b>${showDaily.sleep_hours ?? "—"}${showDaily.sleep_hours ? "h" : ""}</b></span>
            <span class="pill">饮水 <b>${showDaily.water ?? "—"}${showDaily.water ? "ml" : ""}</b></span>
          </div>
          <div class="muted mt8">灰色 = 还没填。晚间盘点时写进 Daily 闭环即可积累趋势。</div>
        </div>
        <div class="card">
          <h3>🏋️ 健身进度</h3>
          ${fitnessHTML(d.fitness)}
        </div>
      </div>
    </div>`;

  // 引擎交互绑定（原地更新，不打断拖动）
  const refreshVerdict = () => {
    const st = engineState(), eng = runEngine(st);
    const eb = $("#engEnergy"), sb = $("#engSleep"), vb = $("#view-today .verdict");
    if (eb) eb.textContent = st.energy + "/5";
    if (sb) sb.textContent = st.sleep + "h";
    $$('#view-today .switch[data-k]').forEach(sw =>
      sw.classList.toggle("on", !!st[sw.dataset.k]));
    if (vb) vb.innerHTML = `
      <div class="v-main">${esc(eng.firstName)}</div>
      <div class="v-sub">${esc(eng.verdict)}</div>
      <div class="v-plan">${eng.plan}</div>`;
  };
  $$('#view-today input[type="range"]').forEach(r => r.oninput = e => {
    const s = engineState(); s[e.target.dataset.k] = parseFloat(e.target.value);
    localStorage.setItem(ENGINE_KEY, JSON.stringify(s)); refreshVerdict();
  });
  $$('#view-today .switch[data-k]').forEach(sw => sw.onclick = () => {
    const s = engineState(); s[sw.dataset.k] = !s[sw.dataset.k];
    localStorage.setItem(ENGINE_KEY, JSON.stringify(s)); refreshVerdict();
  });
}

function fitnessHTML(f) {
  const wk = pct(f.week_no, f.weeks);
  return `
    <div class="kpi-row"><span class="name">${esc(f.plan)}</span><div class="bar ok"><i style="width:${wk}%"></i></div>
      <span class="num">W${f.week_no}/${f.weeks}</span></div>
    <div class="chips mt8">
      <span class="pill">起点 <b>${f.weight_start}kg</b></span>
      <span class="pill">最新 <b>${f.latest_weight ? f.latest_weight + "kg" : "待记录"}</b></span>
      <span class="pill">目标 <b>${f.weight_target}kg</b></span>
      ${f.weight_gap != null ? `<span class="pill ${f.weight_gap <= 5 ? "green" : ""}">还差 <b>${f.weight_gap}kg</b></span>` : ""}
    </div>
    <div class="muted mt8">蛋白 ${f.protein_target}g/天 · ${f.sleep_target} 入睡 · 训练 5 天/周</div>`;
}

/* ==================== 视图：任务（两栏：TODO × 时间表） ==================== */

const ENERGY_MAP = [["🔴", "▰▰▰"], ["🟠", "▰▰▰"], ["🟡", "▰▰"], ["🟢", "▰"], ["🔵", "▰"]];
const mapEnergy = s => ENERGY_MAP.reduce((a, [e, b]) => a.replace(e, b), s || "");

function renderTasks() {
  const d = DATA;
  // 僵尸任务：同一未完成任务出现 ≥3 天
  const freq = {};
  d.week.forEach(w => w.incomplete.forEach(t => { freq[t] = (freq[t] || 0) + 1; }));

  // 左栏：所有 TODO（日期倒序 = 今天在前；日内按分区）
  const dayGroups = d.week.slice().reverse().map(w => {
    const open = w.tasks.filter(t => !t.done);
    const bySec = {};
    w.tasks.forEach(t => { if (!t.done) (bySec[t.section] = bySec[t.section] || []).push(t); });
    return { w, open, bySec };
  }).filter(g => g.w.total > 0);

  const leftHTML = dayGroups.length ? dayGroups.map(({ w, open, bySec }) => `
    <div class="section-block">
      <div class="section-title">${gDayLabel(w.date)} ${w.weekday}
        <span class="count">${w.done}/${w.total}</span>
        ${w.date === d.today ? '<span class="count today-chip">今天</span>' : ""}
      </div>
      ${Object.entries(bySec).map(([sec, ts]) => `
        <div class="todo-sec">${esc(sec)}</div>
        ${ts.map(t => `
          <div class="task checkable" data-date="${w.date}" data-section="${esc(t.section)}"
               data-raw="${esc(t.raw)}" data-done="0">
            <div class="box"></div>
            <div class="txt">${esc(t.text)}${freq[t.text] >= 3 ? ` <span class="gap-chip">🔁 ${freq[t.text]} 天未闭环</span>` : ""}</div>
          </div>`).join("")}`).join("")}
      ${!open.length ? '<div class="muted" style="padding:4px 8px">✓ 全部完成</div>' : ""}
    </div>`).join("") : '<div class="muted">近两周没有 Daily 任务</div>';

  // 右栏：今日时间表（总览主表；今天没有则显示最近一篇并标注）
  const schedSrc = (d.today_daily && d.today_daily.schedule && d.today_daily.schedule.length)
    ? { src: d.today_daily, rows: d.today_daily.schedule, isToday: true }
    : (d.latest_rich_daily && d.latest_rich_daily.schedule && d.latest_rich_daily.schedule.length)
      ? { src: d.latest_rich_daily, rows: d.latest_rich_daily.schedule, isToday: false }
      : null;

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

  // 🐸 青蛙区（A+D：最重要的事放上午做完，可 1–3 只）
  const h24 = new Date().getHours();
  const morning = h24 >= 6 && h24 < 12;
  const frogsSrc = schedSrc ? (schedSrc.src.frogs || []) : [];
  const fzState = h24 < 6
    ? "🌙 凌晨 —— 先睡，青蛙等早上的你"
    : morning ? "🌅 上午窗口进行中 —— 现在就做青蛙"
    : "🌤 已过上午 —— 青蛙顺延为下午第一优先级";
  const frogZone = `
    <div class="frog-zone ${morning ? "am" : "pm"} ${frogsSrc.length ? "" : "empty"}">
      <div class="fz-head">🐸 今日青蛙 <span class="fz-sub">最重要的事 · 上午做完（1–3 只）</span></div>
      ${frogsSrc.length ? frogsSrc.map(f => `<div class="fz-item">▸ ${esc(f)}</div>`).join("")
        : '<div class="fz-item muted">这篇 Daily 没写青蛙</div>'}
      <div class="fz-state">${fzState}</div>
    </div>`;

  // 时间块 + 块间缓冲（A：缓冲是对抗 ADHD 时间盲的结构）
  const rowsWithBuffer = [];
  (schedSrc ? schedSrc.rows : []).forEach((r, i) => {
    if (i > 0) {
      const gap = toMin(r.start) - toMin(schedSrc.rows[i - 1].end);
      if (gap > 5 && gap <= 180) rowsWithBuffer.push({ buffer: gap });
    }
    rowsWithBuffer.push(r);
  });

  const schedHTML = schedSrc ? `
    ${schedSrc.isToday ? "" : `<div class="banner" style="margin:0 0 12px">⏳ 今日无时间表 —— 显示 ${fmtDate(schedSrc.src.date)} 的总览主表</div>`}
    ${frogZone}
    ${rowsWithBuffer.map(row => row.buffer ? `
      <div class="sched-row buffer">
        <div class="sched-time"></div>
        <div class="sched-rail"><i></i></div>
        <div class="sched-body"><div class="sched-meta">⏸ 缓冲 ${row.buffer}min —— 切换 / 迟到保护 / 走神额度</div></div>
      </div>` : (() => {
      const cur = schedSrc.isToday && nowMin >= toMin(row.start) && nowMin < toMin(row.end);
      return `
      <div class="sched-row ${cur ? "now" : ""}">
        <div class="sched-time">${row.start}<br><span class="sched-end">${row.end}</span></div>
        <div class="sched-rail"><i></i></div>
        <div class="sched-body">
          <div class="sched-head">${cur ? '<span class="now-chip">现在</span>' : ""}${esc(row.task)}</div>
          <div class="sched-meta">${mapEnergy(esc(row.energy))}${row.type ? " · " + esc(row.type) : ""}${row.block ? " · " + esc(row.block) : ""}</div>
          ${row.goal ? `<div class="sched-goal">完成线：${esc(row.goal)}</div>` : ""}
        </div>
      </div>`;
    })()).join("")}` : '<div class="muted">最近一篇 Daily 没有可解析的总览主表（需要「## 总览主表」表格才会出现在这里）</div>';

  const c = d.content, s = c.stats;
  const todoTable = c.todo.length ? `<table class="tbl">
    <tr><th>选题</th><th>状态</th><th>计划</th></tr>
    ${c.todo.map(t => `<tr><td>${esc(t.topic)}</td>
      <td><span class="status-pill ${t.status.includes("待写") ? "wait" : "idea"}">${esc(t.status)}</span></td>
      <td class="muted">${esc(t.plan || "—")}</td></tr>`).join("")}
  </table>` : "";

  const timelineList = d.timeline.length ? d.timeline.map(t => `
    <div class="tl-item"><span class="t-date">${t.date.slice(5)}</span>
      <div class="t-body">${esc(t.item)}<div class="t-days">${t.days_away === 0 ? "就是今天" : t.days_away > 0 ? `还有 ${t.days_away} 天` : "已过"}</div></div></div>`).join("")
    : '<div class="muted">📅 60 天内没有既定截止（入学时间线事项已全部过去）</div>';

  $("#view-tasks").innerHTML = `
    <div class="grid main-side mb16">
      <div class="card">
        <h3>⬜ 所有 TODO <span class="tag muted">勾选直接写回 Daily Note · 近 14 天</span></h3>
        ${leftHTML}
      </div>
      <div class="card">
        <h3>🕐 每日时间表 <span class="tag muted">总览主表 · 按时间排布</span></h3>
        ${schedHTML}
      </div>
    </div>
    <div class="grid cols-2 mb16">
      <div class="card">
        <h3>🎙️ 内容管道 <span class="tag muted">${s["已发布"]} 发 / ${s["待写"]} 待写 / ${s["灵感"]} 灵感</span></h3>
        <div class="chart-wrap mb16">
          ${[["已发布", "rgba(255,255,255,.9)"], ["待写", "rgba(255,255,255,.55)"], ["灵感", "rgba(255,255,255,.35)"], ["草稿箱", "rgba(255,255,255,.45)"], ["过期", "rgba(255,255,255,.2)"]].map(([k, col]) => `
            <div style="flex:1;min-width:110px">
              <div style="font-size:12px;color:var(--text-faint);margin-bottom:4px">${k} · ${s[k]}</div>
              <div class="bar" style="height:6px"><i style="width:${pct(s[k], 21)}%;background:${col}"></i></div>
            </div>`).join("")}
        </div>
        ${todoTable}
      </div>
      <div class="card">
        <h3>📅 近期截止 <span class="tag muted">入学时间线 + 排期</span></h3>
        ${timelineList}
      </div>
    </div>`;

  // 勾选交互（事件委托）
  $("#view-tasks").addEventListener("click", async e => {
    const row = e.target.closest(".task.checkable");
    if (!row) return;
    const done = row.dataset.done !== "1";
    row.dataset.done = done ? "1" : "0";
    row.classList.toggle("done", done);
    row.style.opacity = .45;
    const r = await toggleTask(row.dataset.date, row.dataset.section, row.dataset.raw, done);
    if (!r.ok) {
      row.dataset.done = done ? "0" : "1";
      row.classList.toggle("done", !done);
      row.style.opacity = "";
      alert("写回失败：" + r.error);
    } else {
      scheduleRefresh();
    }
  });
}

function gDayLabel(iso) {
  const diff = Math.round((new Date(DATA.today) - new Date(iso)) / 864e5);
  return iso.slice(5) + (diff === 0 ? "" : diff === 1 ? "（昨天）" : diff === 2 ? "（前天）" : "");
}

/* ==================== 视图：状态与差距 ==================== */

function renderState() {
  const d = DATA, q = d.config.quadrants, sem = d.config.semester;
  const gapTotal = (q.ideal_total - q.current_total).toFixed(1);
  const semDays = Math.max(0, Math.round((new Date(sem.end) - new Date(sem.start)) / 864e5));
  const semPassed = Math.min(semDays, Math.max(0, Math.round((new Date(d.today) - new Date(sem.start)) / 864e5)));
  const semPct = pct(semPassed, semDays);

  $("#view-state").innerHTML = `
    <div class="grid main-side mb16">
      <div class="card">
        <h3>🧭 四象限定位 <span class="tag muted">实线=当前 · 虚线=90天目标 · 深虚线=理想 5.0</span></h3>
        <div style="display:flex;justify-content:center">${radarSVG(q.items, 330)}</div>
      </div>
      <div>
        <div class="card mb16">
          <h3>📍 离理想状态的距离</h3>
          <div class="split" style="gap:22px">
            <div><div class="num-big" style="color:#fff">${q.current_total}</div><div class="muted">当前总分</div></div>
            <div class="muted" style="font-size:20px;padding-top:8px">→</div>
            <div><div class="num-big" style="color:#cfcfcf">${q.after90_total}</div><div class="muted">90天目标</div></div>
            <div class="muted" style="font-size:20px;padding-top:8px">→</div>
            <div><div class="num-big" style="color:#5a5a5a">5.0</div><div class="muted">理想状态</div></div>
          </div>
          <div class="bar mt16"><i style="width:${pct(q.current_total, 5)}%"></i></div>
          <div class="mt8 muted">距理想还差 <b style="color:#fff">${gapTotal}</b> 分。按 90 天地图走完全部承诺，预计到 <b>${q.after90_total}</b>（HUMAN3.0 Part 7）。</div>
        </div>
        <div class="card">
          <h3>🍂 ${esc(sem.name)}</h3>
          <div class="kpi-row"><span class="name">学期进度</span><div class="bar"><i style="width:${semPct}%"></i></div><span class="num">${semPct}%</span></div>
          ${sem.goals.map(g => `
            <div class="goal">
              <span class="g-icon">${{ "进行中": "🟢", "收尾中": "🏁", "未启动": "⚪", "观察中": "👀" }[g.status] || "⚪"}</span>
              <div><div class="g-label">${esc(g.label)}</div>${g.note ? `<div class="g-note">${esc(g.note)}</div>` : ""}</div>
              <span class="g-status ${esc(g.status)}">${esc(g.status)}</span>
            </div>`).join("")}
        </div>
      </div>
    </div>
    <div class="grid cols-2 mb16">
      ${q.items.map(item => `
        <div class="card quad-card ${item.id}">
          <div class="quad-head"><span class="icon">${item.icon}</span><span class="name">${esc(item.name)}</span>
            <span class="score">${item.current}<span style="font-size:12px;color:var(--text-faint)"> /5.0</span>
              <span class="gap-chip">差 ${(item.ideal - item.current).toFixed(1)}</span></span></div>
          <div class="quad-stage">${esc(item.stage)}</div>
          <div class="quad-track">
            <div class="rail"></div>
            <div class="fill" style="width:${pct(item.current, 5)}%"></div>
            <div class="dot now" style="left:${pct(item.current, 5)}%"></div>
            <div class="dot after90" style="left:${pct(item.after90, 5)}%"></div>
            <div class="dot ideal" style="left:100%"></div>
          </div>
          <div class="quad-scale"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5.0 理想</span></div>
          <div class="quad-desc">${esc(item.diagnosis)}</div>
          <div class="quad-action"><b>补课动作 · 周 KPI：${esc(item.kpi_weekly)}</b>${esc(item.action)}</div>
        </div>`).join("")}
    </div>
    <div class="grid cols-3 mb16">
      <div class="card trend-card"><h3>⚖️ 体重 (kg)</h3>${sparkline(d.body_trend, "weight", "var(--body)")}</div>
      <div class="card trend-card"><h3>💛 心情 (1-5)</h3>${sparkline(d.body_trend, "mood", "var(--warn)", "", 0)}</div>
      <div class="card trend-card"><h3>😴 睡眠 (h)</h3>${sparkline(d.body_trend, "sleep_hours", "var(--accent)")}</div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>🏋️ 健身 · 12 周计划</h3>${fitnessHTML(d.fitness)}</div>
      <div class="card">
        <h3>🎯 本周 KPI <span class="tag muted">估算：近 7 天已完成任务文字匹配</span></h3>
        ${kpiHTML()}
        <div class="muted mt8">目标口径按《2026秋·半年框架》拟定（PRD 待确认问题 #4）。改 config.json → kpi_weekly 可调。</div>
      </div>
    </div>`;
}

function kpiHTML() {
  const counts = DATA.kpi_counts || {};
  return DATA.config.kpi_weekly.targets.map(t => {
    const n = counts[t.id] || 0, p = pct(n, t.target);
    return `<div class="kpi-row"><span class="name">${esc(t.label)}</span>
      <div class="bar ${p >= 100 ? "ok" : ""}"><i style="width:${p}%"></i></div>
      <span class="num">${n}/${t.target}</span></div>`;
  }).join("");
}

/* ==================== 视图：复盘台 ==================== */

const DIARY_CACHE = {};

function renderReview() {
  const d = DATA;
  const myDiary = (d.today_daily && d.today_daily.diary) || "";
  const order = d.config.decision_order;
  const st = engineState(), eng = runEngine(st);

  $("#view-decide").innerHTML = `
    <div class="card mb16">
      <h3>✍️ 今日日记 <span class="tag muted">写入 Daily Note「📖 今日日记」段 · ${fmtDate(d.today)}</span></h3>
      <textarea id="diaryText" rows="4"
        placeholder="今天做了什么、卡在哪、一句话洞察……保存后自动进入下方卡片流，我读完会给你摘要和评分">${esc(myDiary)}</textarea>
      <div class="split mt8">
        <button class="chat-send" id="diarySave">保存日记</button>
        <span class="muted" id="diaryHint">${myDiary ? "今天已有日记，保存会覆盖日记段（其余内容不动）" : "今天的 Daily 将自动创建"}</span>
      </div>
    </div>
    <div class="card mb16">
      <h3>🗂 日记卡片流 <span class="tag muted">近 30 天 · 点击卡片看全文</span></h3>
      <div class="diary-grid">
        ${d.diary_cards.map(c => `
          <div class="diary-card" data-date="${c.date}">
            <div class="dc-top">
              <span class="dc-emoji">${c.emoji}</span>
              <span class="dc-stars">${"★".repeat(c.rating)}<span class="dim">${"☆".repeat(5 - c.rating)}</span></span>
            </div>
            <div class="dc-date">${fmtDate(c.date)}</div>
            <div class="dc-summary">${esc(c.summary)}</div>
            <div class="dc-comment">${esc(c.comment)}</div>
            <div class="dc-full" hidden></div>
          </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <h3>🤖 决策 Agent <span class="tag muted" id="agentModeBadge">离线规则引擎 · 通用 skill 已载入</span></h3>
      <div class="muted mb8">判断顺序：${order.map(o => esc(o.name)).join(" → ")}</div>
      <div class="chat-log" id="chatLog"></div>
      <div class="chips mb8 mt8" id="chatQuick">
        ${["今天先做什么？", "要不要换工作？", "这篇发不发？", "太累了怎么办？", "要不要接这个合作？"].map(q =>
          `<span class="switch chat-quick">${esc(q)}</span>`).join("")}
      </div>
      <div class="chat-input-row">
        <input id="chatInput" placeholder="问任何决策问题…（agent 会结合你的状态、四象限和战略边界回答）" autocomplete="off">
        <button class="chat-send" id="chatSend">发送</button>
      </div>
      <div class="muted mt8">规则与人格写在 <code>peos/agent_skill.md</code>，可直接编辑。接入 LLM：config.json → agent 填 api_base + api_key。</div>
    </div>`;

  renderChat();
  bindChat();
  bindDiary();
  bindCards();
}

/* ---------- 日记读写 ---------- */

async function bindDiary() {
  const btn = $("#diarySave");
  if (!btn) return;
  btn.onclick = async () => {
    const text = $("#diaryText").value;
    const hint = $("#diaryHint");
    btn.textContent = "保存中…";
    let r = null;
    try {
      const res = await fetch("/api/diary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: DATA.today, text })
      });
      r = await res.json();
      hint.textContent = r.ok ? `✓ 已写入 ${r.path.split("/").pop()}${r.created ? "（新建）" : ""}` : "✗ " + r.error;
    } catch (e) { hint.textContent = "✗ " + e.message; }
    btn.textContent = "保存日记";
    if (r && r.ok) scheduleRefresh();
  };
}

function bindCards() {
  $$("#view-decide .diary-card").forEach(card => card.onclick = async () => {
    const full = card.querySelector(".dc-full");
    if (full.hidden) {
      if (!full.textContent) {
        full.textContent = "读取中…";
        try {
          const res = await fetch("/api/diary?date=" + card.dataset.date);
          const r = await res.json();
          let t = r.full || "（空）";
          t = t.replace(/^---\n.*?\n---\n/s, "").replace(/^#\s*.*$/m, "");  // 去 frontmatter 和主标题
          full.textContent = t.trim();
        } catch (e) { full.textContent = "读取失败：" + e.message; }
      }
      full.hidden = false;
      card.classList.add("open");
    } else {
      full.hidden = true;
      card.classList.remove("open");
    }
  });
}

/* ---------- Agent 聊天 ---------- */

const CHAT_KEY = "peos.chat";
const getChat = () => { try { return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]"); } catch { return []; } };

function renderChat(pending) {
  const log = $("#chatLog");
  if (!log) return;
  const chat = getChat();
  log.innerHTML = chat.map(m => `
    <div class="bubble ${m.role} ${m.pending ? "pending" : ""}">
      <div class="b-role">${m.role === "user" ? "你" : m.mode === "llm" ? "Agent · LLM" : "Agent"}</div>
      <div class="b-text">${esc(m.text).replace(/\n/g, "<br>")}</div>
    </div>`).join("") + (pending ? `
    <div class="bubble bot pending"><div class="b-role">Agent</div><div class="b-text">思考中<span class="dots">…</span></div></div>` : "");
  log.scrollTop = log.scrollHeight;
}

async function askAgent(q) {
  if (!q.trim()) return;
  const chat = getChat();
  chat.push({ role: "user", text: q.trim() });
  localStorage.setItem(CHAT_KEY, JSON.stringify(chat.slice(-40)));
  renderChat(true);
  let ans, mode = "offline";
  try {
    const res = await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q.trim(), engine_state: engineState() })
    });
    const r = await res.json();
    ans = r.answer; mode = r.mode;
    if (r.llm_error) ans += `\n（LLM 调用失败已回退离线引擎：${r.llm_error}）`;
  } catch (e) { ans = "请求失败：" + e.message; }
  const chat2 = getChat();
  chat2.push({ role: "bot", text: ans, mode });
  localStorage.setItem(CHAT_KEY, JSON.stringify(chat2.slice(-40)));
  renderChat();
  const badge = $("#agentModeBadge");
  if (badge) badge.textContent = mode === "llm" ? "LLM 在线模式" : "离线规则引擎 · 通用 skill 已载入";
}

function bindChat() {
  const input = $("#chatInput"), send = $("#chatSend");
  if (!input || !send) return;
  send.onclick = () => { const q = input.value; input.value = ""; askAgent(q); };
  input.onkeydown = e => { if (e.key === "Enter") { const q = input.value; input.value = ""; askAgent(q); } };
  $$("#chatQuick .chat-quick").forEach(chip => chip.onclick = () => askAgent(chip.textContent));
}

boot();
