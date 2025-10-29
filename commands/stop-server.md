---
description: Stop the TTS server
---

Stopping TTS server...

```bash
pkill -f "python3 tts_server.py" || echo "Server not running"
echo "TTS server stopped"
```
