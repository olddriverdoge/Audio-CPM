#!/usr/bin/env bash
# 打包前自检：编译 + 服务 + 端口一致性 + 前端回归
set -u
cd "$(dirname "$0")/.." || exit 1

echo "== 1/4 py_compile =="
python3 -m py_compile ac_web.py backend/*.py backend/routers/*.py backend/storage/*.py packaging/p4a/main.py || exit 1
echo "OK"

echo "== 2/4 service (需已在 8000 端口起服务) =="
curl -s -o /dev/null -w 'root=%{http_code}\n' http://127.0.0.1:8000/ || true
curl -s -o /dev/null -w 'roots=%{http_code}\n' http://127.0.0.1:8000/api/roots || true
curl -s -o /dev/null -w 'presets=%{http_code}\n' http://127.0.0.1:8000/api/presets || true

echo "== 3/4 端口一致性 =="
grep -E '^port = ' packaging/p4a/buildozer.spec || true
grep -n 'AC2_PORT' packaging/p4a/main.py | head -1 || true

echo "== 4/4 前端回归 =="
bash packaging/tests/run.sh
