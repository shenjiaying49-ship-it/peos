#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PEOS · SJY Personal Executive OS — 本地只读驾驶舱

原则（继承 Jarvis 方案）：
  - 本地优先：不联网、不调用外部服务，不上传任何数据
  - vault 只读：绝不写 Obsidian；所有数据实时从 markdown 解析
  - 零依赖：仅 Python 3 标准库

启动：python3 server.py  →  http://127.0.0.1:8790
"""
import json
import os
import re
import random
import datetime as dt
import urllib.request
from hashlib import md5
from urllib.parse import urlparse, parse_qs
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE = Path(__file__).resolve().parent
STATIC_DIST = BASE / "web" / "dist"
STATIC = STATIC_DIST if (STATIC_DIST / "index.html").exists() else BASE / "static"
CONFIG = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
VAULT = Path(CONFIG["vault_root"])
DATA_DIR = BASE / "data"

def _today() -> dt.date:
    return dt.date.today()


def _parse_date(value, default=None):
    """Strict ISO calendar date parser used by all write endpoints."""
    if value in (None, "") and default is not None:
        return default
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("日期必须是 YYYY-MM-DD")
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("日期无效") from exc


def _day_context(d=None):
    """Return fixed calendar context for a date, including its work policy."""
    d = d or _today()
    for item in CONFIG.get("calendar_contexts", []):
        try:
            start = _parse_date(item.get("start"))
            end = _parse_date(item.get("end"))
        except ValueError:
            continue
        if start <= d <= end:
            return {**item, "date": d.isoformat(), "day": (d - start).days + 1,
                    "days": (end - start).days + 1, "active": True}
    return {"date": d.isoformat(), "active": False, "mode": "常规",
            "fixed": [], "work_policy": {}}


# ---------------------------------------------------------------- 基础解析

def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def parse_frontmatter(text: str) -> dict:
    """解析简单 YAML frontmatter（key: value 单行形式，够用即可）。"""
    fm = {}
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return fm
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if kv:
            fm[kv.group(1)] = kv.group(2).strip().strip('"').strip("'")
    return fm


def split_sections(text: str):
    """按 ## / ### 标题切分，返回 [(title, body)]。"""
    out, cur_title, buf = [], "", []
    for line in text.splitlines():
        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if m:
            if cur_title or buf:
                out.append((cur_title, "\n".join(buf)))
            cur_title, buf = m.group(2).strip(), []
        else:
            buf.append(line)
    if cur_title or buf:
        out.append((cur_title, "\n".join(buf)))
    return out


TASK_RE = re.compile(r"^\s*-\s*\[([ xX])\]\s*(.*)$")


def parse_tasks(body: str):
    tasks = []
    for line in body.splitlines():
        m = TASK_RE.match(line)
        if m:
            t = m.group(2).strip()
            if t:
                tasks.append({"text": t, "done": m.group(1).lower() == "x",
                              "raw": line.strip()})
    return tasks


TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})")


def parse_schedule(sections):
    """解析「总览主表（任务 × 时间 × 精力）」为时间轴。"""
    rows = []
    for title, body in sections:
        if "总览" not in title:
            continue
        for line in body.splitlines():
            if not line.strip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 4 or set(cells[0]) <= set("-— "):
                continue
            m = TIME_RANGE_RE.search(cells[1]) if len(cells) > 1 else None
            if not m:
                continue
            rows.append({
                "block": strip_md(cells[0]),
                "start": m.group(1), "end": m.group(2),
                "energy": strip_md(cells[2]) if len(cells) > 2 else "",
                "task": strip_md(cells[3]) if len(cells) > 3 else "",
                "type": strip_md(cells[4]) if len(cells) > 4 else "",
                "goal": strip_md(cells[5]) if len(cells) > 5 else "",
            })
    return rows


def strip_md(s: str) -> str:
    s = re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", s)  # [[a|b]] -> b
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)          # [a](b) -> a
    s = re.sub(r"[*`_#>|]", "", s)
    return s.strip()


# ---------------------------------------------------------------- Daily Notes

def daily_path(d: dt.date) -> Path:
    return VAULT / "01 Daily" / f"{d.year}" / f"{d.month:02d}" / f"{d.isoformat()}.md"


def list_recent_dailies(n: int = 30):
    """最近的 n 篇 daily，按日期升序返回 (date, path)。"""
    files = []
    root = VAULT / "01 Daily"
    if root.exists():
        for p in root.rglob("*.md"):
            m = re.match(r"(\d{4}-\d{2}-\d{2})\.md$", p.name)
            if m:
                files.append((dt.date.fromisoformat(m.group(1)), p))
    files.sort()
    return files[-n:]


NUM_FIELDS = {  # 每日闭环「数据补填」字段 → 统一 key
    "体重": "weight", "心情": "mood", "睡眠": "sleep_hours",
    "饮水": "water", "蛋白质": "protein", "总支出": "spend",
}


def parse_daily(path: Path, d: dt.date):
    text = read(path)
    fm = parse_frontmatter(text)
    sections = split_sections(text)

    data = {
        "date": d.isoformat(),
        "exists": True,
        "weight": None, "mood": None, "sleep_score": None,
        "sleep_hours": None, "water": None, "protein": None, "spend": None,
        "sections": [], "tasks_by_section": [],
        "conclusion": "", "frog": "", "not_today": "",
        "decisions": [],
    }
    # frontmatter 数值
    for k in ("weight", "mood", "sleep_score", "sleep_hours", "water"):
        v = fm.get(k)
        if v:
            try:
                data[k] = float(v)
            except ValueError:
                pass

    all_tasks = []
    for title, body in sections:
        tasks = parse_tasks(body)
        if tasks:
            data["tasks_by_section"].append({"section": strip_md(title), "tasks": tasks})
            all_tasks.extend(tasks)
        # 闭环数据补填（frontmatter 空时的回退源）：「每日闭环」或「睡前三问」
        if "闭环" in title or "三问" in title:
            for line in body.splitlines():
                m = re.match(r"^\s*-\s*([\u4e00-\u9fff]+)\s*[：:]\s*([0-9.]+)", line)
                if m and m.group(1) in NUM_FIELDS:
                    try:
                        data[NUM_FIELDS[m.group(1)]] = float(m.group(2))
                    except ValueError:
                        pass
            # 入睡时间 hh:mm → 推算睡眠时长（按夜型 10:30 起床口径）
            m = re.search(r"入睡时间\s*[：:]\s*(\d{1,2})[：:](\d{2})", body)
            if m and not data.get("sleep_hours"):
                sh, sm = int(m.group(1)) % 24, int(m.group(2))
                wake = 10 * 60 + 30
                slept = (wake - (sh * 60 + sm)) % (24 * 60)
                if 180 <= slept <= 780:   # 3–13h 之间才可信
                    data["sleep_hours"] = round(slept / 60, 1)
        if "即时决策" in title:
            for line in body.splitlines():
                m = re.match(r"^\s*-\s+(.+)$", line)
                if m and m.group(1).strip():
                    data["decisions"].append(strip_md(m.group(1)))

    data["total"] = len(all_tasks)
    data["done"] = sum(1 for t in all_tasks if t["done"])
    data["incomplete"] = [t["text"] for t in all_tasks if not t["done"]]
    data["schedule"] = parse_schedule(sections)

    # 日记段（## 📖 今日日记）
    data["diary"] = ""
    for title, body in sections:
        if "日记" in title:
            data["diary"] = body.strip()

    # 重点列表：「今日重点」标记行之后到下一个段落的列表行；
    # 旧文件回退：所有含 🐸 的内容行
    data["frogs"] = []
    in_focus = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            in_focus = False
            continue
        if s.startswith("**") and "重点" in s:
            in_focus = True
            continue
        if s.startswith("**") or (in_focus and not s):
            if s.startswith("**"):
                in_focus = False
            if not s:
                continue
        f = None
        if in_focus and (s.startswith("-") or re.match(r"^\d+[.、]", s)):
            f = s
        elif "🐸" in s:
            f = s
        if f:
            f = strip_md(re.sub(r"^\s*[-*]?\s*(\d+[.、])?\s*", "", f))
            f = re.sub(r"^(青蛙|今日重点)[：:]\s*", "", f).replace("🐸", "").replace("⚡", "").strip(" —-")
            if len(f) > 4 and f not in data["frogs"]:
                data["frogs"].append(f)

    # 今日结论 / 明确不做（青蛙已由 frogs 列表覆盖）
    PLACEHOLDER = ("用一段话说明", "保留历史状态", "只写任务顺序")
    for title, body in sections:
        if "今日结论" in title:
            for line in body.splitlines():
                if line.strip().startswith(">"):
                    c = strip_md(line.lstrip("> "))
                    if c and not c.startswith(PLACEHOLDER):
                        data["conclusion"] = c
        if "今日模型" in title or "三件事" in title:
            for line in body.splitlines():
                if "明确不做" in line:
                    data["not_today"] = strip_md(line.split("：", 1)[-1])
    data["frog"] = data["frogs"][0] if data["frogs"] else ""

    # 复盘卡片：emoji + 摘要 + 评分 + 评价
    data["card"] = daily_card(data, text)
    return data


EMOJI_RULES = [
    ("💪", ["健身", "训练", "力量", "臀", "gym", "硬拉", "臀推"]),
    ("🏊", ["游泳"]),
    ("🧗", ["攀岩", "岩馆"]),
    ("📚", ["课", "MKT", "CEC", "上课", "讲座", "自习", "作业"]),
    ("📱", ["发布", "发出去", "上传", "草稿箱"]),
    ("✍️", ["写作", "写稿", "选题", "脚本", "成稿", "长文"]),
    ("🎌", ["日语", "假名", "跟读"]),
    ("🗣", ["英语", "IELTS", "雅思", "口述", "单词"]),
    ("🤝", ["社交", "朋友", "对话", "coffee", "Coffee", "私董", "networking"]),
    ("😴", ["睡", "休息", "恢复", "午休"]),
    ("🍱", ["午餐", "晚餐", "吃", "食堂", "蛋白"]),
    ("🧠", ["复盘", "计划", "洞察", "决策"]),
]


def daily_card(data: dict, full_text: str) -> dict:
    hay = full_text
    emoji, best = "🗓", 0
    for e, kws in EMOJI_RULES:
        n = sum(hay.count(k) for k in kws)
        if n > best:
            emoji, best = e, n

    # 摘要优先级：结论 > 青蛙 > 首个完成任务 > 日记首行
    summary = ""
    for cand in (data.get("conclusion"),
                 data["frogs"][0] if data["frogs"] else "",
                 next((t["text"] for t in
                       [t for sec in data["tasks_by_section"] for t in sec["tasks"]] if t["done"]), ""),
                 (data.get("diary") or "").split("\n")[0]):
        cand = (cand or "").strip()
        if cand and not cand.startswith("用一段话说明"):
            summary = cand[:46] + ("…" if len(cand) > 46 else "")
            break

    # 评分（0–5）：完成率 3.5 分 + 有日记 1 分，空日 0
    if data["total"] == 0:
        rating = 1 if data.get("diary") else 0
    else:
        rating = max(0, min(5, round(data["done"] / data["total"] * 3.5)
                            + (1 if data.get("diary") else 0)))

    # 评价
    done, total, frogs = data["done"], data["total"], data["frogs"]
    if total == 0 and not data.get("diary"):
        comment = "空模板日 —— 没有任务也没有日记"
    elif total == 0:
        comment = "只有日记没有任务 —— 记录了，但今天没建执行线"
    elif done == total:
        comment = f"全部闭环（{done}/{total}），节奏漂亮"
    elif done / total >= 0.6:
        comment = f"完成 {done}/{total}，主线在推进"
    elif done > 0:
        comment = f"完成 {done}/{total}，注意未闭环项堆积"
    else:
        comment = f"0/{total} 未勾 —— 是没做还是没勾？晚间问询校准一下"
    if frogs and total > 0:
        done_texts = " ".join(t["text"] for sec in data["tasks_by_section"] for t in sec["tasks"] if t["done"])
        frog_done = any(sum(1 for w in [f[i:i + 6] for i in range(0, max(1, len(f) - 5), 3)]
                            if w and w in done_texts) >= 1 for f in frogs)
        comment = ("🎯重点已做；" if frog_done else "🎯重点待做；") + comment

    return {"emoji": emoji, "summary": summary or "（无摘要）",
            "rating": rating, "comment": comment}


# ---------------------------------------------------------------- 内容排期表

def parse_content_calendar():
    p = VAULT / "02 Projects" / "内容创作" / "内容排期表.md"
    text = read(p)
    stats = {"已发布": 0, "待写": 0, "灵感": 0, "草稿箱": 0, "过期": 0}
    todo, published_recent = [], []
    current_table = None
    for line in text.splitlines():
        if line.startswith("#"):
            if "大号" in line and "选题管道" in line:
                current_table = "big"
            elif "小号" in line and "发布记录" in line:
                current_table = "small"
            else:
                current_table = None
            continue
        if current_table != "big" or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or set(cells[0]) <= set("-— "):
            continue
        topic, status, pub = cells[0], cells[2], cells[5] if len(cells) > 5 else ""
        if "选题" in topic:
            continue
        s = strip_md(status)
        if "已发布" in s:
            stats["已发布"] += 1
            published_recent.append({"topic": strip_md(topic), "date": strip_md(pub) or "?"})
        elif "过期" in s or "❌" in s:
            stats["过期"] += 1
        elif "草稿箱" in s:
            stats["草稿箱"] += 1
        elif "待写" in s or "待梳理" in s:
            stats["待写"] += 1
            todo.append({"topic": strip_md(topic), "status": s, "plan": strip_md(pub)})
        elif "灵感" in s:
            stats["灵感"] += 1
            todo.append({"topic": strip_md(topic), "status": s, "plan": ""})
    return {
        "stats": stats,
        "todo": todo,
        "recent_published": published_recent[-6:][::-1],
        "source": str(p),
    }


# ---------------------------------------------------------------- 课表 + 结课要求（courses.json）

_COURSES_CACHE = None

def load_courses():
    global _COURSES_CACHE
    if _COURSES_CACHE is not None:
        return _COURSES_CACHE
    p = DATA_DIR / "courses.json"
    if p.exists():
        _COURSES_CACHE = json.loads(p.read_text(encoding="utf-8"))
    else:
        _COURSES_CACHE = {"courses": []}
    return _COURSES_CACHE


def _is_holiday(d=None):
    """判断指定日期是否在校历放假日内。"""
    d = d or _today()
    ds = d.isoformat() if isinstance(d, dt.date) else str(d)
    holidays = load_courses().get("holidays", [])
    return ds in holidays


def _makeup_weekday(d=None):
    """如果是调休补课日，返回应上的 weekday（1=周一…5=周五）；否则返回 None。"""
    d = d or _today()
    ds = d.isoformat() if isinstance(d, dt.date) else str(d)
    makeup = load_courses().get("makeup_days", {})
    return makeup.get(ds)


def today_course_blocks(d=None):
    """返回指定日期（默认今天）的课程时间块，按开始时间排序。
    放假日无课；调休补课日按补课 weekday 排课。"""
    d = d or _today()
    # 放假日 → 无课
    if _is_holiday(d):
        return []
    # 调休补课日 → 按映射的 weekday 排课
    makeup_wd = _makeup_weekday(d)
    wd = (makeup_wd - 1) if makeup_wd else d.weekday()  # 0=周一
    courses = load_courses().get("courses", [])
    blocks = []
    for c in courses:
        if c["weekday"] != wd + 1:
            continue
        # 计算是第几次课
        first = dt.date.fromisoformat(c["first_date"])
        session_no = (d - first).days // 7 + 1
        if 1 <= session_no <= c["sessions"]:
            blocks.append({
                "code": c["code"], "name": c["name"],
                "start": c["start_time"], "end": c["end_time"],
                "location": c["location"],
                "session": f"第 {session_no}/{c['sessions']} 次",
                "weekday_cn": c["weekday_cn"],
                "is_makeup": makeup_wd is not None,
            })
    blocks.sort(key=lambda b: b["start"])
    return blocks


def upcoming_deadlines(days_ahead=30, d=None):
    """返回未来 N 天内的结课要求 / 截止日期。"""
    d = d or _today()
    courses = load_courses().get("courses", [])
    out = []
    for c in courses:
        for a in c.get("assessments", []):
            due = a.get("due")
            if not due:
                continue
            try:
                dd = dt.date.fromisoformat(due)
            except ValueError:
                continue
            delta = (dd - d).days
            if -1 <= delta <= days_ahead:
                out.append({
                    "date": due, "days_away": delta,
                    "course": c["code"], "course_name": c["name"],
                    "item": a["item"], "weight": a.get("weight"),
                    "note": a.get("note") or "",
                    "weekday_cn": c["weekday_cn"],
                })
    out.sort(key=lambda x: x["date"])
    return out


def today_deadlines(d=None):
    """返回今天截止的作业。"""
    d = d or _today()
    return [x for x in upcoming_deadlines(0, d) if x["days_away"] == 0]


# ---------------------------------------------------------------- 入学时间线（近期截止）

