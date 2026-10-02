#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
find_book.py — 电子书搜索/下载 + 每周读书任务

用法：
  python3 find_book.py "Meditations Marcus Aurelius"   # 按关键词搜公版书并下载
  python3 find_book.py --weekly                        # 每周任务：轮换选书+写PEOS+下载
  python3 find_book.py --list                          # 看书池

自动源：Gutendex（古登堡计划 7万+ 公版书，epub/mobi 直下，无版权问题）
下载到：~/Documents/Books/ → 检测到 Kindle 自动拷贝，否则用图书 App 打开
"""
import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

POOL_PATH = Path(__file__).resolve().parent / "reading_pool.json"
DEST = Path.home() / "Documents" / "Books"
PEOS = "http://127.0.0.1:8790"
UA = {"User-Agent": "Mozilla/5.0 (find_book.py; PEOS reading tool)"}


def http_json(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def download(url: str, path: Path, timeout: int = 120) -> bool:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)
        return path.stat().st_size > 10240  # >10KB 算成功
    except Exception as e:
        print(f"  ✗ 下载失败 {url[:70]} → {e}")
        if path.exists():
            path.unlink()
        return False


def gutendex_fetch(query: str):
    """搜索古登堡，返回 (书信息, {格式: url})"""
    url = "https://gutendex.com/books?search=" + urllib.parse.quote(query)
    data = http_json(url)
    results = data.get("results", [])
    return results[0] if results else None


def gutendex_by_id(gid: int):
    """按 ID 精确取书（书池用，绕过搜索限流）"""
    return http_json(f"https://gutendex.com/books?id={gid}")


def gutenberg_page_fallback(gid: int):
    """Gutendex 限流时，直接爬 gutenberg.org 书页拿格式链接"""
    import re
    req = urllib.request.Request(f"https://www.gutenberg.org/ebooks/{gid}", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "ignore")
    m = re.search(r'<h1[^>]*>(?:<[^>]+>)*([^<]+)', html)
    title = m.group(1).strip() if m else f"Gutenberg {gid}"
    formats = {}
    for href, mime in [
        (f"/ebooks/{gid}.kindle.images", "application/x-mobipocket-ebook"),
        (f"/ebooks/{gid}.kf8.images", "application/x-mobipocket-ebook"),
        (f"/ebooks/{gid}.epub3.images", "application/epub+zip"),
        (f"/ebooks/{gid}.epub.images", "application/epub+zip"),
    ]:
        if href in html:
            formats[mime] = "https://www.gutenberg.org" + href
    return {"id": gid, "title": title, "authors": [], "formats": formats}


def fetch_and_download(query: str, label: str = "", gid: int | None = None) -> Path | None:
    """搜索或按ID取书 + 下载 epub/mobi，返回保存目录"""
    DEST.mkdir(parents=True, exist_ok=True)
    if gid:
        print(f"🔍 Gutenberg #{gid}（书池指定）")
        try:
            book = gutendex_by_id(gid)
            if not book or "id" not in book:
                book = None
        except Exception:
            book = None
        if book is None:
            try:
                print("  ↻ Gutendex 限流，走 gutenberg.org 书页直连…")
                book = gutenberg_page_fallback(gid)
            except Exception as e:
                print(f"  ✗ 两条路都不可达：{e}")
                return None
        if not book:
            print("  ✗ 没取到这本书")
            return None
    else:
        print(f"🔍 搜索古登堡：{query}")
        try:
            book = gutendex_fetch(query)
        except Exception as e:
            print(f"  ✗ Gutendex 不可达：{e}")
            return None
        if not book:
            print("  ✗ 没搜到，换个关键词试试")
            return None

    title = book.get("title", "untitled")
    author = ", ".join(a["name"] for a in book.get("authors", [])) or "unknown"
    safe = "".join(c for c in f"{title} - {author}" if c not in '\\/:*?"<>|')[:80]
    out_dir = DEST / safe
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"  📖 {title} — {author} (Gutenberg #{book['id']})")

    fmts = book.get("formats", {})
    got = []
    # 优先 mobi（Kindle 直用），再 epub（图书 App）
    for key, ext in [("application/x-mobipocket-ebook", "mobi"),
                     ("application/epub+zip", "epub"),
                     ("application/pdf", "pdf")]:
        url = fmts.get(key)
        if not url or url.endswith((".rar", ".zip")) and ext != "epub":
            continue
        out = out_dir / f"{safe[:60]}.{ext}"
        if download(url, out):
            got.append(out)
            print(f"  ✅ {ext} → {out}")

    if not got:
        print("  ✗ 该书无可直下格式")
        return None
    deliver(got)
    return out_dir


def deliver(files: list[Path]):
    """Kindle 已挂载 → 拷 mobi；否则图书 App 打开 epub/pdf"""
    kindle = next((Path("/Volumes") / v for v in
                   [x.name for x in Path("/Volumes").iterdir()] if "kindle" in v.lower()), None)
    if kindle:
        target = kindle / "documents"
        if target.exists():
            for f in files:
                if f.suffix == ".mobi":
                    shutil.copy2(f, target / f.name)
                    print(f"  📲 已拷入 Kindle：{target / f.name}")
                    return
    for f in files:
        if f.suffix in (".epub", ".pdf"):
            try:
                subprocess.run(["open", "-a", "Books", str(f)], check=True)
                print(f"  📚 已导入图书 App：{f.name}")
            except Exception:
                print(f"  💡 手动打开：{f}")
            return


def peos_create_task(title: str, author: str, area: str) -> bool:
    """在 PEOS 目标进度里创建本周读书任务"""
    body = json.dumps({"kind": "book", "title": f"[{area}] {title} · {author}",
                       "total": 1, "current": 0}).encode()
    req = urllib.request.Request(f"{PEOS}/api/progress", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            ok = json.loads(r.read()).get("ok", False)
        print(f"{'✅' if ok else '✗'} PEOS 读书任务：[{area}] {title}")
        return ok
    except Exception as e:
        print(f"✗ PEOS 不可达（{e}）——任务没建，手动去 06 长期页加")
        return False


def weekly():
    pool = json.loads(POOL_PATH.read_text(encoding="utf-8"))
    iso_week = dt.date.today().isocalendar()[1]
    book = pool[iso_week % len(pool)]
    print(f"🗓 第 {iso_week} 周 · 本周方向【{book['area']}】")
    print(f"   📖 {book['title']} — {book['author']}")

    # 上周读完没
    try:
        with urllib.request.urlopen(f"{PEOS}/api/progress", timeout=10) as r:
            items = json.loads(r.read()).get("items", [])
        unread = [x for x in items if x.get("kind") == "book" and x.get("current", 0) < x.get("total", 1)]
        if len(unread) > 1:
            print(f"   ⚠️ 有 {len(unread)} 本没读完的：{'、'.join(x['title'] for x in unread[:3])}")
    except Exception:
        pass

    peos_create_task(book["title"], book["author"], book["area"])

    if book.get("source") == "auto" and (book.get("gutenberg_id") or book.get("query")):
        fetch_and_download(book.get("query", ""), book["title"], book.get("gutenberg_id"))
    else:
        print(f"   💡 非公版书，需手动获取：{book.get('hint', '深圳图书馆App / 微信读书')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?", help="书名/作者关键词")
    ap.add_argument("--weekly", action="store_true", help="每周任务：选书+建任务+下载")
    ap.add_argument("--list", action="store_true", help="查看书池")
    args = ap.parse_args()

    if args.weekly:
        weekly()
    elif args.list:
        pool = json.loads(POOL_PATH.read_text(encoding="utf-8"))
        for i, b in enumerate(pool):
            mark = "🤖" if b["source"] == "auto" else "✋"
            print(f"{i}. [{b['area']}] {b['title']} — {b['author']} {mark}")
    elif args.query:
        fetch_and_download(args.query)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
