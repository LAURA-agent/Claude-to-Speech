---
description: Stop the TTS server
---

Stopping TTS server...

```bash
PID_FILE="${CLAUDE_PLUGIN_ROOT}/tts_server.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 $PID 2>/dev/null; then
    kill $PID
    rm "$PID_FILE"
    echo "TTS server stopped (PID: $PID)"
  else
    rm "$PID_FILE"
    echo "Server not running (stale PID file removed)"
  fi
else
  pkill -f "python3 tts_server.py" && echo "TTS server stopped" || echo "Server not running"
fi
```