def parse_timeline():
    p = VAULT / "03 Areas" / "个人效率" / "港中深 MSc Marketing 入学时间线.md"
    text = read(p)
    events = []
    in_table = False
    for line in text.splitlines():
        if line.startswith("#"):
            in_table = "日期时间线" in line
            continue
        if not in_table or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        m = re.match(r"(?:约\s*)?(\d{2})-(\d{2})", cells[0])
        if not m:
            continue
        try:
            d = dt.date(_today().year, int(m.group(1)), int(m.group(2)))
        except ValueError:
            continue
        item = strip_md(cells[1]) if len(cells) > 1 else ""
        result = strip_md(cells[2]) if len(cells) > 2 else ""
        if item and "日期" not in cells[0]:
            events.append({"date": d.isoformat(), "days_away": (d - _today()).days,
                           "item": item, "result": result})
    return sorted([e for e in events if -1 <= e["days_away"] <= 60], key=lambda x: x["date"])


# ---------------------------------------------------------------- KPI 估算（近 7 天完成 checkbox 的关键词匹配）

def estimate_kpi(dailies):
    counts = {t["id"]: 0 for t in CONFIG["kpi_weekly"]["targets"]}
    week_ago = _today() - dt.timedelta(days=6)
    for d, path in dailies:
        if d < week_ago:
            continue
        data = parse_daily(path, d)
        texts = [t["text"] for sec in data["tasks_by_section"] for t in sec["tasks"] if t["done"]]
        texts += [line for line in (data.get("conclusion") or "")]  # 结论不计数，仅任务
        joined = "∥".join(texts)
        for tgt in CONFIG["kpi_weekly"]["targets"]:
            if any(kw in joined for kw in tgt["keywords"]):
                counts[tgt["id"]] += 1
    return counts


# ---------------------------------------------------------------- 任务勾选（回写 Daily Note）

def toggle_task(date_iso: str, section: str, raw_line: str, done: bool):
    """把 Daily Note 中某行 checkbox 翻转。精确匹配原始行，只动 [ ] 标记。"""
    d = dt.date.fromisoformat(date_iso)
    p = daily_path(d)
    if not p.exists():
        return {"ok": False, "error": f"Daily Note 不存在：{p.name}"}
    text = p.read_text(encoding="utf-8")
    lines = text.split("\n")
    marker = "x" if done else " "

    def flip(i):
        lines[i] = TASK_RE.sub(lambda mm: f"- [{marker}] {mm.group(2)}", lines[i], count=1)
        p.write_text("\n".join(lines), encoding="utf-8")

    cur = ""
    for i, line in enumerate(lines):          # 先在指定分区内找
        m = re.match(r"^#{2,3}\s+(.*)$", line)
        if m:
            cur = m.group(1).strip()
            continue
        if line.strip() == raw_line and TASK_RE.match(line):
            if not section or strip_md(cur) == strip_md(section):
                flip(i)
                return {"ok": True, "path": str(p)}
    for i, line in enumerate(lines):          # 分区没对上 → 全文唯一行兜底
        if line.strip() == raw_line and TASK_RE.match(line):
            flip(i)
            return {"ok": True, "path": str(p), "fallback": True}
    return {"ok": False, "error": "没找到该行（文件可能刚被改动，请刷新页面）"}


# ---------------------------------------------------------------- 日记（复盘台读写）

DIARY_TITLE = "## 📖 今日日记"


def read_diary(date_iso: str):
    try:
        d = dt.date.fromisoformat(date_iso)
    except ValueError:
        return {"ok": False, "error": "bad date"}
    p = daily_path(d)
    if not p.exists():
        return {"ok": True, "exists": False, "full": ""}
    return {"ok": True, "exists": True, "full": read(p)}


def save_diary(date_iso: str, text: str):
    """写入当天 Daily 的「📖 今日日记」段。只动这一段，其余内容不碰。
    文件不存在时用轻量模板创建。"""
    try:
        d = dt.date.fromisoformat(date_iso)
    except ValueError:
        return {"ok": False, "error": "bad date"}
    p = daily_path(d)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = (text or "").strip()

    if not p.exists():
        content = (f"---\ntype: daily\ndate: {d.isoformat()}\ntags:\n  - daily/plan\n---\n\n"
                   f"# {d.isoformat()} · 今日计划\n\n"
                   f"{DIARY_TITLE}\n\n{text}\n")
        p.write_text(content, encoding="utf-8")
        return {"ok": True, "path": str(p), "created": True}

    lines = read(p).split("\n")
    # 找日记段（标题行 → 下一个 ## 或 EOF）
    try:
        ti = next(i for i, l in enumerate(lines) if l.strip() == DIARY_TITLE)
        te = next((i for i in range(ti + 1, len(lines))
                   if lines[i].startswith("## ")), len(lines))
        # 保留段后原有空行结构
        tail = lines[te:]
        lines = lines[:ti] + [DIARY_TITLE, "", *text.split("\n")] + ([""] if tail else []) + tail
    except StopIteration:
        lines = lines + ["", DIARY_TITLE, "", *text.split("\n"), ""]
    p.write_text("\n".join(lines), encoding="utf-8")
    return {"ok": True, "path": str(p), "created": False}


# ---------------------------------------------------------------- 天气 + 每日名言

WX_CACHE = {"ts": 0.0, "data": None}
WMO = [(0, "晴", "☀️"), (1, "大致晴", "🌤"), (2, "多云", "⛅"), (3, "阴", "☁️"),
       (45, "雾", "🌫"), (48, "雾凇", "🌫"), (51, "毛毛雨", "🌦"), (61, "小雨", "🌦"),
       (63, "中雨", "🌧"), (65, "大雨", "🌧"), (80, "阵雨", "🌧"), (95, "雷暴", "⛈")]


def _wmo(code: int):
    best = WMO[0]
    for w in WMO:
        if w[0] <= code:
            best = w
    return best[1], best[2]


QUOTES = [
    ("你的「不知道想要什么」是你的内容，不是你的障碍。", "HUMAN3.0"),
    ("要么自由，要么有一件你心甘情愿不自由的事。", "二选一原则"),
    ("调研必须以行动为导向，否则是拖延的高级形态。", "与开开的对话"),
    ("审美本身就是一种判断。", "与开开的对话"),
    ("You are the niche. 你就是那个利基。", "HUMAN3.0"),
    ("先经历亲密、感受脆弱、被理解，然后才能选择从容。", "前-超谬误警告"),
    ("作品永远是最好的敲门砖。", "与开开的对话"),
    ("把消耗变成素材。", "HUMAN3.0 策略"),
    ("做事的人 vs 做决定的人——实习生最大的特权是可以无限试错。", "与开开的对话"),
    ("质量不是这个月的指标，发出去才是。", "HUMAN3.0 · 月份 1"),
    ("框架是脚手架，不是枷锁。", "2026 秋半年框架"),
    ("输入过载、输出不足。", "HUMAN3.0"),
    ("知道为什么而活的人，便能生存。", "尼采"),
    ("我们塑造工具，然后工具塑造我们。", "麦克卢汉"),
    ("简单比复杂更难，但你必须努力让它简单。", "乔布斯"),
    ("未来的文盲不是不会读写的人，而是不会学习的人。", "托夫勒"),
    ("预测未来最好的方式，就是创造它。", "德鲁克"),
    (" Stay hungry, stay foolish. ", "Whole Earth Catalog"),
    ("凡是先想清楚再动手的人，往往一辈子没动手。", "张咋啦"),
    ("过好每一天。", "半年框架心态"),
]


def get_weather():
    import time
    now = time.time()
    if WX_CACHE["data"] and now - WX_CACHE["ts"] < 3 * 3600:
        data = WX_CACHE["data"]
    else:
        try:
            url = ("https://api.open-meteo.com/v1/forecast?latitude=22.5431&longitude=114.0579"
                   "&current=temperature_2m,weather_code"
                   "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
                   "&timezone=Asia%2FShanghai&forecast_days=1")
            with urllib.request.urlopen(url, timeout=8) as r:
                raw = json.loads(r.read().decode("utf-8"))
            cur, dly = raw["current"], raw["daily"]
            desc, emoji = _wmo(int(cur["weather_code"]))
            data = {"ok": True, "city": "深圳", "temp": round(cur["temperature_2m"]),
                    "desc": desc, "emoji": emoji,
                    "tmax": round(dly["temperature_2m_max"][0]),
                    "tmin": round(dly["temperature_2m_min"][0]),
                    "rain": dly["precipitation_probability_max"][0] or 0}
            WX_CACHE.update(ts=now, data=data)
        except Exception as e:
            data = {"ok": False, "error": str(e)}
    quote = QUOTES[_today().timetuple().tm_yday % len(QUOTES)]
    return {"weather": data, "quote": {"text": quote[0], "author": quote[1]}}


# ---------------------------------------------------------------- 书影记录（书 / 剧 · 评分 · 书评）

def _load_media() -> dict:
    p = DATA_DIR / "media.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": []}


def _save_media(m: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "media.json").write_text(
        json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")


def add_media(body: dict):
    m = _load_media()
    item = {
        "id": f"{_today().strftime('%Y%m%d')}-{dt.datetime.now().strftime('%H%M%S')}",
        "date": body.get("date") or _today().isoformat(),
        "type": "book" if body.get("type") == "book" else "show",
        "title": str(body.get("title") or "").strip()[:60],
        "rating": max(0, min(10, int(float(body.get("rating") or 0)))),
        "review": str(body.get("review") or "").strip()[:2000],
    }
    if not item["title"]:
        return {"ok": False, "error": "标题不能为空"}
    m["items"].insert(0, item)
    _save_media(m)
    return {"ok": True, "item": item}


def delete_media(rid: str):
    m = _load_media()
    before = len(m["items"])
    m["items"] = [x for x in m["items"] if x["id"] != rid]
    _save_media(m)
    return {"ok": len(m["items"]) < before}


# ---------------------------------------------------------------- 待写清单（手动维护）

def _load_topics() -> dict:
    p = DATA_DIR / "topics.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": []}


def _save_topics(t: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "topics.json").write_text(
        json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")


def add_topic(body: dict):
    t = _load_topics()
    text = str(body.get("text") or "").strip()[:80]
    if not text:
        return {"ok": False, "error": "内容不能为空"}
    t["items"].insert(0, {
        "id": dt.datetime.now().strftime("%Y%m%d%H%M%S"),
        "date": body.get("date") or _today().isoformat(),
        "text": text,
        "note": str(body.get("note") or "").strip()[:80],
        "done": False,
    })
    _save_topics(t)
    return {"ok": True}


def toggle_topic(tid: str):
    t = _load_topics()
    for x in t["items"]:
        if x["id"] == tid:
            x["done"] = not x["done"]
            _save_topics(t)
            return {"ok": True}
    return {"ok": False, "error": "not found"}


def delete_topic(tid: str):
    t = _load_topics()
    before = len(t["items"])
    t["items"] = [x for x in t["items"] if x["id"] != tid]
    _save_topics(t)
    return {"ok": len(t["items"]) < before}


# ---------------------------------------------------------------- 月度校准（深度问答 → 重标四象限）

CALIB_QUESTIONS = [
    ("q1", "这个月真正发布了几篇？（不是写了几篇）"),
    ("q2", "哪一篇写完后最有「想再写」的能量？"),
    ("q3", "做了几次深度对话实验？印象最深的一句是什么？"),
    ("q4", "和爸妈的对话有没有比上个月深一层？"),
    ("q5", "反愿景（你绝对拒绝的人生形态）有需要更新的地方吗？"),
    ("q6", "重新打分前：这个月最大的变化是什么？"),
    ("q7", "「通道感」在加强还是减弱？为什么？"),
]


def _load_calib() -> dict:
    p = DATA_DIR / "calibration.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"records": []}


def get_calibration():
    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    cur = {i["id"]: i["current"] for i in cfg["quadrants"]["items"]}
    recs = _load_calib()["records"]
    last = recs[0]["date"][:10] if recs else None
    return {"ok": True, "questions": [{"id": k, "q": q} for k, q in CALIB_QUESTIONS],
            "current": cur, "current_total": cfg["quadrants"]["current_total"],
            "records": recs[:6], "last_date": last,
            "days_since": (_today() - dt.date.fromisoformat(last)).days if last else None}


def save_calibration(body: dict):
    answers = body.get("answers") or {}
    scores = body.get("scores") or {}
    cfg_path = BASE / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    items = cfg["quadrants"]["items"]
    prev = {i["id"]: i["current"] for i in items}
    valid = {}
    for item in items:
        v = scores.get(item["id"])
        if v is None or v == "":
            continue
        try:
            v = round(max(0.0, min(5.0, float(v))), 1)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"{item['id']} 分数无效"}
        item["current"] = v
        valid[item["id"]] = v
    if not valid:
        return {"ok": False, "error": "至少给一个象限打分"}
    cfg["quadrants"]["current_total"] = round(
        sum(i["current"] for i in items) / len(items), 1)
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    calib = _load_calib()
    calib["records"].insert(0, {
        "date": dt.datetime.now().isoformat(timespec="seconds"),
        "answers": {k: str(answers.get(k, ""))[:300] for k, _ in CALIB_QUESTIONS},
        "scores": {i["id"]: i["current"] for i in items},
        "prev": prev,
    })
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "calibration.json").write_text(
        json.dumps(calib, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "prev": prev,
            "scores": {i["id"]: i["current"] for i in items},
            "current_total": cfg["quadrants"]["current_total"]}


# ---------------------------------------------------------------- 目标进度追踪（读书 / 看剧）

def _load_progress() -> dict:
    p = DATA_DIR / "progress.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": []}


def _save_progress(pr: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "progress.json").write_text(
        json.dumps(pr, ensure_ascii=False, indent=1), encoding="utf-8")


