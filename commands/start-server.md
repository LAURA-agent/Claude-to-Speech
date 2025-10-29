---
description: Start the TTS server in the background
---

Starting TTS server on port 5001...

```bash
cd "${CLAUDE_PLUGIN_ROOT}/server"
source ../venv/bin/activate
python3 tts_server.py &
echo "TTS server started on http://localhost:5001"
```
