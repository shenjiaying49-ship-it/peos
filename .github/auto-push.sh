#!/bin/bash
# PEOS 每日自动推送脚本
# 优先用 git push，若 github.com 不通则回落至 gh api
set -e

cd "$(dirname "$0")/.."

# 检查是否有变更
if git diff --quiet && git diff --cached --quiet; then
  TODAY_CHANGED=$(git diff --stat HEAD~1..HEAD 2>/dev/null | wc -l)
  if [ "$TODAY_CHANGED" -gt 0 ]; then
    echo "[$(date)] No new changes since last commit"
    exit 0
  fi
fi

# 提交
git add -A
if git diff --cached --quiet; then
  echo "[$(date)] Nothing to commit"
  exit 0
fi
git commit -m "📅 每日自动更新 $(date +%Y-%m-%d)"

# 尝试 git push（需要 github.com 可达）
if curl -s -o /dev/null --connect-timeout 5 https://api.github.com 2>/dev/null; then
  if git push origin main 2>/dev/null; then
    echo "[$(date)] git push 成功"
    exit 0
  fi
  echo "[$(date)] git push 失败，尝试 gh api 方式..."

  # 回落：通过 gh api 推送
  OWNER="shenjiaying49-ship-it"
  REPO="peos"
  HEAD_SHA=$(git rev-parse HEAD)
  PARENT_SHA=$(git rev-parse HEAD~1 2>/dev/null || echo "")

  # 获取 base tree
  if [ -n "$PARENT_SHA" ]; then
    PARENT_INFO=$(gh api "/repos/$OWNER/$REPO/git/commits/$PARENT_SHA" 2>/dev/null) || true
  fi

  # 直接用本地 HEAD tree
  TREE_SHA=$(git cat-file -p "$HEAD_SHA" | head -1 | cut -d' ' -f2)

  # 更新远程 ref
  gh api --method PATCH "/repos/$OWNER/$REPO/git/refs/heads/main" \
    -f "sha=$HEAD_SHA" --force=true >/dev/null 2>&1 \
    && echo "[$(date)] gh api 推送成功" || echo "[$(date)] gh api 推送失败"
else
  echo "[$(date)] GitHub API 不可达，跳过推送"
fi
