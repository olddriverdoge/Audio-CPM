#!/usr/bin/env bash
# 在 Termux（或 PC 上跑起服务后）执行：全部回归（需服务在 127.0.0.1:8000）
set -u
cd "$(dirname "$0")"

# jsdom 依赖：优先用本目录 node_modules；否则软链到 AC2_TEST_NODE_MODULES 或 $TMPDIR/ac2js/node_modules
if [ ! -e node_modules ]; then
  mod="${AC2_TEST_NODE_MODULES:-$TMPDIR/ac2js/node_modules}"
  if [ -d "$mod" ]; then
    ln -s "$mod" node_modules
  else
    echo "缺少 jsdom：在本目录执行  npm i  （或设置 AC2_TEST_NODE_MODULES 指向已有 node_modules）"
    exit 1
  fi
fi

pass=0; fail=0
for t in smoke2 organize2 playtest unifytest spectrumtest spectrummode_test \
         metaorder_test marquee delete_test uicfg tasks_ui_test convert_ui_test; do
  printf '%-22s ' "$t.mjs"
  out=$(node "$t.mjs" 2>&1 | grep -E '^RESULT:' | tail -1)
  echo "$out"
  case "$out" in *PASS*) pass=$((pass+1));; *) fail=$((fail+1));; esac
done
echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
# 其他按需单独跑（也可在 run.sh 里追加）：
#   davpath_test.mjs / saveflow_test.mjs / tabssync_test.mjs  —— 数据源切换与路径记忆
# sources_test.mjs 需要本地 wsgidav（WebDAV 端到端），单独跑：
#   wsgidav --host 127.0.0.1 --port 8099 --root "$TMPDIR/davroot" --server wsgiref --auth anonymous &
#   node sources_test.mjs