def progress_suggestions(d=None):
    """Suggest a small next step from persisted reading/viewing progress.
    有 finish_by 时按剩余天数自适应配速，但设硬上限（页 45 / 集 5）——
    拖了几天不该被 90 页/天惩罚，超出上限自动放缓并顺延 finish_by。"""
    d = d or _today()
    out = []
    pr = _load_progress()
    changed = False
    for item in pr.get("items", []):
        current, total = item.get("current", 0), item.get("total", 0)
        if current >= total or total <= 0:
            continue
        remaining = total - current
        cap = 45 if item.get("kind") == "book" else 5      # 每日硬上限
        target = min(remaining, max(1, int(item.get("daily_target", 1))))
        pace_note = ""
        finish_by = item.get("finish_by")
        if finish_by:
            try:
                days_left = max(1, (dt.date.fromisoformat(str(finish_by)) - d).days)
                ideal = -(-remaining // days_left)
                if ideal > cap:
                    # 配速爆表 → 放缓到上限，并顺延 finish_by 到刚好可行
                    new_days = -(-remaining // cap)
                    item["finish_by"] = (d + dt.timedelta(days=new_days)).isoformat()
                    changed = True
                    pace_note = f"（原计划太赶已自动放缓到每天 {cap}{ '页' if item.get('kind') == 'book' else '集' }——想加速就多读）"
                    ideal = cap
                target = min(remaining, max(1, ideal))
                if not pace_note:
                    pace_note = f"（{days_left} 天内读完，每天约 {target}{ '页' if item.get('kind') == 'book' else '集' }）"
            except ValueError:
                pass
        unit = "页" if item.get("kind") == "book" else "集"
        out.append({"id": item.get("id"), "kind": item.get("kind"),
                    "title": item.get("title"), "current": current, "total": total,
                    "suggested": target, "unit": unit,
                    "text": f"{item.get('title')}：今天读 {target}{unit}（已读 {current}/{total}）{pace_note}"})
    if changed:
        _save_progress(pr)
    return out[:5]


# ---------------------------------------------------------------- 微信读书同步（非官方 API · 实验性）

WEREAD_COOKIE_PATH = DATA_DIR / "weread_cookie.txt"


def _weread_cookie() -> str:
    if WEREAD_COOKIE_PATH.exists():
        c = WEREAD_COOKIE_PATH.read_text(encoding="utf-8").strip()
        if c:
            return c
    return ""


def _norm_title(s: str) -> str:
    """书名宽松归一化：去书名号/括号前缀/空格/分隔符，取小写。"""
    s = re.sub(r"[《》\[\]·\s\-—_:：]", "", str(s or ""))
    return s.lower()


# ---------------------------------------------------------------- 结课要求达成度（出勤追踪）

def _course_attendance():
    """扫描 Daily：勾选任务里含课程代码 → 该课出勤 1 次。
    tracking_since 之前的课无法追溯（勾选系统上线前），只从该日起计数。
    返回 {code: {attended, sessions_elapsed, required, note}}。"""
    courses = load_courses().get("courses", [])
    by_code = {c["code"]: c for c in courses}
    try:
        req_doc = json.loads((DATA_DIR / "course_requirements.json").read_text(encoding="utf-8"))
    except Exception:
        req_doc = {}
    since = dt.date.fromisoformat(str(req_doc.get("tracking_since", "2026-10-08")))
    attended = {c["code"]: 0 for c in courses}
    for d, path in list_recent_dailies(90):
        if d < since:
            continue
        data = parse_daily(path, d)
        done_texts = "∥".join(t["text"] for sec in data["tasks_by_section"]
                              for t in sec["tasks"] if t["done"])
        for code in attended:
            if code in done_texts:
                attended[code] += 1
    today = _today()
    out = {}
    for g in req_doc.get("gates", []):
        code = g["course"]
        c = by_code.get(code)
        if not c or g["type"] != "attendance":
            continue
        first = dt.date.fromisoformat(c["first_date"])
        # 追踪期内的应上课时数（按周计，扣放假日；补课日另加）
        elapsed = 0
        wd = (c["weekday"] - 1)
        d = first
        holidays = set(load_courses().get("holidays", []))
        makeup = load_courses().get("makeup_days", {})
        while d <= today:
            is_class_day = (d.weekday() == wd) != (makeup.get(d.isoformat()) == c["weekday"])
            if is_class_day and d >= since and d.isoformat() not in holidays:
                elapsed += 1
            d += dt.timedelta(days=1)
        out[code] = {"attended": attended.get(code, 0), "sessions_elapsed": elapsed,
                     "sessions_total": c.get("sessions", 15), "required": g["required"],
                     "note": g["note"]}
    return out


def course_progress():
    """结课要求达成度总览：出勤硬门槛 + 逾期/即将截止。"""
    att = _course_attendance()
    items = []
    for code, a in sorted(att.items()):
        pace_ok = a["attended"] >= a["sessions_elapsed"]           # 一节没落
        proj = a["attended"] + max(0, a["sessions_total"] - a["sessions_elapsed"])  # 全勤假设下最终出勤
        will_meet = proj >= a["required"]
        items.append({
            "course": code, **a, "missed": max(0, a["sessions_elapsed"] - a["attended"]),
            "projected": proj, "will_meet": will_meet,
            "status": ("ok" if pace_ok and will_meet else
                       "risk" if will_meet else "danger"),
        })
    return {"ok": True, "attendance": items,
            "doc": "03 Areas/学业/2026秋·结课要求总览.md"}


def weread_status():
    c = _weread_cookie()
    return {"ok": True, "cookie_set": bool(c),
            "hint": "把浏览器 weread.qq.com 请求头里的 Cookie 整行粘贴到 peos/data/weread_cookie.txt 即可启用"}


def weread_sync():
    """拉微信读书书架在读进度 → 回写 progress.json 的 current。
    非官方 web API：cookie 失效时返回明确错误，进度回退手动 +N。"""
    cookie = _weread_cookie()
    if not cookie:
        return {"ok": False, "error": "未配置 cookie：在浏览器登录 weread.qq.com → F12 复制请求 Cookie 整行 → 粘贴到 peos/data/weread_cookie.txt"}
    req = urllib.request.Request(
        "https://weread.qq.com/web/shelf/sync?userHashId=&synckeys=0",
        headers={
            "Cookie": cookie,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://weread.qq.com/web/shelf",
        })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        hint = "cookie 大概率过期了，重新抓一次 Cookie 覆盖 weread_cookie.txt" if e.code in (401, 403) else str(e)
        return {"ok": False, "error": f"微信读书返回 HTTP {e.code}：{hint}"}
    except Exception as e:
        return {"ok": False, "error": f"请求失败：{e}"}

    # 防御式遍历：书架 JSON 里所有带标题的对象，找进度字段（字段名随版本变动，多候选兼容）
    found = {}
    def _walk(o):
        if isinstance(o, dict):
            title = o.get("title")
            if isinstance(title, str) and title:
                for k in ("progress", "readProgress", "readingProgress"):
                    v = o.get(k)
                    if isinstance(v, (int, float)) and 0 < v < 1000:
                        found[_norm_title(title)] = min(100.0, float(v))
                        break
            for v in o.values():
                _walk(v)
        elif isinstance(o, list):
            for v in o:
                _walk(v)
    _walk(payload)
    if not found:
        return {"ok": False, "error": "书架解析不到在读进度字段（微信读书接口可能改版）——先手动 +N，回头再修同步"}

    pr = _load_progress()
    updated, unmatched = [], []
    for item in pr.get("items", []):
        key = _norm_title(item.get("title", ""))
        # 宽松匹配：progress 标题去掉前缀后是 weread 书名的子串（或反过来）
        hit = None
        for k, v in found.items():
            if k and key and (k in key or key in k):
                hit = v
                break
        if hit is None:
            unmatched.append(item.get("title"))
            continue
        new_cur = min(int(item.get("total", 0)) or 0, round(int(item.get("total", 0)) * hit / 100))
        if new_cur > int(item.get("current", 0)):
            item["current"] = new_cur
            item["weread_synced"] = _today().isoformat()
            updated.append(f"{item.get('title')} → {new_cur}/{item.get('total')}（{hit:.0f}%）")
    if updated:
        _save_progress(pr)
    return {"ok": True, "shelf_progress": len(found), "updated": updated,
            "unmatched": unmatched[:5], "note": "只更新进度，不改总量" if updated else "书架有在读书但没匹配到追踪项（标题需含书名）"}


# ---------------------------------------------------------------- 近 7 天生活信号（弱点可视化）

def recent_insights(days: int = 7):
    """近 N 天生活信号：睡眠 / 日记缺口 / 完成率 / 运动 / 超支 / 最弱象限。
    数据全部来自 Daily frontmatter 与勾选记录 —— 日记和回填越勤，信号越准。"""
    days = max(3, min(int(days or 7), 30))
    budget = CONFIG.get("finance", {}).get("daily_budget", 100)
    sleeps, diary_missing, overspend, sport_days = [], [], 0, 0
    done_all = total_all = 0
    quad_done = {"心智": 0, "身体": 0, "精神": 0, "事业": 0}
    for d, path in list_recent_dailies(days + 1):
        if d >= _today():
            continue   # 今天还没过完，不计入弱点信号
        data = parse_daily(path, d)
        if data.get("sleep_hours"):
            try:
                sleeps.append(float(data["sleep_hours"]))
            except (TypeError, ValueError):
                pass
        if not data.get("diary"):
            diary_missing.append(d)
        if data.get("spend"):
            try:
                if float(data["spend"]) > budget:
                    overspend += 1
            except (TypeError, ValueError):
                pass
        done_all += data["done"]
        total_all += data["total"]
        done_texts = ""
        for sec in data["tasks_by_section"]:
            done_texts += " ".join(t["text"] for t in sec["tasks"] if t["done"]) + " "
            for label in quad_done:
                if label in sec["section"]:
                    quad_done[label] += sum(1 for t in sec["tasks"] if t["done"])
        if any(k in done_texts for k in ("攀岩", "游泳", "羽毛球", "爬坡", "有氧", "力量训练", "散步")):
            sport_days += 1

    signals = []
    if sleeps:
        avg = sum(sleeps) / len(sleeps)
        if avg < 7:
            signals.append({"icon": "🌙", "text": f"平均睡眠 {avg:.1f}h。你不是要体脂 22% 吗？睡不够练了也白练，今天 00:00 给我躺下。"})
        else:
            signals.append({"icon": "🌙", "text": f"平均睡眠 {avg:.1f}h，这条线守住了。"})
    else:
        signals.append({"icon": "🌙", "text": f"近 {days} 天没记过入睡时间 —— 三问里的「入睡时间」一行都不填，我只能瞎猜你的状态。30 秒的事。"})
    if diary_missing:
        last = max(diary_missing).isoformat()[5:]
        signals.append({"icon": "📓", "text": f"{len(diary_missing)} 天没写日记（最近断在 {last}）。不写日记我就不知道你过得怎么样，排程只能瞎排——别让系统瞎。"})
    if total_all >= 5:
        rate = done_all / total_all
        if rate < 0.5:
            signals.append({"icon": "⚠️", "text": f"任务完成率 {rate:.0%}（{done_all}/{total_all}）。看清楚了，这是你自己的日子不是我的。今天只勾一件也行，勾。"})
        else:
            signals.append({"icon": "✅", "text": f"任务完成率 {rate:.0%}（{done_all}/{total_all}），就这样干。"})
    if sport_days < days * 0.5:
        signals.append({"icon": "🏃", "text": f"运动 {sport_days}/{days} 天。说好的每天晨泳呢？水又不会自己来游你。"})
    else:
        signals.append({"icon": "🏃", "text": f"运动 {sport_days}/{days} 天，动起来了。"})
    if overspend:
        signals.append({"icon": "💸", "text": f"{overspend} 天超日预算 ¥{budget}。你自己说的爱花钱——预算不是跟我商量，是跟钱包商量。"})
    if total_all >= 5 and any(quad_done.values()):
        weakest, cnt = min(quad_done.items(), key=lambda kv: kv[1])
        signals.append({"icon": "🎯", "text": f"最弱象限：{weakest}（{cnt} 件）。今天给它 15 分钟，就 15 分钟，别跟我讨价还价。"})
    return {"ok": True, "days": days, "signals": signals}


def add_progress(body: dict):
    pr = _load_progress()
    title = str(body.get("title") or "").strip()[:60]
    total = int(body.get("total") or 0)
    if not title or total <= 0:
        return {"ok": False, "error": "标题和总量必填（页数 / 集数）"}
    current = max(0, min(total, int(body.get("current") or 0)))
    item = {"id": dt.datetime.now().strftime("%Y%m%d%H%M%S"),
            "kind": "book" if body.get("kind") == "book" else "show",
            "title": title, "current": current,
            "total": total, "date": _today().isoformat(),
            "daily_target": max(1, int(body.get("daily_target") or (10 if body.get("kind") == "book" else 1)))}
    pr["items"].insert(0, item)
    _save_progress(pr)
    return {"ok": True, "item": item}


def inc_progress(pid: str, delta: int):
    pr = _load_progress()
    for x in pr["items"]:
        if x["id"] == pid:
            x["current"] = max(0, min(x["total"], x["current"] + int(delta)))
            _save_progress(pr)
            return {"ok": True, "item": x}
    return {"ok": False, "error": "not found"}


def delete_progress(pid: str):
    pr = _load_progress()
    before = len(pr["items"])
    pr["items"] = [x for x in pr["items"] if x["id"] != pid]
    _save_progress(pr)
    return {"ok": len(pr["items"]) < before}


# ---------------------------------------------------------------- 工作上下文（每日 30 秒状态输入）

WORK_CONTEXT_QUESTIONS = [
    ("focus", "今天最重要的在线工作是什么？"),
    ("dahao_stage", "大号今天推进到哪一步？"),
    ("dahao_options", "选题 / 素材 / 草稿 / 修改 / 发布 / 复盘"),
    ("fixed", "今天必须守住的会议、课程或截止时间？"),
    ("limitation", "旅行/身体限制？"),
]

def _load_work_context(date_str: str = None) -> dict:
    p = DATA_DIR / "work_context.json"
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if date_str:
                if date_str in data:
                    return data[date_str]
                # 没有当天记录 → 沿用最近一次（≤ 当天）的上下文，直到被显式更新
                past = [k for k in data if k <= date_str and isinstance(data[k], dict)]
                if past:
                    return data[max(past)]
                return {}
            return data
        except Exception:
            pass
    return {}

def _save_work_context_raw(data: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "work_context.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

def get_work_context(date_str: str = None) -> dict:
    date_str = date_str or _today().isoformat()
    all_ctx = _load_work_context()
    return {"ok": True, "date": date_str, "context": all_ctx.get(date_str, {})}

def save_work_context(body: dict) -> dict:
    date_str = str(body.get("date") or _today().isoformat())
    context = {k: str(body.get(k, ""))[:200] for k, _ in WORK_CONTEXT_QUESTIONS}
    all_ctx = _load_work_context()
    all_ctx[date_str] = context
    _save_work_context_raw(all_ctx)
    return {"ok": True, "date": date_str, "context": context}


# ---------------------------------------------------------------- 游戏系统（积分 / 成就 / 地球Online / 奖励）

LEVELS = [(0, "见习生"), (500, "行动者"), (1500, "节奏师"), (3000, "系统玩家"),
          (6000, "地球居民"), (10000, "地球 VIP"), (15000, "传说执行者"),
          (25000, "地球 Online 主宰")]

# ── 脑科学积分体系 ────────────────────────────────────────────

# 基础费率（递进难度：随等级上浮）
# course_day：确认上课出勤的单独奖励（不重复计入 task）
POINTS_RATES = {"task": 10, "diary": 15, "data": 5, "earth": 15, "course_day": 25}

# 可变比率强化：20% 概率触发 x2–x5 暴击（老虎机效应）
VAR_RATIO_CHANCE = 20           # %
VAR_MULTIPLIERS = [(50, 2), (30, 3), (15, 4), (5, 5)]   # (概率权重, 倍数)

# 损失厌恶连续奖：断掉归零
STREAK_BONUS_MAP = [(7, 5), (14, 10), (21, 15), (30, 20)]

# 等级技能解锁
LEVEL_SKILLS = {
    1: "🎯 微奖 + 中奖兑换",
    2: "📊 自定义积分目标",
    3: "🔥 挑战押金（预先承诺）",
    4: "🏆 大件奖励兑换",
    5: "💥 双倍积分日（每月 1 次）",
    6: "👑 里程碑奖励兑换",
    7: "✨ 自定义成就创建",
    8: "🌍 地球主宰模式",
}

# 奖励商店（四级分类）—— 用户真实爱好定价体系：真实价格 ×10 分
# 奖励商店 · 双池制：每周池（周一刷新·上限2次/周）+ 每月池（1日刷新·高价值·上限1次/月）
DEFAULT_REWARDS = [
    # ── 每周池（便宜 · 高频）──
    {"id": "r-readday", "label": "半天沉浸式阅读（零打扰）",      "cost": 200,  "tier": "micro",  "pool": "weekly"},
    {"id": "r-rest",    "label": "半天完全休息（零任务）",          "cost": 200,  "tier": "micro",  "pool": "weekly"},
    {"id": "r-milk",    "label": "奶茶/咖啡一杯（≈¥25）",         "cost": 250,  "tier": "micro",  "pool": "weekly"},
    {"id": "r-ebook",   "label": "电子书充值买下一本（≈¥30）",     "cost": 300,  "tier": "medium", "pool": "weekly"},
    {"id": "r-hike",    "label": "周末徒步一日（≈¥30 路费零食）",   "cost": 300,  "tier": "medium", "pool": "weekly"},
    {"id": "r-dessert", "label": "甜品/蛋糕自由一次（≈¥40）",       "cost": 400,  "tier": "medium", "pool": "weekly"},
    {"id": "r-book",    "label": "买一本想读的小说（≈¥50）",        "cost": 500,  "tier": "medium", "pool": "weekly"},
    # ── 每月池（高价值 · 低频）──
    {"id": "r-sleep",   "label": "睡到自然醒（不设闹钟）",          "cost": 600,  "tier": "large",  "pool": "monthly"},
    {"id": "r-meal",    "label": "吃一顿想吃的餐厅（≈¥80）",        "cost": 800,  "tier": "large",  "pool": "monthly"},
    {"id": "r-gear",    "label": "买一件徒步小装备（≈¥100）",       "cost": 1000, "tier": "large",  "pool": "monthly"},
    {"id": "r-trip",    "label": "短途一日游（≈¥200）",            "cost": 2000, "tier": "large",  "pool": "monthly"},
    {"id": "r-travel",  "label": "过夜小旅行（≈¥500）",            "cost": 5000, "tier": "milestone", "pool": "monthly"},
]

# 每池每窗口兑换上限（防上头机制）
REWARD_POOL_CAPS = {"weekly": 2, "monthly": 1}


REWARD_TIER_CFG = {
    "micro":     {"name": "🎯 即时小奖", "min_level": 1, "max_cost": 300},
    "medium":    {"name": "🎁 中规中矩", "min_level": 1, "max_cost": 500},
    "large":     {"name": "🏆 大件",     "min_level": 4, "max_cost": 2000},
    "milestone": {"name": "👑 里程碑",   "min_level": 6, "max_cost": 99999},
}


def _load_game() -> dict:
    p = DATA_DIR / "game.json"
    base = {
        "earth": {}, "rewards": list(DEFAULT_REWARDS), "ledger": [],
        "streak_start": None,
        "precommitments": [],
        "surprise_dates": [],
        "double_days": [],
        "savor_log": [],
    }
    if p.exists():
        try:
            g = json.loads(p.read_text(encoding="utf-8"))
            base.update(g)
            if not base.get("rewards"):
                base["rewards"] = list(DEFAULT_REWARDS)
            for _r in base["rewards"]:
                if not _r.get("pool"):
                    _r["pool"] = "monthly" if int(_r.get("cost", 0)) > 500 else "weekly"
        except Exception:
            pass
    return base


def _save_game(g: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "game.json").write_text(
        json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")


def _earth_pool():
    """60 个地球任务文本（来自成就定义里的 earth_one）。"""
    try:
        achs = json.loads((DATA_DIR / "achievements.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    pool = []
    for a in achs:
        if a.get("stat") == "earth_one":
            t = a["desc"].split("首次完成：", 1)[-1]
            pool.append((a["val"], t))
    return sorted(pool)


# ── 脑科学积分引擎 ────────────────────────────────────────────

def _level_for_points(points: int):
    """返回 (等级索引 0 起, 等级名, 下一级门槛或 None)。"""
    for i, (th, _) in enumerate(LEVELS):
        if points < th:
            return i - 1, LEVELS[i - 1][1] if i > 0 else None, th
    return len(LEVELS) - 1, LEVELS[-1][1], None


def _base_points(category: str, level_index: int) -> int:
    """递进难度：基础分随等级上浮。"""
    rate = POINTS_RATES.get(category, 10)
    scale = 1.0 + level_index * 0.15   # LV0: 1.0x → LV7: 2.05x
    return int(rate * scale)


def _variable_ratio(base: int):
    """可变比率强化：20% 概率触发 x2–x5 暴击。返回 (最终分, 标签)。"""
    if random.randrange(100) >= VAR_RATIO_CHANCE:
        return base, ""
    # 按权重抽取倍数
    total_w = sum(w for w, _ in VAR_MULTIPLIERS)
    roll = random.randrange(total_w)
    cum = 0
    for w, mult in VAR_MULTIPLIERS:
        cum += w
        if roll < cum:
            return base * mult, f"✨×{mult}"
    return base, ""


def _streak_bonus_value(streak: int) -> int:
    """损失厌恶连续奖：每任务额外加分。"""
    for min_s, bonus in reversed(STREAK_BONUS_MAP):
        if streak >= min_s:
            return bonus
    return 0


def _unlocked_skills(level_index: int) -> list:
    """返回当前等级已解锁的技能列表。"""
    skills = []
    for lv in sorted(LEVEL_SKILLS):
        if lv <= level_index + 1:
            skills.append(LEVEL_SKILLS[lv])
    return skills


def game_state():
    g = _load_game()
    achs = []
    try:
        achs = json.loads((DATA_DIR / "achievements.json").read_text(encoding="utf-8"))
    except Exception:
        pass

    # ── 扫描 90 天 Daily ──
    COURSE_CODES = ("MKT5010", "MKT5011", "MKT5012", "MKT5018",
                    "MKT6012", "MKT6013", "MKT6019", "MKT6033")
    stats = {k: 0 for k in ("tasks_done", "frogs_done", "diary_days", "data_days",
                            "lang_jp", "lang_en", "spirit_msg", "deep_talks",
                            "stretch_done", "sport_any", "budget_ok_days",
                            "quad_mind", "quad_body", "quad_spirit", "quad_vocation",
                            "course_days")}
    sport_kw = {"sport_climb": ["攀岩"], "sport_swim": ["游泳"], "sport_badminton": ["羽毛球"], "sport_slope": ["爬坡"]}
    for k in sport_kw:
        stats[k] = 0
    streak, active_days = 0, []
    for d, path in list_recent_dailies(90):
        data = parse_daily(path, d)
        done_texts = "∥".join(t["text"] for sec in data["tasks_by_section"]
                              for t in sec["tasks"] if t["done"])
        # 确认上课出勤：勾选的任务中包含课程代码 → 当天算出勤 1 次
        if any(code in done_texts for code in COURSE_CODES):
            stats["course_days"] += 1
        quad_map = {"心智": "quad_mind", "身体": "quad_body", "精神": "quad_spirit", "事业": "quad_vocation"}
        for sec in data["tasks_by_section"]:
            n_done = sum(1 for t in sec["tasks"] if t["done"])
            for label, key in quad_map.items():
                if label in sec["section"]:
                    stats[key] += n_done
        stats["tasks_done"] += data["done"]
        # 重点完成量（旧文件看 🐸，新文件看「今日重点」任务被勾选）
        stats["frogs_done"] += sum(1 for sec in data["tasks_by_section"]
                                   for t in sec["tasks"] if t["done"]
                                   and ("🐸" in t["text"] or "今日重点" in t["text"]))
        if data.get("diary"):
            stats["diary_days"] += 1
        if data.get("weight") or data.get("spend"):
            stats["data_days"] += 1
            if data.get("spend") and data["spend"] <= CONFIG.get("finance", {}).get("daily_budget", 100):
                stats["budget_ok_days"] += 1
        if "日语" in done_texts or "假名" in done_texts:
            stats["lang_jp"] += 1
        if "英语" in done_texts or "IELTS" in done_texts:
            stats["lang_en"] += 1
        if "非事务性消息" in done_texts:
            stats["spirit_msg"] += 1
        if "深度对话" in done_texts:
            stats["deep_talks"] += 1
        if "拉伸" in done_texts:
            stats["stretch_done"] += 1
        for k, kws in sport_kw.items():
            if any(kw in done_texts for kw in kws):
                stats[k] += 1
                stats["sport_any"] += 1
        if data["done"] > 0 or data.get("diary"):
            active_days.append(d.isoformat())

    # 连续天数（截至今天或昨天）
    ds = set(active_days)
    cur = _today()
    if cur.isoformat() not in ds:
        cur = _today() - dt.timedelta(days=1)
    while cur.isoformat() in ds:
        streak += 1
        cur -= dt.timedelta(days=1)

    # ── 其他数据源 ──
    fin = finance_overview()
    media = _load_media()["items"]
    stats.update({
        "publish": next((v for k, v in _content_stats() if k == "已发布"), 0),
        "topics_added": len(_load_topics()["items"]),
        "books_done": sum(1 for x in media if x["type"] == "book"),
        "shows_done": sum(1 for x in media if x["type"] == "show"),
        "reviews": sum(1 for x in media if x.get("review")),
        "progress_done": sum(1 for x in _load_progress()["items"] if x["current"] >= x["total"]),
        "fin_records": len(fin["records"]),
        "months_positive": 0,   # records 只存当月起，历史月在 ledger 结算时累计
        "calibrations": len(_load_calib()["records"]),
        "earth_done": sum(len(v) for v in g["earth"].values()),
        "earth_roam": sum(len(v) for v in g["earth"].values()),
        "redeemed": sum(1 for e in g["ledger"] if e.get("kind") == "redeem"),
    })
    cfgq = CONFIG["quadrants"]
    for item in cfgq["items"]:
        stats[f"calib_{item['id']}"] = item["current"]
    stats["total_score"] = cfgq["current_total"]

# ── 积分（脑科学引擎）──
    # 先估算初始等级（无需成就/支出）
    rough_pts = (
        stats["tasks_done"] * _base_points("task", 0) +
        stats["diary_days"] * _base_points("diary", 0) +
        stats["data_days"] * _base_points("data", 0) +
        stats["earth_done"] * _base_points("earth", 0) +
        stats["course_days"] * _base_points("course_day", 0)
    )
    lvl_i, _, _ = _level_for_points(rough_pts)
    month_net = max(0, fin.get("month_net") or 0)

    # 递进基础分（用当前等级）
    base_breakdown = {
        "任务": stats["tasks_done"] * _base_points("task", lvl_i),
        "上课出勤": stats["course_days"] * _base_points("course_day", lvl_i),
        "日记": stats["diary_days"] * _base_points("diary", lvl_i),
        "数据回填": stats["data_days"] * _base_points("data", lvl_i),
        "地球任务": stats["earth_done"] * _base_points("earth", lvl_i),
        f"月结余×8%（{fin.get('month', '')}）": int(month_net * 0.08),
    }
    base_pts = sum(base_breakdown.values())

    # 损失厌恶连续奖
    streak_bonus_total = _streak_bonus_value(streak) * max(1, stats["tasks_done"])

    # ── 成就解锁 ──
    stats["points_total"] = base_pts
    earth_done_idx = set()
    for v in g["earth"].values():
        earth_done_idx.update(v)
    unlocked = []
    for a in achs:
        if a["stat"] == "earth_one":
            ok = a["val"] in earth_done_idx
        else:
            v = stats.get(a["stat"])
            try:
                ok = v is not None and float(v) >= float(a["val"])
            except (TypeError, ValueError):
                ok = False
        if ok:
            unlocked.append(a["id"])
    stats["ach_count"] = len(unlocked)
    ach_pts = sum(a["points"] for a in achs if a["id"] in unlocked)
    # Ledger uses signed deltas: earnings are positive, redemptions/stakes negative.
    # Migrate legacy positive spend entries by their kind without mutating disk.
    ledger_net = 0
    for entry in g["ledger"]:
        points = abs(int(entry.get("points", 0)))
        ledger_net += -points if entry.get("kind") in ("redeem", "precommit_stake") else points
    spent = sum(abs(int(e.get("points", 0))) for e in g["ledger"]
                if e.get("kind") in ("redeem", "precommit_stake"))
    total = base_pts + streak_bonus_total + ach_pts + ledger_net + int(g.get("points_offset", 0))
    total = max(0, total)
    # Active double day doubles actual earned points for today's completed work.
    if _today().isoformat() in g.get("double_days", []):
        today_earned = sum(abs(int(e.get("points", 0))) for e in g["ledger"]
                           if e.get("kind") in ("task", "frog", "diary", "data", "earth", "course_day")
                           and str(e.get("date", e.get("ts", "")))[:10] == _today().isoformat())
        total += today_earned


    # 等级（基于 total，精确重算）
    lvl_i, lvl_name, next_th = _level_for_points(total)
    lvl_display = lvl_i + 1  # 1-indexed

    # 等级技能
    level_skills = _unlocked_skills(lvl_i)

    # 筛选 tiered 奖励
    rewards_tiered = {}
    for tier_key, tier_cfg in REWARD_TIER_CFG.items():
        if lvl_display >= tier_cfg["min_level"]:
            tier_rewards = [r for r in g["rewards"] if r.get("tier", "micro") == tier_key or r["cost"] <= tier_cfg["max_cost"]]
        else:
            tier_rewards = [r for r in g["rewards"] if r.get("tier", "micro") == "micro" and r["cost"] <= 200]
        rewards_tiered[tier_key] = {
            "name": tier_cfg["name"],
            "items": tier_rewards[:6],
        }

    # 今日已惊喜？+ 双倍日
    today_iso = _today().isoformat()
    double_days_remaining = [d for d in g.get("double_days", []) if d >= today_iso]
    surprise_claimed_today = today_iso in g.get("surprise_dates", [])
    # 是否有已领取但未完成的惊喜
    surprise_pending = None
    for entry in reversed(g.get("surprise_log", [])):
        if entry["date"] == today_iso and not entry["claimed"]:
            surprise_pending = {"task": entry["task"], "bonus": entry["bonus"]}
            break

    # 今日地球任务（日种子 → 稳定 3 个）
    pool = _earth_pool()
    rng = _random.Random(f"earth-{today_iso}")
    today_idx = rng.sample(range(len(pool)), min(3, len(pool))) if pool else []
    today_done = g["earth"].get(today_iso, [])

    return {
        "ok": True, "points": total, "base": base_pts, "ach_pts": ach_pts, "spent": spent,
        "breakdown": base_breakdown,
        "streak": streak,        "streak_bonus": streak_bonus_total,
        "level": {"name": LEVELS[lvl_i][1], "index": lvl_display,
                  "next": next_th, "next_name": LEVELS[lvl_i + 1][1] if lvl_i + 1 < len(LEVELS) else None},
        "level_skills": level_skills,
        "stats": stats,
        "unlocked": unlocked,
        "achievements": achs,
        "earth_today": [{"idx": pool[i][0], "text": pool[i][1],
                         "done": pool[i][0] in today_done} for i in today_idx],
        "earth_done_total": stats["earth_done"],
        "earth_today_date": today_iso,
        "rewards": g["rewards"],
        "pools": {
            "weekly": {"cap": REWARD_POOL_CAPS["weekly"], "used": _pool_window_usage(g, "weekly"), "reset": "每周一刷新"},
            "monthly": {"cap": REWARD_POOL_CAPS["monthly"], "used": _pool_window_usage(g, "monthly"), "reset": "每月 1 日刷新"},
        },
        "rewards_tiered": rewards_tiered,
        "ledger": g["ledger"][-12:][::-1],
        "month_net": fin.get("month_net"),
        "precommitments": g.get("precommitments", []),
        "double_days_remaining": double_days_remaining,
        "surprise_available": not surprise_claimed_today,
        "surprise_pending": surprise_pending,
    }


def _content_stats():
    return [(k, v) for k, v in parse_content_calendar()["stats"].items()]


def earth_toggle(idx: int, done: bool):
    g = _load_game()
    day = g["earth"].setdefault(_today().isoformat(), [])
    if done and idx not in day:
        day.append(idx)
    elif not done and idx in day:
        day.remove(idx)
    _save_game(g)
    return {"ok": True}


def _pool_window_usage(g: dict, pool: str) -> int:
    """当前窗口内该池已兑换次数（周=本周一至今；月=本月至今）"""
    now = dt.datetime.now()
    if pool == "weekly":
        start = (now - dt.timedelta(days=now.weekday())).date()
    else:
        start = now.date().replace(day=1)
    n = 0
    for e in g["ledger"]:
        if e.get("kind") != "redeem" or e.get("pool") != pool:
            continue
        try:
            if dt.datetime.fromisoformat(e["ts"]).date() >= start:
                n += 1
        except Exception:
            pass
    return n


def reward_add(body: dict):
    g = _load_game()
    label = str(body.get("label") or "").strip()[:40]
    cost = int(body.get("cost") or 0)
    pool = str(body.get("pool") or ("monthly" if cost > 500 else "weekly")).strip().lower()
    if pool not in ("weekly", "monthly"):
        pool = "weekly"
    if pool == "monthly":
        tier = "milestone" if cost >= 3000 else "large"
    else:
        tier = "medium" if cost > 300 else "micro"
    if not label or cost <= 0:
        return {"ok": False, "error": "奖励名和积分必填"}
    g["rewards"].append({"id": f"r-{dt.datetime.now().strftime('%H%M%S')}",
                         "label": label, "cost": cost, "tier": tier, "pool": pool})
    _save_game(g)
    return {"ok": True}


def reward_delete(rid: str):
    g = _load_game()
    g["rewards"] = [r for r in g["rewards"] if r["id"] != rid]
    _save_game(g)
    return {"ok": True}


def reward_redeem(rid: str):
    g = _load_game()
    r = next((x for x in g["rewards"] if x["id"] == rid), None)
    if not r:
        return {"ok": False, "error": "奖励不存在"}
    st = game_state()
    if st["points"] < r["cost"]:
        return {"ok": False, "error": f"积分不够（还差 {r['cost'] - st['points']}）"}
    pool = r.get("pool") or ("monthly" if r["cost"] > 500 else "weekly")
    used = _pool_window_usage(g, pool)
    cap = REWARD_POOL_CAPS.get(pool, 99)
    if used >= cap:
        reset_txt = "下周一刷新" if pool == "weekly" else "每月 1 日刷新"
        name = "每周池" if pool == "weekly" else "每月池"
        return {"ok": False, "error": f"「{name}」本期已兑换 {used}/{cap}，{reset_txt}再来"}
    redeem_id = f"rd-{dt.datetime.now().strftime('%H%M%S')}"
    g["ledger"].append({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                        "kind": "redeem", "label": r["label"], "points": r["cost"],
                        "pool": pool, "rid": redeem_id})
    _save_game(g)
    return {"ok": True, "left": st["points"] - r["cost"],
            "redeem_id": redeem_id,
            "savor_prompt": f"🎉 已兑换「{r['label']}」！享受时写一句心得加 +5 分哦 ✨"}


# ── 脑科学高级功能 ──────────────────────────────────────────


def precommitment_create(body: dict):
    """挑战押金：押 N 分，承诺未来 days 天每天完成当日重点。成功→+30%，失败→没收。"""
    g = _load_game()
    label = str(body.get("label") or "挑战").strip()[:40]
    days = min(int(body.get("days") or 3), 14)
    stake = int(body.get("stake") or 0)
    if stake <= 0:
        return {"ok": False, "error": "押金必须 > 0"}
    st = game_state()
    if st["points"] < stake:
        return {"ok": False, "error": f"积分不够押（现有 {st['points']}，需 {stake}）"}
    # 立即扣除押金
    g["ledger"].append({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                        "kind": "precommit_stake", "label": label, "points": stake})
    pc = {
        "id": f"pc-{dt.datetime.now().strftime('%H%M%S')}",
        "label": label,
        "stake": stake,
        "days": days,
        "start": _today().isoformat(),
        "frogs_required": days,   # 每天至少完成 1 件当日重点
        "frogs_done": 0,
        "resolved": False,
    }
    g.setdefault("precommitments", []).append(pc)
    _save_game(g)
    return {"ok": True, "precommitment": pc,
            "msg": f"🔥 挑战「{label}」已创建！押金 {stake} 分，{days} 天内每天完成当日重点 → 拿回 +{int(stake * 0.3)} 分"}


def precommitment_resolve(pcid: str):
    """结算挑战押金。"""
    g = _load_game()
    for pc in g.get("precommitments", []):
        if pc["id"] == pcid and not pc["resolved"]:
            # ���计完成数：从起始日到今天，扫描 daily 青蛙完成量
            start = dt.date.fromisoformat(pc["start"])
            total_needed = pc["frogs_required"]
            done = 0
            for d in (start + dt.timedelta(days=i) for i in range(total_needed)):
                if d > _today():
                    break
                data = parse_daily(daily_path(d), d)
                done_texts = "∥".join(t["text"] for sec in data["tasks_by_section"]
                                      for t in sec["tasks"] if t["done"])
                # 旧文件 🐸 + 新文件「今日重点」都算完成当日重点
                if "🐸" in done_texts or "今日重点" in done_texts:
                    done += 1
            pc["frogs_done"] = done
            success = done >= total_needed
            if success:
                bonus = int(pc["stake"] * 0.3)
                g["ledger"].append({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                                    "kind": "precommit_return", "label": pc["label"],
                                    "points": pc["stake"] + bonus})
                pc["resolved"] = True
                _save_game(g)
                return {"ok": True, "success": True, "stake": pc["stake"], "bonus": bonus,
                        "total": pc["stake"] + bonus,
                        "msg": f"🎉 挑战「{pc['label']}」成功！拿回 {pc['stake']} + {bonus} = {pc['stake'] + bonus} 分"}
            else:
                pc["resolved"] = True
                _save_game(g)
                return {"ok": True, "success": False, "stake": pc["stake"],
                        "done": done, "needed": total_needed,
                        "msg": f"💔 挑战「{pc['label']}」失败。押金 {pc['stake']} 分已扣除（完成 {done}/{total_needed}）"}
    return {"ok": False, "error": "挑战不存在或已结算"}


def surprise_claim():
    """今日惊喜：15% 概率获得一个随机加分任务。"""
    g = _load_game()
    today_iso = _today().isoformat()
    if today_iso in g.get("surprise_dates", []):
        return {"ok": False, "error": "今日惊喜已领取"}
    # 15% 概率
    roll = random.randrange(100)
    if roll >= 15:
        return {"ok": True, "triggered": False, "msg": "今日没有惊喜任务，明天再来试试 🎲"}
    # 惊喜任务池
    surprise_tasks = [
        "给一个老朋友发条问候消息",
        "整理一张喜欢的照片做成手机壁纸",
        "写下今天出现的一个好句子",
        "听一首很久没听的歌并写一句感受",
        "读一首诗（任何语言）",
        "对着窗外看 3 分钟，什么也不做",
        "写下你最近学到的最有趣的一个冷知识",
        "给今天遇到的一个陌生人画个简笔肖像",
        "做 10 个俯卧撑 + 10 个深蹲",
        "打开地图标记一个想去的地方",
    ]
    task = random.choice(surprise_tasks)
    bonus = random.choice([15, 20, 30, 50])
    g.setdefault("surprise_dates", []).append(today_iso)
    g.setdefault("surprise_log", []).append({
        "date": today_iso, "task": task, "bonus": bonus, "claimed": False
    })
    _save_game(g)
    return {"ok": True, "triggered": True, "task": task, "bonus": bonus,
            "msg": f"🎁 惊喜出现！完成「{task}」→ +{bonus} 分"}


def surprise_complete():
    """确认完成今日惊喜任务，加分入账。"""
    g = _load_game()
    today_iso = _today().isoformat()
    log = g.get("surprise_log", [])
    for entry in reversed(log):
        if entry["date"] == today_iso and not entry["claimed"]:
            entry["claimed"] = True
            bonus = entry["bonus"]
            g["ledger"].append({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                                "kind": "surprise_bonus", "label": f"🎁 惊喜：{entry['task']}",
                                "points": bonus})
            _save_game(g)
            return {"ok": True, "bonus": bonus, "task": entry["task"],
                    "msg": f"🎉 完成惊喜 +{bonus} 分！"}
    return {"ok": False, "error": "没有待完成的今日惊喜"}


def savor_bonus(redeem_id: str, note: str):
    """品味仪式：兑换奖励后写一句心得 → +5 分。"""
    g = _load_game()
    note = note.strip()[:200]
    if not note:
        return {"ok": False, "error": "写一句享受心得吧"}
    # 检查这个 redeem_id 是否已经品味过了
    for entry in g.get("savor_log", []):
        if entry["rid"] == redeem_id:
            return {"ok": False, "error": "这个奖励已经品味过了"}
    g.setdefault("savor_log", []).append({
        "rid": redeem_id, "note": note,
        "ts": dt.datetime.now().isoformat(timespec="seconds")
    })
    g["ledger"].append({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                        "kind": "savor", "label": f"品味：{note[:30]}",
                        "points": 5})
    _save_game(g)
    return {"ok": True, "bonus": 5,
            "msg": f"✨ 品味仪式 +5 分！享受本身就是奖励的一部分。"}


def toggle_double_day():
    """双倍积分日（LV5 技能）：当天所有积分 ×2。每月限 1 次。"""
    g = _load_game()
    today_iso = _today().isoformat()
    # 检查是否已使用
    used = [d for d in g.get("double_days", []) if d >= _today().replace(day=1).isoformat()]
    if len(used) >= 1:
        return {"ok": False, "error": "本月双倍日已使用"}
    g.setdefault("double_days", []).append(today_iso)
    _save_game(g)
    return {"ok": True, "date": today_iso,
            "msg": "💥 双倍积分日已激活！今天做的所有任务积分 ×2 计算！"}


QUAD_SECTIONS = {"mind": "🧠 心智 Mind", "body": "💪 身体 Body",
                 "spirit": "🤝 精神 Spirit", "voc": "🚀 事业 Vocation"}


def add_task(body: dict):
    """自定义任务：严格限制为半小时边界、正向且不跨午夜的时间段。"""
    text = str(body.get("text") or "").strip()[:60]
    quad = QUAD_SECTIONS.get(str(body.get("quad") or "voc"))
    t = str(body.get("time") or "").strip()
    m = re.fullmatch(r"(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})", t)
    if not text or not m or not quad:
        return {"ok": False, "error": "需要任务内容、时间范围（如 19:00–19:30）和象限"}
    try:
        sh, sm = (int(x) for x in m.group(1).split(":"))
        eh, em = (int(x) for x in m.group(2).split(":"))
    except ValueError:
        return {"ok": False, "error": "时间格式无效"}
    if sh > 23 or eh > 23 or sm not in (0, 30) or em not in (0, 30):
        return {"ok": False, "error": "任务时间必须对齐整点或半点"}
    start_min, end_min = sh * 60 + sm, eh * 60 + em
    if end_min <= start_min:
        return {"ok": False, "error": "结束时间必须晚于开始时间"}
    if end_min - start_min > 240:
        return {"ok": False, "error": "单任务最长 4 小时——更大的活拆成两段"}
    time_str = f"{m.group(1)}–{m.group(2)}"
    try:
        task_date = dt.date.fromisoformat(str(body.get("date") or _today().isoformat()))
    except ValueError:
        return {"ok": False, "error": "日期格式无效"}
    p = daily_path(task_date)
    if not p.exists():
        return {"ok": False, "error": "当天的 Daily 还没生成——先点「智能安排」"}
    lines = read(p).split("\n")

    # 0) 去重：同分区已有一模一样的 checkbox 行 → 直接跳过（防双击/重复提交）
    new_line = f"- [ ] {time_str} {text}"
    if any(l.strip() == new_line for l in lines):
        return {"ok": True, "time": time_str, "duplicate": True}

    # 1) 象限分区末尾追加复选框
    try:
        si = next(i for i, l in enumerate(lines) if l.strip() == f"## {quad}")
        ei = next((i for i in range(si + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        j = ei
        while j - 1 > si and not lines[j - 1].strip():
            j -= 1
        lines.insert(j, f"- [ ] {time_str} {text}")
    except StopIteration:
        lines += ["", f"## {quad}", "", f"- [ ] {time_str} {text}"]

    # 2) 总览主表追加行（找表尾；同时间同文本的行已存在则跳过）
    try:
        ti = next(i for i, l in enumerate(lines) if l.startswith("## ") and "总览" in l)
        te = ti
        for i in range(ti, len(lines)):
            if lines[i].strip().startswith("|"):
                te = i
        new_row = f"| 自 | {time_str} | 🟡 中 | {text} | {quad.split(' ', 1)[-1]} · 自定义 | 完成即赢 |"
        if not any(l.strip() == new_row for l in lines[ti:te + 1]):
            lines.insert(te + 1, new_row)
    except StopIteration:
        pass

    p.write_text("\n".join(lines), encoding="utf-8")
    return {"ok": True, "time": time_str}


def _locate_task(lines, raw_line: str, section: str = ""):
    """定位 checkbox 行：优先匹配分区，其次全文首个。返回 (行号, 当前分区标题) 或 (None, '')。"""
    cur, hits = "", []
    for i, line in enumerate(lines):
        m = re.match(r"^#{2,3}\s+(.*)$", line)
        if m:
            cur = m.group(1).strip()
            continue
        if line.strip() == raw_line and TASK_RE.match(line):
            hits.append((i, cur))
    for i, sec in hits:
        if not section or strip_md(sec) == strip_md(section):
            return i, sec
    if hits:
        return hits[0]
    return None, ""


def _norm_hm(s: str):
    """校验半小时刻度时间段，返回规范化 'HH:MM–HH:MM'，不合法返回 None。"""
    m = re.fullmatch(r"(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})", s.strip())
    if not m:
        return None
    try:
        sh, sm = (int(x) for x in m.group(1).split(":"))
        eh, em = (int(x) for x in m.group(2).split(":"))
    except ValueError:
        return None
    if sh > 23 or eh > 23 or sm not in (0, 30) or em not in (0, 30):
        return None
    if eh * 60 + em <= sh * 60 + sm:
        return None
    return f"{m.group(1)}–{m.group(2)}"


def _sync_overview_row(lines, old_time: str, old_text: str, new_time: str,
                       new_text: str, quad=None):
    """把总览主表中「旧时间+旧文字」的行改成新值。返回是否命中。"""
    if not old_time:
        return False
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 4 or set(cells[0]) <= set("-— "):
            continue
        rm = re.fullmatch(r"(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})", cells[1])
        if not rm or f"{rm.group(1)}–{rm.group(2)}" != old_time:
            continue
        if strip_md(cells[3]) != old_text:
            continue
        cells[1] = new_time
        cells[3] = new_text
        if quad:
            cells[4] = f"{quad.split(' ', 1)[-1]} · 自定义"
        lines[i] = "| " + " | ".join(cells) + " |"
        return True
    return False


def edit_task(body: dict):
    """编辑任务：改文字 / 时间 / 象限。raw 定位 checkbox 行；时间线拖拽可用 task+old_time 反查。"""
    try:
        d = dt.date.fromisoformat(str(body.get("date") or _today().isoformat()))
    except ValueError:
        return {"ok": False, "error": "日期格式无效"}
    p = daily_path(d)
    if not p.exists():
        return {"ok": False, "error": f"Daily 不存在：{p.name}"}
    lines = read(p).split("\n")

    raw = str(body.get("raw") or "").strip()
    task_hint = str(body.get("task") or "").strip()
    old_time_in = str(body.get("old_time") or "").strip().replace("-", "–").replace("—", "–")
    section = str(body.get("section") or "")

    idx, cur_section, old_time, old_text = None, "", "", ""
    if raw:
        idx, cur_section = _locate_task(lines, raw, section)
        if idx is None:
            return {"ok": False, "error": "没找到该任务行，请刷新页面重试"}
        mm = TASK_RE.match(lines[idx])
        content = mm.group(2).strip()
        om = TIME_RANGE_RE.search(content)
        old_time = f"{om.group(1)}–{om.group(2)}" if om else ""
        old_text = TIME_RANGE_RE.sub("", content).strip()
    elif task_hint and old_time_in:
        # 时间线拖拽：按「旧时间 + 任务文字」反查 checkbox 行
        for i, line in enumerate(lines):
            mm = TASK_RE.match(line)
            if not mm:
                continue
            content = mm.group(2).strip()
            om = TIME_RANGE_RE.search(content)
            if om and f"{om.group(1)}–{om.group(2)}" == old_time_in \
                    and TIME_RANGE_RE.sub("", content).strip() == task_hint:
                idx, cur_section = i, ""
                for j in range(i, -1, -1):        # 回溯所在分区标题
                    hm = re.match(r"^#{2,3}\s+(.*)$", lines[j])
                    if hm:
                        cur_section = hm.group(1).strip()
                        break
                old_time, old_text = old_time_in, task_hint
                break
        if idx is None:
            old_time, old_text = old_time_in, task_hint   # 仅总览表行（无对应 checkbox）
    else:
        return {"ok": False, "error": "缺少任务定位信息（raw 或 task+old_time）"}

    # 新值（不传的保持原样）
    new_text = str(body.get("text") or "").strip()[:60] or old_text
    if not new_text:
        return {"ok": False, "error": "任务内容不能为空"}
    time_in = str(body.get("time") or "").strip()
    if time_in:
        nt = _norm_hm(time_in)
        if not nt:
            return {"ok": False, "error": "时间必须为半小时刻度（如 19:00–19:30），且结束晚于开始"}
        new_time = nt
    else:
        new_time = old_time
    quad = QUAD_SECTIONS.get(str(body.get("quad") or "")) if body.get("quad") else None

    moved = False
    if idx is not None:
        done_mark = TASK_RE.match(lines[idx]).group(1)
        new_line = f"- [{done_mark}] {new_time} {new_text}" if new_time else f"- [{done_mark}] {new_text}"
        if quad and cur_section and quad != cur_section:
            del lines[idx]                       # 象限变了 → 整行搬到新分区
            try:
                si = next(i for i, l in enumerate(lines) if l.strip() == f"## {quad}")
                ei = next((i for i in range(si + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
                j = ei
                while j - 1 > si and not lines[j - 1].strip():
                    j -= 1
                lines.insert(j, new_line)
            except StopIteration:
                lines += ["", f"## {quad}", "", new_line]
            moved = True
        else:
            lines[idx] = new_line

    synced = _sync_overview_row(lines, old_time, old_text, new_time, new_text, quad)
    if idx is None and not synced:
        return {"ok": False, "error": "没找到该任务（可能刚被改动，请刷新页面重试）"}
    p.write_text("\n".join(lines), encoding="utf-8")
    return {"ok": True, "time": new_time, "moved_quad": moved, "table_synced": synced}


# ---------------------------------------------------------------- 每日计划自动生成（skill 体系 + 历史挖掘）

import random as _random

SPORT_POOL = ["攀岩", "游泳", "打羽毛球", "爬坡"]
SPORT_KW = {"攀岩": ["攀岩", "岩馆"], "游泳": ["游泳", "泳池"],
            "打羽毛球": ["羽毛球"], "爬坡": ["爬坡", "爬 山", "hike"]}


def _mine_same_weekday_schedule(dailies):
    """从最近一篇同周几的 Daily 挖课程总览主表（课表按周重复）。"""
    for d, path in reversed(dailies):
        if d == _today() or d.weekday() != _today().weekday():
            continue
        data = parse_daily(path, d)
        if data["schedule"]:
            return d, data["schedule"]
    return None, []


def _energy_tier(energy: float, sleep: float, ysig: dict = None) -> int:
    """5 档精力评分 0–4（脑科学多巴胺可用性能量模型）。"""
    if energy <= 1.5 or (sleep is not None and sleep < 5.5):
        score = 0
    elif energy <= 2.5 or (sleep is not None and sleep < 6.5):
        score = 1
    elif energy >= 4.5:
        score = 3
    elif energy >= 5 and (sleep is None or sleep >= 7.5):
        score = 4
    else:
        score = 2
    # 昨日信号修正
    if ysig:
        if ysig.get("tired") and ysig.get("exists"):
            score = max(0, score - 1)
        if ysig.get("good") and ysig.get("exists"):
            score = min(4, score + 1)
    return score


def _week_sport_plan():
    """用户偏好（2026-10 问卷）：游泳第一（每天晨泳，周日休）；力量周一/周四下午健身房。
    攀岩鞋没买→不排；羽毛球不排；爬坡/跑步作为天气好时的备选不主动排。"""
    plan = {d: "游泳" for d in range(6)}          # 0-5 = 周一…周六
    fasted = {d: False for d in range(6)}
    return plan, fasted, sorted(plan)


def _yesterday_signal():
    """读昨天 Daily/日记 → 状态与运动信号。"""
    y = _today() - dt.timedelta(days=1)
    p = daily_path(y)
    if not p.exists():
        return {"exists": False, "sports": [], "tired": False, "good": False,
                "sleep": None}
    data = parse_daily(p, y)
    text = " ".join([(data.get("diary") or ""), (data.get("conclusion") or ""),
                     " ".join(data["incomplete"])])
    sports = [s for s in SPORT_POOL if any(k in text for k in SPORT_KW[s])]
    return {
        "exists": True, "sports": sports,
        "tired": any(k in text for k in ["累", "疲惫", "酸痛", "没睡", "熬", "困", "低落", "不舒服"]),
        "good": any(k in text for k in ["状态好", "精力好", "满血", "高效", "很顺", "开心", "兴奋"]),
        "sleep": data.get("sleep_hours"),
    }


def _today_sport(ysig):
    """今天的有氧：晨泳（周日休）。昨天若日记提到疲惫→标注低强度。"""
    plan, fasted, days = _week_sport_plan()
    wd = _today().weekday()
    if wd not in plan:
        return None, False, 0, 6
    nth = sum(1 for d in days if d <= wd)
    return plan[wd], fasted[wd], nth, len(days)


def generate_today_plan(energy: float = 3, sleep: float = 7.0) -> dict:
    dailies = list_recent_dailies(21)
    # ─── 工作上下文与日历上下文 ───
    work_ctx = _load_work_context(_today().isoformat())
    day_ctx = _day_context()
    is_travel = day_ctx.get("active", False) and day_ctx.get("mode", "").startswith("旅行")
    travel_light = is_travel and day_ctx.get("work_policy", {}).get("online_work", False)

    # ── 力量训练日（从 config fitness sessions 读取）──
    fit_config = CONFIG.get("fitness", {})
    sessions = fit_config.get("sessions", [])
    strength_sessions = {s["id"]: s for s in sessions if s["id"] != "recovery"}
    recovery_session = next((s for s in sessions if s["id"] == "recovery"), None)
    week_start = _today() - dt.timedelta(days=_today().weekday())
    rng = _random.Random(f"peos-strength-{week_start.isoformat()}")
    strength_id = "strength-a" if rng.random() < 0.5 else "strength-b"
    today_strength = strength_sessions.get(strength_id)
    wd = _today().weekday()
    is_strength_day = wd in (0, 3)  # Monday, Thursday
    if is_travel:
        is_strength_day = False  # 旅行期间不安排力量训练

    course_blocks = today_course_blocks()
    has_courses = len(course_blocks) > 0
    sched = []
    for cb in course_blocks:
        sched.append({
            "block": cb["code"], "start": cb["start"], "end": cb["end"],
            "energy": "🔴 固定课程", "task": f"{cb['name']}（{cb['session']}）",
            "type": "课程", "goal": f"{cb['start']}–{cb['end']} {cb['location']}",
        })

    topics = [t for t in _load_topics()["items"] if not t.get("done")]
    topic = topics[0]["text"] if topics else None
    ysig = _yesterday_signal()
    tier_score = _energy_tier(energy, sleep, ysig)
    tier_names = {0: "恢复", 1: "低精力", 2: "默认", 3: "高能", 4: "满血"}
    tier_name = tier_names[tier_score]
    low = tier_score <= 1
    full = tier_score >= 4

    sport, fasted, nth, total_sport = _today_sport(ysig)
    tired_yday = ysig.get("tired") and ysig.get("exists")
    good_yday = ysig.get("good") and ysig.get("exists")

    # ── 从进度系统读取今天的读书/追剧建议 ──
    progress_sugs = progress_suggestions()
    book_show_text = ""
    if progress_sugs:
        book_show_text = progress_sugs[0]["text"]

    cond = []
    if ysig.get("exists"):
        if ysig.get("sleep") is not None:
            cond.append(f"昨日睡眠 {ysig['sleep']:g}h")
        if tired_yday:
            cond.append("日记有疲劳信号 → 今日强度调低")
        elif good_yday:
            cond.append("昨日状态好 → 可以上强度")
        if ysig.get("sports"):
            cond.append("昨日已做：" + "、".join(ysig["sports"]))
    else:
        cond.append("昨日无记录（状态未知，按默认强度）")

    # 旅行模式提示
    if is_travel:
        cond.append(f"📍 {day_ctx['location']} · {day_ctx['mode']}：旅行优先，保留关键工作")
        if travel_light:
            cond.append("  线上工作 + 大号内容继续推进")

    intensity = "低强度" if tired_yday else ("中高强度" if good_yday else "中等强度")

    # ── 泳池时段约束：早场 7:00–9:00 / 午后场 15:00–21:00（夜型作息 10:30 起只午后场可行）──
    def _hm(t):
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    def _fmt(mins):
        return f"{mins // 60:02d}:{mins % 60:02d}"

    _bus = sorted((_hm(cb["start"]), _hm(cb["end"])) for cb in course_blocks) if has_courses else []
    _has_am = any(s < 12 * 60 for s, _ in _bus)               # 上午课（Thu/Fri MKT5012/6012）
    _has_pm = any(13 * 60 <= s < 18 * 60 for s, _ in _bus)    # 下午课（Wed MKT6013 / Thu-Fri 6018+CEC）
    _has_ev = any(s >= 17 * 60 for s, _ in _bus)              # 晚课（Mon/Tue/Wed 18:00 场）

    # 游泳时段：午后场 15:00 开门；下午有课则下课后即游；晚课 18:00 前至少留 30 分钟缓冲
    sport_task, sport_time = None, None
    if sport:
        sport_task = f"游泳（{intensity} · 目标体脂 22%）"
        if is_travel:
            sport_task = f"{sport}（旅行·灵活安排）"
            sport_time = "灵活安排"
        else:
            pm_open = 15 * 60
            # 下午有课 → 下课后 +20min；没下午课 → 泳池开门 15:00 即游
            pm_end = max((e for s, e in _bus if s < 18 * 60), default=None)
            earliest = max(pm_open, pm_end + 20) if pm_end is not None else pm_open
            # 晚课日：游泳必须最晚在晚课开始前 30min 结束
            if _has_ev:
                ev_start = min(s for s, _ in _bus if s >= 17 * 60)
                if earliest + 45 <= ev_start - 30:
                    sport_time = f"{_fmt(earliest)}–{_fmt(earliest + 45)}"
                else:
                    sport_task = None   # 泳池时段与课完全冲突（如某些加课日）→ 当日休泳
            else:
                sport_time = f"{_fmt(earliest)}–{_fmt(earliest + 45)}"

    # 力量（周一/四）：排在游泳后 15 分钟；若与晚课冲突则压到游泳前
    strength_time = None
    if is_strength_day and today_strength and sport_time and "灵活" not in sport_time:
        s0 = _hm(sport_time.split("–")[0])
        after_swim = s0 + 45 + 15
        if not _has_ev or after_swim + 75 <= min(s for s, _ in _bus if s >= 17 * 60) - 15:
            strength_time = f"{_fmt(after_swim)}–{_fmt(after_swim + 75)}"
        else:
            pre = s0 - 90
            strength_time = f"{_fmt(pre)}–{_fmt(pre + 75)}" if pre >= 13 * 60 else None

    # 今日截止
    today_dl = today_deadlines()
    dl_note = ""
    if today_dl:
        dl_note = "📌 今日截止：" + "；".join(f"{d['item']}（{d['course']}）" for d in today_dl)

    # ── 今日重点（用户 2026-10 问卷：第一梯队 = 原子公社商务 > 大号 > 课程作业）──
    frogs = []
    focus = work_ctx.get("focus", "")
    if focus:
        frogs.append(f"🥇 {focus[:40]}")
    dahao_stage = work_ctx.get("dahao_stage", "")
    if dahao_stage and dahao_stage not in ("", "选题"):
        stage_verbs = {"素材": "收集素材", "草稿": "写草稿", "修改": "修改现有草稿",
                       "发布": "准备发布", "复盘": "复盘数据", "大纲": "写大纲/搭框架"}
        frogs.append(f"🥈 大号：用发布工作台{stage_verbs.get(dahao_stage, '推进')}")
    elif topic:
        frogs.append(f"🥈 大号：用发布工作台推进《{topic[:20]}》")
    else:
        frogs.append("🥈 大号：发布工作台推进本周这篇")
    if has_courses:
        courses_list = " + ".join(cb["code"] for cb in course_blocks)
        frogs.append(f"🥉 课程：上完（{courses_list}）+ 作业推进 45 分钟")
    else:
        frogs.append("🥉 课程作业：推进最近的截止项 60 分钟")
    if low:
        frogs = frogs[:1]
    if dl_note:
        frogs.insert(0, dl_note)

    # 读书/追剧建议并入青蛙
    if book_show_text and len(frogs) < 3 and not low:
        frogs.append(book_show_text[:60])

    # 新鲜开始效应：周一 / 月初
    wd_num = _today().weekday()
    dom = _today().day
    fresh_start = ""
    if wd_num == 0:
        fresh_start = "🌱 周一觉醒：新一周开始。本周唯一指标是「把 1 篇发出去」，其他都是加分项。"
    elif dom <= 3:
        fresh_start = "🌱 月初节点：自然的重新开始窗口。写下这个月最想完成的一件事。"
    elif dom >= 28:
        fresh_start = "🌱 月末冲刺：收尾窗口。清理这周未完成的 1–2 件小事。"

    # ── Build four-quadrant blocks ──
    mind, body, spirit, voc = [], [], [], []

    def _push(t_range, desc, bucket):
        bucket.append((t_range, desc))

    # 力量训练任务
    strength_text = ""
    if is_strength_day and today_strength:
        strength_text = f"力量训练：{today_strength['name']}"
        ex_list = " · ".join(today_strength.get("exercises", [])[:3])
        strength_text += f"（{ex_list}）"

    # ── 系统直接拍板的确定性内容（不再让用户挑）──
    # 语言：按星期定死 —— 单日=日语，双日=英语；周末两天 40 分钟双语
    _wd0 = _today().weekday()
    lang_20 = ("日语 20 分钟：认读假名 + 跟读课文" if _wd0 % 2 == 0
               else "英语 20 分钟：口述一个真实话题 + IELTS Part 2 录音")
    # 二梯队：单日=海外运营拆解，双日=大号工作台
    tier2_text = ("海外运营学习：拆 1 条海外爆款（YouTube Shorts / X / TikTok 按周轮换）——记下钩子、前 3 秒、CTA 三件套"
                  if _wd0 % 2 == 0 else
                  "大号工作台：把本周这篇推进到可发状态（配图 + 排版 + 定发布时间）")

    # 作业块：自动点名最近的未过截止 + 它的具体动作（courses.json action 字段）
    hw_text = None
    _dls = [x for x in upcoming_deadlines(30) if x["days_away"] > 0]
    _dls.sort(key=lambda x: x["days_away"])
    if _dls:
        _d0 = _dls[0]
        _act = ""
        for _c in load_courses().get("courses", []):
            if _c["code"] == _d0["course"]:
                _act = next((a.get("action", "") for a in _c.get("assessments", [])
                             if a.get("item") == _d0["item"]), "")
                break
        hw_text = f"🥉 {_d0['course']} {_d0['item']}（{_d0['days_away']} 天后交）——{_act[:44]}"
    else:
        hw_text = "🥉 复习最近一节课的 slide，标出 3 个考点"

    # ── 课程日程 vs 非课程日程（夜型作息 10:30 起 / 00:00 睡 / 泳池 15:00 开门；吃饭不占任务位）──
    if has_courses:
        # 每门课一条可勾选的出勤任务（勾选 = 确认上课 → 出勤积分）
        for cb in course_blocks:
            makeup_tag = "🔄调休" if cb.get("is_makeup") else ""
            _push(f"{cb['start']}–{cb['end']}",
                  f"📍 {cb['code']} {cb['name']}（{cb['session']}）{makeup_tag} 上课出勤", voc)

        if _has_am and not _has_pm:
            # 周三型（2026-10-08 改课表后）：早课 09:15-12:05 + 晚课 18:00 → 下午完整，泳 15:00 场
            _push("12:30–14:30", "🥇 原子公社商务块（120 分钟 · 番茄钟 25×4）", voc)
            _push("16:00–17:00", f"📖 换脑子读书 60 分钟：{book_show_text[:36] if book_show_text else '任意在读书'}", mind)
            _push("21:10–21:30", lang_20, mind)
            _push("21:35–22:20", "🥈 大号内容 · 发布工作台推进本周这篇", voc)
            _push("22:30–23:10", hw_text, voc)
        elif _has_am:
            # 周四/周五型：上午课 9:00-11:50 + 下午课 14:00-16:50 → 泳池 17:10 场
            _push("12:10–13:40", "🥇 原子公社商务块（90 分钟 · 番茄钟 25×3）", voc)
            _push("20:10–20:30", lang_20, mind)
            _push("20:40–21:25", "🥈 大号内容 · 发布工作台推进本周这篇", voc)
            _push("21:35–22:20", hw_text, voc)
            _push("22:30–23:00", f"📖 睡前读书 30 分钟：{book_show_text[:36] if book_show_text else '任意在读书'}", mind)
        elif _has_pm:
            # 周三型：下午课 13:30-16:20 + 晚课 18:00-20:50 → 商务块提到中午，泳 16:40 场
            _push("11:30–13:00", "🥇 原子公社商务块（90 分钟）", voc)
            _push("21:05–21:25", lang_20, mind)
            _push("21:30–22:15", "🥈 大号内容 · 发布工作台推进本周这篇", voc)
            _push("22:20–23:05", hw_text, voc)
        else:
            # 周一/周二型：仅晚课 18:00 → 白天完整，泳 15:00 开门场
            _push("12:00–14:00", "🥇 原子公社商务块（120 分钟 · 番茄钟 25×4）", voc)
            _push("14:15–15:00", f"📖 犯困带换脑子 · {book_show_text[:42] if book_show_text else '任意在读书 40 分钟'}", mind)
            if not strength_time:
                _push("16:00–17:00", f"🥈 {tier2_text}", voc)
            _push("21:05–21:25", lang_20, mind)
            _push("21:35–22:50", hw_text, voc)

        if strength_time and strength_text:
            _push(strength_time, strength_text, body)
        _push("23:40–23:45", "睡前三问 + 体重 / 支出 · 00:00 睡", spirit)

    else:
        # 非课日（周六/周日/假期）：泳 15:00 开门场，重点块 12:00 开工
        frog_desc = f"⚡ 今日重点：{frogs[0][:30]}" + ("（番茄钟 25×4）" if not low else "（做 25 分钟就算赢）")
        _push("12:00–14:00", frog_desc, voc)
        if not strength_time:
            _push("15:00-15:50" if not (sport_time and "15:00" in sport_time) else "16:00–17:00",
                  f"🥈 {tier2_text}", voc)
        if book_show_text and not low:
            _push("17:15–18:00", f"📖 {book_show_text[:60]}", mind)
        if strength_time and strength_text:
            _push(strength_time, strength_text, body)
        _push("20:00–20:40", "语言 40 分钟：日语 20（假名+跟读）+ 英语 20（口述+Part 2）", mind)
        _push("20:40–21:40", hw_text, voc)
        _push("23:40–23:45", "睡前三问 + 体重 / 支出 · 00:00 睡", spirit)

    # 运动任务插入（只插一次；低精力档删运动）
    if sport_task and sport_time and not low:
        body.append((sport_time, f"{sport_task} · 本周第 {nth}/{total_sport} 次"))
    elif not low and not sport_task and not is_strength_day:
        body.append(("17:00–17:30", "今日无有氧：散步或泡沫轴 20 分钟"))

    # 每周六：深度对话（排在作业块后，避免和语言块撞车）
    if _today().weekday() == 5 and not low:
        spirit.append(("22:00–22:30", "🎙️ 深度对话 30 分钟：问一个真人「最近在思考什么」"))

    # ── 去重兜底：同分区同文本只保留第一条（防双重插入回归）──
    def _dedupe(bucket):
        seen, out = set(), []
        for t, txt in bucket:
            key = re.sub(r"\s+", "", txt)[:24]
            if key in seen:
                continue
            seen.add(key)
            out.append((t, txt))
        return out

    # ── Sort into section buckets ──
    task_lines = {"mind": [], "body": [], "spirit": [], "voc": []}
    for bucket_key, bucket in [("mind", mind), ("body", body), ("spirit", spirit), ("voc", voc)]:
        task_lines[bucket_key] = _dedupe(bucket)

    sections = [
        ("🧠 心智 Mind", sorted(task_lines["mind"])),
        ("💪 身体 Body", sorted(task_lines["body"])),
        ("🤝 精神 Spirit", sorted(task_lines["spirit"])),
        ("🚀 事业 Vocation", sorted(task_lines["voc"])),
    ]

    three = [frogs[0]]
    three.append(frogs[1] if len(frogs) > 1 else "语言最低闭环完成（日语 + 英语）")
    three.append("晚间数据回填（体重 / 支出 / 日记一句话）")

    # 总览主表
    rows = list(sched)  # 课表行放最前面
    if has_courses:
        def _hm2(t):
            h, m = t.split(":")
            return int(h) * 60 + int(m)
        e_start = max(_hm2(cb["end"]) for cb in course_blocks) + 10
        rows.append({"block": "块 E", "start": f"{e_start // 60:02d}:{e_start % 60:02d}", "end": "23:45",
                     "energy": "🔵 回落",
                     "task": "语言 + 大号工作台 + 作业 + 三问", "type": "学习 / 收尾",
                     "goal": "三件事闭环；00:00 入睡"})
    else:
        def _row(blk, t, txt, typ, goal, en="🟡 中"):
            s, e = t.split("–")
            rows.append({"block": blk, "start": s, "end": e, "energy": en,
                         "task": txt[:30], "type": typ, "goal": goal})
        if sport and sport_time and not low:
            _row("块 A", sport_time, f"{sport_task}", "身体", f"本周第 {nth}/{total_sport} 次", "▰ 恢复")
        _row("块 B", "12:30–14:30", f"⚡ {frogs[0][:20]}", "今日重点", "商务/大号推进一步", "🔴 高")
        _row("块 C", "13:30–14:15", "犯困带 · 换脑子读一会儿", "心智", "轻输入不算 KPI")
        _row("块 D", "15:00–15:50", "第二梯队：海外运营 / 大号工作台", "事业", "挑一样推进")
        _row("块 E", "20:00–21:40", "语言 40 分钟 + 作业 60 分钟", "心智 / 事业", "两件闭环", "🟡 中")
        _row("块 F", "23:40–23:45", "睡前三问 + 数据", "精神 / 收尾", "00:00 睡", "🔵 回落")

    # 本周有氧排布展示
    wp, wf, wd = _week_sport_plan()
    wname = "一二三四五六日"
    week_line = " / ".join(f"周{wname[d]}·{wp[d]}" + ("（空腹）" if wf[d] else "") for d in sorted(wp))

    # 力量训练周标注
    strength_week_note = ""
    if is_strength_day and strength_text:
        strength_week_note = f"💪 力量日：{strength_text}"
    elif not is_strength_day and not is_travel:
        strength_week_note = "💪 今日无力量训练（恢复/有氧日）"

# ── 组装 markdown ──
    p = daily_path(_today())
    old_fm, old_diary = {}, ""
    if p.exists():
        old_text = read(p)
        old_fm = parse_frontmatter(old_text)
        old_diary = parse_daily(p, _today()).get("diary", "")
    keep = {k: old_fm[k] for k in ("weight", "mood", "sleep_score", "sleep_hours",
                                   "water", "protein", "spend") if old_fm.get(k)}
    # 存储当前上下文快照到 frontmatter，供 ensure_today_plan 检测变更
    ctx_snapshot = {k: work_ctx.get(k, "") for k in ("focus", "dahao_stage", "dahao_options", "fixed", "limitation")}
    ctx_hash = md5(json.dumps(ctx_snapshot, sort_keys=True).encode()).hexdigest()[:8]
    fm_lines = ["type: daily", f"date: {_today().isoformat()}",
                "peos_generated: true", f"peos_tier: {tier_name}",
                f"peos_tier_score: {tier_score}",
                f"peos_energy: {energy:g}", f"peos_sleep: {sleep:g}",
                f"peos_sport: {sport or '无'}", f"peos_ctx_hash: {ctx_hash}"]
    fm_lines += [f"{k}: {v}" for k, v in keep.items()]

    not_do = ("运动加量、新学习输入、任何新合作" if low else
              "新增合作；为凑数量发布；睡前刷数据后台")
    course_lines = []
    if course_blocks:
        course_lines = ["", "**今日固定课程**：", ""]
        for cb in course_blocks:
            makeup_tag = "（🔄 调休补课）" if cb.get("is_makeup") else ""
            course_lines.append(f"- {cb['start']}–{cb['end']}｜{cb['code']} {cb['name']}（{cb['session']}）{makeup_tag}｜{cb['location']}")
        course_lines.append("")
    elif _is_holiday(_today()):
        course_lines = ["", "**🏮 今日校历放假，无课**（中秋/国庆假期）。", ""]

    md = ["---", *fm_lines, "tags:", "  - daily/plan", "---", "",
          f"# {_today().isoformat()} · 今日计划（PEOS 生成 · {tier_name} · 预算 ¥100）", "",
          "## 🧠 今日模型", "",
          f"**状态判断**：{'；'.join(cond) if cond else '按默认'}。", ""]
    if fresh_start:
        md += [fresh_start, ""]
    md += course_lines
    md += [f"**今日重点**："]
    md += [f"- {f}" for f in frogs]
    md += ["", "**每天只做三件事**："]
    md += [f"{i + 1}. {t}" for i, t in enumerate(three)]
    md += ["", f"**今天明确不做**：{not_do}。", "",
           "**今日预算**：¥100 —— 睡前三问里顺手记支出。", "",
           f"**运动（每天游泳 · 泳池午后场 15:00-21:00 · 周一/四力量 · 目标体脂 22%）**：{week_line}",
           (f"今天安排：{sport_task}（本周第 {nth}/{total_sport} 次）" if sport and not low
            else "今天周日，泳池休息日。" if not sport
            else "今天有氧已删（低精力档）。"), "",
           "## 🗓️ 总览主表（任务 × 时间 × 精力）", "",
           "| 块 | 时间 | 精力水平 | 任务 | 类型 | 完成线 |",
           "|----|------|----------|------|------|--------|"]
    md += ["| " + " | ".join([r["block"], f"{r['start']}–{r['end']}", r["energy"],
                              r["task"], r["type"], r["goal"]]) + " |" for r in rows]
    md += ["", "> 优先第一梯队；做不完的顺延，不算失败。"]

    for title, items in sections:
        md += ["", f"## {title}", ""]
        for t, txt in sorted(items):
            md += [f"- [ ] {t} {txt}"]

    # 睡前三问（轻松语气 · 体重/支出 · 入睡时间推算睡眠）
    md += ["", "## ✨ 睡前三问（23:40 · 顺手 5 分钟）", ""]
    if has_courses:
        _codes_q = " + ".join(cb["code"] for cb in course_blocks)
        md += [f"0. 今天 {(_codes_q)} 的课去上了吗？（去了→勾掉上面的 📍 出勤任务；没去→写一句原因，别骗自己）", ""]
    md += [
        "1. 今天最爽的一下是啥？",
        "2. 哪儿卡住了？（尽管吐槽）",
        "3. 明天最想干掉的一件事？", "",
        "- 体重：",
        "- 支出：",
        "- 入睡时间：（如 00:30）", ""]
    # 日记：没写过就不预写空模板（写日记时 DiaryEditor 会自动创建对应段落）
    if old_diary:
        md += ["## 📖 今日日记", "", old_diary, ""]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(md), encoding="utf-8")
    return {"ok": True, "tier": tier_name, "frogs": frogs,
            "sport": sport_task or sport or "无", "fasted": fasted,
            "tasks": sum(len(items) for _, items in sections),
            "day_context": day_ctx, "work_context": work_ctx,
            "progress_suggestions": progress_sugs,
            "strength_day": is_strength_day,
            "strength_text": strength_text if is_strength_day and strength_text else None,
            "book_show": book_show_text,
            "is_holiday": _is_holiday(_today()),
            "is_makeup": _makeup_weekday(_today()) is not None}


def ensure_today_plan():
    """刷新页面时自动生成：检测到上下文变更时也重新生成。"""
    p = daily_path(_today())
    if not p.exists():
        return generate_today_plan()
    fm = parse_frontmatter(read(p))
    # 如果已生成，检查上下文是否变更
    if fm.get("peos_generated"):
        old_hash = fm.get("peos_ctx_hash", "")
        work_ctx = _load_work_context(_today().isoformat())
        ctx_snapshot = {k: work_ctx.get(k, "") for k in ("focus", "dahao_stage", "dahao_options", "fixed", "limitation")}
        cur_hash = md5(json.dumps(ctx_snapshot, sort_keys=True).encode()).hexdigest()[:8]
        if old_hash != cur_hash and any(work_ctx.get(k) for k in ("focus", "dahao_stage")):
            return generate_today_plan()
        return None
    if parse_daily(p, _today())["total"] == 0:
        return generate_today_plan()
    return None


# ---------------------------------------------------------------- 身体数据（网页直填 → Daily frontmatter）

DAILY_NUM_FIELDS = ("weight", "mood", "sleep_hours", "water", "protein", "spend")


def save_daily_data(date_iso: str, fields: dict):
    try:
        d = dt.date.fromisoformat(date_iso)
    except ValueError:
        return {"ok": False, "error": "bad date"}
    p = daily_path(d)
    p.parent.mkdir(parents=True, exist_ok=True)
    clean = {}
    for k in DAILY_NUM_FIELDS:
        v = fields.get(k)
        if v is None or v == "":
            continue
        try:
            clean[k] = float(v)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"{k} 不是数字"}
    if not p.exists():
        fm = {"type": "daily", "date": d.isoformat(), **clean}
        p.write_text("---\n" + "\n".join(f"{k}: {v}" for k, v in fm.items()) +
                     "\ntags:\n  - daily/plan\n---\n\n"
                     f"# {d.isoformat()} · 今日计划\n", encoding="utf-8")
        return {"ok": True, "path": str(p), "created": True, "fields": clean}
    text = p.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return {"ok": False, "error": "Daily 没有 frontmatter"}
    lines = m.group(1).split("\n")
    for k, v in clean.items():
        done = False
        for i, ln in enumerate(lines):
            if re.match(rf"^{k}\s*:", ln):
                lines[i] = f"{k}: {v:g}"
                done = True
                break
        if not done:
            lines.append(f"{k}: {v:g}")
    p.write_text("---\n" + "\n".join(lines) + "\n---" + text[m.end():], encoding="utf-8")
    return {"ok": True, "path": str(p), "created": False, "fields": clean}


# ---------------------------------------------------------------- 决策 Agent（通用 skill）

def decision_chain(st: dict):
    """与前端 runEngine 相同的 Jarvis 判断顺序，服务端复刻。"""
    hits = []
    if st.get("redFlag"):
        hits.append("safety")
    if st.get("fixed"):
        hits.append("fixed")
    if st.get("sleep", 7) < 6.5 or st.get("energy", 3) <= 2:
        hits.append("recovery")
    if st.get("budget"):
        hits.append("finance")
    hits.append("mainline")
    if st.get("energy", 3) >= 4 and not st.get("redFlag"):
        hits.append("explore")
    order = [o["id"] for o in CONFIG["decision_order"]]
    names = {o["id"]: o["name"] for o in CONFIG["decision_order"]}
    first = next((h for h in order if h in hits), "mainline")
    return hits, first, names[first]


def agent_context(st: dict) -> str:
    q = CONFIG["quadrants"]
    _, first_id, first_name = decision_chain(st)
    dailies = list_recent_dailies(14)
    rich = None
    for d, path in reversed(dailies):
        data = parse_daily(path, d)
        if data["total"] > 0:
            rich = (d, data)
            break
    frog = rich[1]["frog"] if rich else ""
    incomplete = sum(len(parse_daily(p, d)["incomplete"]) for d, p in dailies)
    return (f"当前日期：{_today().isoformat()}\n"
            f"用户状态输入：精力 {st.get('energy', 3)}/5，昨晚睡眠 {st.get('sleep', 7)}h，"
            f"健康红灯={'有' if st.get('redFlag') else '无'}，固定安排={'有' if st.get('fixed') else '无'}，"
            f"预算紧张={'是' if st.get('budget') else '否'}\n"
            f"判断顺序推出的第一优先级：{first_name}\n"
            f"最近青蛙：{frog or '未记录'}\n"
            f"近 14 天未勾选任务总数：{incomplete}\n"
            f"四象限：当前总分 {q['current_total']}/5，90天目标 {q['after90_total']}，理想 {q['ideal_total']}；"
            + "；".join(f"{i['name']} {i['current']}" for i in q["items"]))


# 离线规则库：关键词 → (结论, 依据, 下一步, 反悔条件)
OFFLINE_RULES = [
    (["换工作", "跳槽", "离职", "辞职", "裸辞", "提离职", " resign"],
     "现在不换。用作品建立议价权之前，换工作是用换标签代替换层级。",
     "HUMAN3.0 Part 3.4：跳槽是终局动作不是探索动作；且「用评估换工作代替开始创作」是优化者陷阱的经典伪装。",
     "① 本周公开一篇；② 把「内部转化」谈话提上日程（用已发布内容做证据）。",
     "四条触发条件任一满足才重新讨论：已发 ≥8 篇有质量公开内容 / 出现能补关键缺失能力的具体机会 / 当前岗位本质恶化 / 可客观证明团队是结构性消耗。"),
    (["累", "疲惫", "撑不住", "没精力", "低能量", "降档", "躺"],
     "降档运行，删任务不压时间。",
     "Jarvis 判断顺序：睡眠恢复与饮食优先于主线；SKILL 三档方案：降档时必须删除任务，不是把默认方案缩短。",
     "只保 🐸 青蛙 + 语言最低闭环（日语 15min），其余今天不做。今晚 23:00 前收尾是硬约束。",
     "明早精力回到 ≥3/5 即恢复默认档。"),
    (["发布", "发不发", "写不写", "这篇", "发出去", "卡在"],
     "发。质量不是这个月的指标，发出去才是。",
     "HUMAN3.0 月份 1 策略：唯一指标是「这周写没写、有没有发出去」；你回避的不是写作，是以未完成状态被看见。",
     "脱敏检查（抹掉可识别合作方信息）→ 发布 → 周五写 200 字反思。",
     "涉及未脱敏的具体合作方/创业者信息时，先脱敏再发。"),
    (["优先", "先做", "今天做什么", "安排", "排序", "怎么排", "接下来"],
     None,  # 结论由判断顺序动态生成
     "Jarvis 判断顺序：安全与医疗 → 固定安排 → 睡眠恢复与饮食 → 财务安全 → 当前主线 → 体验探索 → 临时便利。",
     None,
     None),
    (["合作", "接单", "组局", "生态", "商务", "帮忙牵线", "新项目"],
     "不接。这是本学期已确认的战略边界。",
     "2026 秋半年框架（9/4 决策）：生态合作 A 池全线收紧，精力全部收到 B 池（个人 IP）；不新增任何生态合作。",
     "礼貌回绝，不解释太多；把省下的精力投给大号本周这篇。",
     "本学期内无条件反悔。"),
    (["健身", "训练", "运动", " gym", "减脂"],
     "按计划维持，不做加法。",
     "HUMAN3.0：身体是最完整的象限（执行肌肉），不应急着优化。",
     "完成今天计划内的训练；没时间就保最低 20 分钟 + 蛋白 130g。",
     "医嘱或伤病则暂停并调整计划。"),
    (["社交", "朋友", "关系", "亲密", "聊天", "约人"],
     "做深度对话实验，但要意识到你在打破家庭代际默认。",
     "HUMAN3.0 Spirit 诊断：被训练成「功能性亲密但不共享内在状态」；功课是先经历被看见，再选择从容（警惕前-超谬误）。",
     "本周完成 1 次深度对话（从问题清单选一个问真人）；写作是文字版的练习场。",
     "对方明确不接受深入时退回表层，不强推。"),
    (["读书", "报课", "学个", "新技能", "考证", "想学"],
     "不新增输入。",
     "HUMAN3.0 心智唯一约束：90 天内不读新书、不报课程、不做新习惯系统——输入过载、输出不足；任何「想多学」都是优化者陷阱的养料。",
     "把想学的内容写成一篇笔记发布（输出倒逼输入）。",
     "90 天承诺期结束后在月度复盘里统一评估。"),
    (["买", "花钱", "预算", "支出", "剁手"],
     "先过财务安全这道闸。",
     "Jarvis 判断顺序：财务安全在主线之前；半年框架提醒：兴趣探索花钱要留意预算。",
     "非必要支出冻结到月底；必要支出从兴趣课预算内腾挪，不新增总额。",
     "月预算未超且砍掉等额其他支出时可放行。"),
]


def offline_oracle(question: str, st: dict) -> str:
    q = question.strip()
    _, first_id, first_name = decision_chain(st)
    for kws, concl, basis, act, abort in OFFLINE_RULES:
        if not any(k in q for k in kws):
            continue
        if concl is None:  # 动态结论：优先级类问题
            concl = (f"按你当前状态，第一优先级是「{first_name}」。"
                     if first_id != "mainline" else
                     "今天没有红灯项，直接进主线：个人 IP 输出。")
            act = ("执行对应档位：精力 ≤2 只保青蛙 + 语言最低闭环；3–4 按三件事走；5 可加一项兴趣探索。"
                   if not act else act)
            abort = abort or "状态输入变化（精力/睡眠/红灯）时重新跑一遍判断顺序。"
        basis = basis or ""
        out = [f"【结论】{concl}"]
        if basis:
            out.append(f"【依据】{basis}")
        if act:
            out.append(f"【下一步】{act}")
        if abort:
            out.append(f"【反悔条件】{abort}")
        out.append("（离线规则引擎 · 依据见决策台方法论卡片）")
        return "\n".join(out)
    # default
    return "\n".join([
        f"【结论】这个问题没有直接命中规则库，先按判断顺序走：当前第一优先级是「{first_name}」。",
        "【依据】Jarvis 判断顺序：安全与医疗 → 固定安排 → 睡眠恢复与饮食 → 财务安全 → 当前主线 → 体验探索 → 临时便利。",
        "【下一步】可以把问题问得更具体，比如：要不要换工作 / 今天先做什么 / 这篇发不发 / 要不要接这个合作 / 今天太累了怎么办。",
        "【反悔条件】状态输入变化时重新判断。",
        "（离线规则引擎 · 在 config.json → agent 填入 api_key 可接入 LLM 自由问答）",
    ])


def call_llm(cfg: dict, api_key: str, question: str, ctx: str) -> str:
    skill = read(BASE / "agent_skill.md")
    payload = json.dumps({
        "model": cfg.get("model", "glm-4.6"),
        "messages": [
            {"role": "system", "content": skill + "\n\n# 当前上下文\n" + ctx},
            {"role": "user", "content": question},
        ],
        "max_tokens": 700,
        "temperature": 0.4,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["api_base"].rstrip("/") + "/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


def agent_answer(question: str, st: dict):
    api_key, cfg = _llm_key()
    ctx = agent_context(st)
    if api_key and cfg.get("api_base"):
        try:
            return {"mode": "llm", "answer": call_llm(cfg, api_key, question, ctx)}
        except Exception as e:
            return {"mode": "offline", "answer": offline_oracle(question, st),
                    "llm_error": str(e)}
    return {"mode": "offline", "answer": offline_oracle(question, st)}


# ---------------------------------------------------------------- LLM 任务解析（丢给我 → 智能拆解）

TASK_PARSE_PROMPT = """你是 ADHD 用户的任务解析器。把一段口语化输入拆成结构化任务，严格只输出 JSON 数组，不要任何解释。

规则：
1. 不依赖换行：按语义判断到底有几件事（"下午买咖啡顺便把论文初稿写了"= 2 件）
2. duration_min 按真实工作量估：回复消息/取快递 15-30；常规作业/开会 30-60；写文章/做 PPT/写代码 60-120；大项目整块 120-240
3. priority：q1=今天必须或有明确截止；q2=重要不紧急；q3=琐事速办；q4=可选享受
4. time_hint：需要动脑的难任务给 "focus"（排精力好的时段）；不用动脑的轻活给 "light"（犯困带也能做）；用户说了具体时间给 "HH:MM"；没说给 "any"
5. text 洗掉所有时间表述和「顺便/然后」这类连接词，保留动作+对象，30 字以内
6. 用户提到「截止今天/明天」→ priority=q1 且 text 里保留截止信息

输出示例：
[{"text":"买咖啡","duration_min":20,"priority":"q3","time_hint":"any"},
 {"text":"论文初稿","duration_min":120,"priority":"q1","time_hint":"focus"}]"""


def _llm_key():
    cfg = CONFIG.get("agent", {})
    file_key = ""
    kp = DATA_DIR / "llm_key.txt"
    if kp.exists():
        file_key = kp.read_text(encoding="utf-8").strip()
    return (cfg.get("api_key") or file_key or os.environ.get("PEOS_LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")), cfg


def parse_tasks_llm(raw: str):
    """整段话 → LLM 拆任务（含时长/优先级/时段偏好）。未配 LLM → 本地兜底按标点粗拆。"""
    api_key, cfg = _llm_key()
    raw = (raw or "").strip()
    if not raw:
        return {"ok": False, "error": "空的"}
    if api_key and cfg.get("api_base"):
        try:
            payload = json.dumps({
                "model": cfg.get("model", "glm-4.6"),
                "messages": [
                    {"role": "system", "content": TASK_PARSE_PROMPT},
                    {"role": "user", "content": raw},
                ],
                "max_tokens": 600,
                "temperature": 0.1,
            }).encode("utf-8")
            req = urllib.request.Request(
                cfg["api_base"].rstrip("/") + "/chat/completions",
                data=payload,
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
                method="POST")
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
            items = json.loads(content)
            tasks = []
            for it in items if isinstance(items, list) else []:
                dur = int(it.get("duration_min") or 30)
                dur = max(30, min(240, round(dur / 30) * 30))   # 吸附到 30 分钟粒度（排期底座）
                tasks.append({
                    "text": str(it.get("text") or "")[:60].strip(),
                    "duration_min": dur,
                    "priority": it.get("priority") if it.get("priority") in ("q1", "q2", "q3", "q4") else "q2",
                    "time_hint": str(it.get("time_hint") or "any")[:8],
                })
            tasks = [t for t in tasks if t["text"]]
            if tasks:
                return {"ok": True, "mode": "llm", "tasks": tasks}
        except Exception as e:
            err = str(e)
    else:
        err = "未配置 LLM（config.json → agent.api_base/api_key）"
    # 本地兜底：按标点/连接词粗拆，时长一律 30
    parts = re.split(r"[。；;\n]|然后|顺便|之后|接着", raw)
    tasks = [{"text": p.strip()[:60], "duration_min": 30, "priority": "q2", "time_hint": "any"}
             for p in parts if p.strip()]
    return {"ok": bool(tasks), "mode": "fallback", "tasks": tasks,
            "error": err if not tasks else (err or None)}


# ---------------------------------------------------------------- 财务

def _load_finance() -> dict:
    p = DATA_DIR / "finance.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"records": []}


def _save_finance(f: dict):
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "finance.json").write_text(
        json.dumps(f, ensure_ascii=False, indent=1), encoding="utf-8")


def finance_overview():
    fcfg = CONFIG.get("finance", {})
    recs = sorted(_load_finance()["records"], key=lambda r: r.get("date", ""), reverse=True)
    month = _today().strftime("%Y-%m")
    m_in = sum(r["amount"] for r in recs if r["date"].startswith(month) and r["type"] == "in")
    m_out = sum(r["amount"] for r in recs if r["date"].startswith(month) and r["type"] == "out")
    # 近 30 天 Daily「总支出」聚合
    daily_spend = [{k: b.get(k) for k in ("date", "spend")}
                   for b in build_overview()["body_trend"] if b.get("spend")]
    balance = fcfg.get("opening_balance")
    if balance is not None:
        balance = balance + sum(r["amount"] * (1 if r["type"] == "in" else -1) for r in recs)
    return {
        "month": month,
        "month_in": m_in, "month_out": m_out, "month_net": m_in - m_out,
        "balance": balance,
        "records": recs[:60],
        "daily_spend": daily_spend,
        "notes": fcfg.get("notes", []),
        "opening_balance": fcfg.get("opening_balance"),
        "daily_budget": fcfg.get("daily_budget", 100),
    }


def add_finance_record(body: dict):
    f = _load_finance()
    rec = {
        "id": f"{_today().strftime('%Y%m%d')}-{len(f['records']) + 1:03d}-{dt.datetime.now().strftime('%H%M%S')}",
        "date": body.get("date") or _today().isoformat(),
        "type": "in" if body.get("type") == "in" else "out",
        "amount": abs(float(body.get("amount") or 0)),
        "category": str(body.get("category") or "")[:30],
        "note": str(body.get("note") or "")[:80],
    }
    if rec["amount"] <= 0:
        return {"ok": False, "error": "金额必须大于 0"}
    f["records"].append(rec)
    _save_finance(f)
    return {"ok": True, "record": rec}


def delete_finance_record(rid: str):
    f = _load_finance()
    before = len(f["records"])
    f["records"] = [r for r in f["records"] if r["id"] != rid]
    _save_finance(f)
    return {"ok": len(f["records"]) < before}


# ---------------------------------------------------------------- 汇总 API

def build_overview():
    try:
        ensure_today_plan()          # 每天首次刷新自动生成当日计划
    except Exception:
        pass
    dailies = list_recent_dailies(35)
    today_data = None
    latest_data, latest_date = None, None
    rich_data, rich_date = None, None
    week = []
    decisions = []
    body_trend = []
    diary_cards = []

    for d, path in dailies:
        data = parse_daily(path, d)
        if d == _today():
            today_data = data
        latest_data, latest_date = data, d
        if data["total"] > 0 or data["decisions"]:
            rich_data, rich_date = data, d
        if (_today() - d).days <= 13:
            week.append({
                "date": d.isoformat(), "weekday": "周" + "一二三四五六日"[d.weekday()],
                "total": data["total"], "done": data["done"],
                "incomplete": data["incomplete"],
                "tasks": [{"text": t["text"], "raw": t["raw"], "done": t["done"],
                           "section": sec["section"]}
                          for sec in data["tasks_by_section"] for t in sec["tasks"]],
            })
        if (_today() - d).days <= 30:
            body_trend.append({k: data.get(k) for k in
                               ("date", "weight", "mood", "sleep_hours", "water", "protein", "spend")})
            diary_cards.append({"date": d.isoformat(),
                                "weekday": "周" + "一二三四五六日"[d.weekday()],
                                **data["card"], "done": data["done"], "total": data["total"]})
        for dec in data["decisions"]:
            if dec and dec not in ("无", "—"):
                decisions.append({"date": d.isoformat(), "text": dec})

    # 健身进度
    fit = CONFIG["fitness"]
    try:
        start = dt.date.fromisoformat(fit["start_date"])
    except ValueError:
        start = _today()
    week_no = max(0, (_today() - start).days // 7 + 1)
    latest_weight = next((b["weight"] for b in reversed(body_trend) if b["weight"]), None)

    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "today": _today().isoformat(),
        "today_daily": today_data,
        "latest_daily": {"date": latest_date.isoformat(), **(latest_data or {})} if latest_data else None,
        "latest_rich_daily": {"date": rich_date.isoformat(), **(rich_data or {})} if rich_data else None,
        "week": week,
        "body_trend": body_trend,
        "diary_cards": diary_cards[::-1],
        "content": parse_content_calendar(),
        "timeline": parse_timeline(),
        "today_courses": today_course_blocks(),
        "lan_url": f"http://{_lan_ip()}:{CONFIG.get('port', 8790)}",
        "upcoming_deadlines": upcoming_deadlines(30),
        "today_deadlines": today_deadlines(),
        "calendar": {
            "is_holiday": _is_holiday(_today()),
            "is_makeup": _makeup_weekday(_today()) is not None,
            "makeup_weekday": _makeup_weekday(_today()),
            "holidays": load_courses().get("holidays", []),
        },
        "decisions": decisions[::-1][:30],
        "kpi_counts": estimate_kpi(dailies),
        "fitness": {
            **fit, "week_no": min(week_no, fit["weeks"]),
            "latest_weight": latest_weight,
            "weight_gap": round((latest_weight or fit["weight_start"]) - fit["weight_target"], 1)
                          if latest_weight else None,
        },
        "config": {
            "user": CONFIG["user"],
            "quadrants": CONFIG["quadrants"],
            "kpi_weekly": CONFIG["kpi_weekly"],
            "semester": CONFIG["semester"],
            "decision_methodology": CONFIG["decision_methodology"],
            "decision_order": CONFIG["decision_order"],
        },
    }


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    def do_GET(self):
        if self.path.startswith("/api/weather"):
            try:
                self._json(200, get_weather())
            except Exception as e:
                self._json(500, {"weather": {"ok": False, "error": str(e)}, "quote": None})
            return
        if self.path.startswith("/api/media"):
            self._json(200, {"ok": True, **_load_media()})
            return
        if self.path.startswith("/api/game"):
            try:
                self._json(200, game_state())
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path.startswith("/api/progress"):
            self._json(200, {"ok": True, **_load_progress()})
            return
        if self.path.startswith("/api/calibration"):
            try:
                self._json(200, get_calibration())
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path.startswith("/api/topics"):
            self._json(200, {"ok": True, **_load_topics()})
            return
        if self.path.startswith("/api/finance"):
            try:
                self._json(200, {"ok": True, **finance_overview()})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path.startswith("/api/diary"):
            qs = parse_qs(urlparse(self.path).query)
            date = (qs.get("date") or [_today().isoformat()])[0]
            self._json(200, read_diary(date))
            return
        if self.path.startswith("/api/day-context"):
            qs = parse_qs(urlparse(self.path).query)
            date = (qs.get("date") or [_today().isoformat()])[0]
            self._json(200, _day_context(_parse_date(date, _today())))
            return
        if self.path.startswith("/api/weread/status"):
            self._json(200, weread_status())
            return
        if self.path.startswith("/api/courses/progress"):
            try:
                self._json(200, course_progress())
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path.startswith("/api/insights"):
            qs = parse_qs(urlparse(self.path).query)
            days = int((qs.get("days") or ["7"])[0] or 7)
            try:
                self._json(200, recent_insights(days))
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if self.path.startswith("/api/suggestions"):
            qs = parse_qs(urlparse(self.path).query)
            date = (qs.get("date") or [_today().isoformat()])[0]
            self._json(200, {"ok": True, "suggestions": progress_suggestions(_parse_date(date, _today()))})
            return
        if self.path.startswith("/api/context"):
            qs = parse_qs(urlparse(self.path).query)
            date = (qs.get("date") or [_today().isoformat()])[0]
            self._json(200, get_work_context(date))
            return
        if self.path.startswith("/api/overview"):
            try:
                payload = json.dumps(build_overview(), ensure_ascii=False).encode("utf-8")
            except Exception as e:  # 解析失败不能白屏
                payload = json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        else:
            super().do_GET()

    def _json(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception as e:
            self._json(400, {"ok": False, "error": f"bad request: {e}"})
            return
        if self.path == "/api/task/toggle":
            self._json(200, toggle_task(body.get("date", ""), body.get("section", ""),
                                        body.get("raw", ""), bool(body.get("done"))))
        elif self.path == "/api/diary":
            r = save_diary(str(body.get("date", "")), str(body.get("text", "")))
            self._json(200, r)
        elif self.path == "/api/finance/record":
            try:
                self._json(200, add_finance_record(body))
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/finance/record/delete":
            self._json(200, delete_finance_record(str(body.get("id", ""))))
        elif self.path == "/api/topics":
            self._json(200, add_topic(body))
        elif self.path == "/api/topics/delete":
            self._json(200, delete_topic(str(body.get("id", ""))))
        elif self.path == "/api/topics/toggle":
            self._json(200, toggle_topic(str(body.get("id", ""))))
        elif self.path == "/api/media":
            self._json(200, add_media(body))
        elif self.path == "/api/media/delete":
            self._json(200, delete_media(str(body.get("id", ""))))
        elif self.path == "/api/daily-data":
            try:
                self._json(200, save_daily_data(str(body.get("date", "")), body))
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/progress":
            self._json(200, add_progress(body))
        elif self.path == "/api/progress/inc":
            try:
                self._json(200, inc_progress(str(body.get("id", "")), int(body.get("delta", 1))))
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/progress/delete":
            self._json(200, delete_progress(str(body.get("id", ""))))
        elif self.path == "/api/weread/sync":
            self._json(200, weread_sync())
        elif self.path == "/api/parse-tasks":
            try:
                self._json(200, parse_tasks_llm(str(body.get("text", ""))))
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/game":
            action = body.get("action")
            try:
                if action == "earth":
                    self._json(200, earth_toggle(int(body.get("idx", -1)), bool(body.get("done"))))
                elif action == "reward_add":
                    self._json(200, reward_add(body))
                elif action == "reward_delete":
                    self._json(200, reward_delete(str(body.get("id", ""))))
                elif action == "redeem":
                    self._json(200, reward_redeem(str(body.get("id", ""))))
                elif action == "precommitment_create":
                    self._json(200, precommitment_create(body))
                elif action == "precommitment_resolve":
                    self._json(200, precommitment_resolve(str(body.get("id", ""))))
                elif action == "surprise_claim":
                    self._json(200, surprise_claim())
                elif action == "surprise_complete":
                    self._json(200, surprise_complete())
                elif action == "savor":
                    self._json(200, savor_bonus(str(body.get("rid", "")),
                                                str(body.get("note", ""))))
                elif action == "double_day":
                    self._json(200, toggle_double_day())
                else:
                    self._json(404, {"ok": False, "error": "unknown action"})
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/task/add":
            self._json(200, add_task(body))
        elif self.path == "/api/task/edit":
            self._json(200, edit_task(body))
        elif self.path == "/api/plan":
            try:
                # Save work context if provided, then generate plan
                if body.get("focus") or body.get("dahao_stage"):
                    save_work_context(body)
                r = generate_today_plan(float(body.get("energy", 3)), float(body.get("sleep", 7)))
                self._json(200, r)
            except Exception as e:
                self._json(400, {"ok": False, "error": str(e)})
        elif self.path == "/api/context":
            self._json(200, save_work_context(body))
        elif self.path == "/api/calibration":
            try:
                self._json(200, save_calibration(body))
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
        elif self.path == "/api/ask":
            st = body.get("engine_state") or {}
            self._json(200, agent_answer(str(body.get("question", "")), st))
        else:
            self._json(404, {"ok": False, "error": "not found"})


def _lan_ip() -> str:
    """取本机局域网 IP（手机同 WiFi 访问用）。
    优先 192.168/10.x 网段；排除 VPN TUN 常用的 198.18/100.64 段。"""
    import socket
    cands = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                cands.append(ip)
    except Exception:
        pass
    for ip in cands:
        if ip.startswith(("192.168.", "10.")):
            return ip
    for ip in cands:
        if not ip.startswith(("198.18.", "198.19.", "100.64.", "172.16.", "172.31.")):
            return ip
    # 兜底：UDP 路由探测
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    port = CONFIG.get("port", 8790)
    lan = _lan_ip()
    print(f"PEOS · SJY Personal Executive OS")
    print(f"vault（只读）: {VAULT}")
    print(f"本机访问   : http://127.0.0.1:{port}")
    print(f"手机访问   : http://{lan}:{port}   ← 手机连同一 WiFi 打开")
    print("Ctrl+C 停止")
    # 0.0.0.0：允许同一局域网内手机访问；服务无对外依赖，仅家庭/校园网内可达
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
