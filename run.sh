#!/data/data/com.termux/files/usr/bin/bash
# AC2 Web 服务管理：start | stop | restart | status [--port N]
# 要点：setsid 脱离会话（Termux 窗口关闭/回收时不死）、TMPDIR 兜底、精确杀旧进程避免端口占用。
set -u
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
cd "$(dirname "$0")" || exit 1
PIDFILE=ac_web.pid
LOG=ac_web.log
PORT=8000

pid() { [ -f "$PIDFILE" ] && cat "$PIDFILE" 2>/dev/null; }
alive() { p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

stop() {
  p=$(pid)
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    kill "$p" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$p" 2>/dev/null
  fi
  # 清掉漏网实例（精确匹配命令行，避免误杀当前 shell）
  for q in $(ps -A -o pid,args 2>/dev/null | awk '$2=="python3" && $3=="ac_web.py" {print $1}'); do
    kill "$q" 2>/dev/null
  done
  rm -f "$PIDFILE"
}

start() {
  if alive; then echo "已在运行: pid $(pid)"; return 0; fi
  stop >/dev/null 2>&1
  setsid nohup python3 ac_web.py --port "$PORT" "$@" > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  sleep 2
  if alive && curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
    echo "已启动: pid $(pid)  http://127.0.0.1:$PORT"
  else
    echo "启动失败，日志尾部："; tail -n 20 "$LOG"; return 1
  fi
}

case "${1:-}" in
  start) shift; start "$@" ;;
  stop) stop; echo "已停止" ;;
  restart) shift; stop; start "$@" ;;
  status) if alive; then echo "running pid $(pid)"; else echo "not running"; fi ;;
  *) echo "用法: $0 {start|stop|restart|status} [--port N]"; exit 1 ;;
esac
