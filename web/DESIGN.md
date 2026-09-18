# PEOS v2 · 沉浸式个人日程管理工作台 — 设计文档

> 视觉参考：careers.kimi.com 的黑色全屏舞台、像素半色调、极简导航、错落文字、滚动转场。
> **原创约束**：所有视觉对象（中央像素体、纹理、图标、文案、布局）均为本项目原创；不使用 Moonshot/Kimi 的品牌、Logo、文案、图片、源码或相同页面布局。
> 技术栈：React 18 + TypeScript + Vite 5 + GSAP ScrollTrigger。数据层沿用 peos/server.py（不动 vault 之外的任何东西）。

---

## 一、页面结构（7 幕）

```
┌stage（黑色全屏，固定 grain 纹理层 + 场景辉光随章节切换）
│
├─ NAV（极简固定导航）   LOGO ▪ SJY·PEOS ▏ 今日 / 任务 / 状态 / 财务 / 复盘
│
├─ CH0 HERO（100vh）
│   ├ 中央：PixelCore —— 原创像素化"核心体"（canvas，Bayer 抖动球体，呼吸+旋转）
│   ├ 错落大标题：PERSONAL / EXECUTIVE / OS（三行不等距缩进）+ 中文副标
│   ├ 左下：品牌文案（mono 小字：身份 + 事实源声明）
│   ├ 右下：CTA「进入今日 ▸」（像素 hover，锚点滚动）
│   └ 底中：滚动提示 SCROLL ▾（像素箭头 steps 动画）
│
├─ CH1 今日 · 日程（首页即日程表）
│   ├ 左列：日期大字 + 🐸 青蛙区（上午完成，1–3 只）+ 判断引擎（滑块/开关/结论）
│   └ 右列：ScheduleRail 时间轴（块·缓冲·完成线·"现在"高亮）—— 首页主角
│
├─ CH2 任务
│   ├ 任务台账（近14天，按日分组；行式账本，hover 反白；点击勾选回写 vault）
│   └ 内容管道：巨字计数（08 发布 / 07 待写 / 03 灵感）+ 待写清单
│
├─ CH3 状态与差距
│   ├ 雷达（0–5 标尺，白描边发光）+ 总分大字 1.8 → 5.0
│   ├ 四象限 editorial 行（名/分/轨道条/补课动作），非卡片
│   └ 身体趋势 sparkline ×3 + 12周健身 + 半年目标 + 周KPI
│
├─ CH4 财务（新增）
│   ├ 本月大字：收入 / 支出 / 结余（巨字，中缝细分隔）
│   ├ 收支台账（记录流）+ 行内记账表单（类型/金额/类目/日期）
│   ├ 近30天 Daily 支出 sparkline（自动来自每日闭环）
│   └ 预算备注（Yuki 4000/月、家里支持——来自半年框架，config 可改）
│
├─ CH5 复盘
│   ├ 日记编辑器（写入 Daily「📖 今日日记」段）
│   ├ 日记流（emoji + ★评分 + 一句话摘要 + 评价；点击展开全文）
│   └ Agent 终端（等宽字体对话，判断顺序速览）
│
└─ FOOTER（数据源声明 + 版本）
```

## 二、动效时间线（GSAP ScrollTrigger）

| # | 场景 | 触发 | 动效 |
|---|------|------|------|
| T0 | Hero 载入 | load | 标题三行字符 stagger 上浮（0.06s 阶差）；PixelCore 由暗到亮（亮度阈值动画）；nav 淡入 |
| T1 | Hero → CH1 | scrub（hero 离场） | PixelCore scale 1→0.35 + y 上移；标题字符 stagger 下沉消散；grain 透明度 0.5→0.9 |
| T2 | 章节进入 | 每节 `top 75%` | 章节标题字符 stagger；内容块 `[data-reveal]` y+64 → 0，0.9s power3.out |
| T3 | 幽灵编号 | scrub 全程 | 每章背景巨字编号（01–05）yPercent ±18 视差，不同速度 |
| T4 | 场景转场 | 各节 onToggle | body[data-scene] 切换 → 辉光位置/强度 CSS 过渡（顶部→侧位→熄灭） |
| T5 | 鼠标视差 | pointer:fine | Hero：PixelCore ±14px、标题反向 ±6px（lerp 平滑） |
| T6 | 像素 hover | 交互 | nav/CTA：steps(4) 台阶式下划线 + 2px 像素位移 + dither 背块显现 |
| T7 | 勾选回写 | 点击 | 方框 steps(2) 闪烁 → ✓；行 opacity 0.45；失败回滚 |
| T8 | Agent 思考 | 请求中 | "…" steps 点动画；回复行逐条上浮 |

**降级**：`prefers-reduced-motion` → GSAP 场景全部跳过（元素默认可见），PixelCore 静态单帧；移动端（无 pointer:fine）关闭视差，grain 减淡，网格单列。

## 三、组件拆分

```
web/src/
├─ main.tsx / App.tsx          // 场景编排：NAV + 7 幕 + GSAP 装配 + scene 状态
├─ api.ts                      // overview / toggle / diary / ask / finance 全部类型化
├─ hooks.ts                    // useOverview, useEngine(localStorage), useReducedMotion, useMouseParallax
├─ pixel.ts                    // Bayer 4×4 抖动矩阵、像素工具
├─ components/
│  ├ PixelCore.tsx             // 中央视觉：canvas 抖动球体（亮度采样→阈值→像素）
│  ├ Nav.tsx                   // 极简固定导航（scroll spy + 像素 hover）
│  ├ Section.tsx               // 章节壳：幽灵编号 + 错落标题 + data-reveal 收集
│  ├ ScheduleRail.tsx          // 时间轴（块/缓冲/现在高亮）—— 复用于 CH1
│  ├ EngineWidget.tsx          // 判断引擎（滑块/开关/verdict）
│  ├ TaskLedger.tsx            // 任务台账（勾选回写）
│  ├ Radar.tsx / Spark.tsx     // 雷达 & 走势（SVG，白系）
│  ├ DiaryStream.tsx / AgentChat.tsx / DiaryEditor.tsx
│  └ FinanceBoard.tsx          // 大字结余 + 记账表单 + 台账
└─ styles.css                  // 黑色剧场：编辑排版、细规则线、反白 hover、像素工具类
```

## 四、数据与 API（新增）

- `GET /api/finance` → 月度收支、records 台账、近 30 天 Daily 支出、config 预算备注
- `POST /api/finance/record` {type: in|out, amount, category, note, date} → 追加 `peos/data/finance.json`
- `POST /api/finance/record/delete` {id}
- 其余 API（overview/toggle/diary/ask）不变；构建产物 `web/dist` 由 server.py 优先托管（无 dist 时回退旧 static）
