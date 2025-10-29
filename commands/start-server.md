---
description: Start the TTS server in the background
---

Starting TTS server on port 5001...

```bash
cd "${CLAUDE_PLUGIN_ROOT}/server"
source ../venv/bin/activate
nohup python3 tts_server.py > "${CLAUDE_PLUGIN_ROOT}/tts_server.log" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "${CLAUDE_PLUGIN_ROOT}/tts_server.pid"
sleep 1
if kill -0 $SERVER_PID 2>/dev/null; then
  echo "TTS server started on http://localhost:5001 (PID: $SERVER_PID)"
else
  echo "Failed to start TTS server. Check ${CLAUDE_PLUGIN_ROOT}/tts_server.log"
fi
```
