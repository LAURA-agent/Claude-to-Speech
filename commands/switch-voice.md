---
description: Switch between available TTS voices
argument-hint: <voice-key>
---

Switching TTS voice to: $ARGUMENTS

Available voices:
- LAURA (qEwI395unGwWV1dn3Y65)
- robo-LAURA (43WCRcu4Axd2KIaxt4M7) [default]
- Claude (uY96J30mUhYUIymmD5cu)

```bash
VOICE_KEY="$ARGUMENTS"

if [ -z "$VOICE_KEY" ]; then
  echo "Usage: /claude-to-speech:switch-voice <voice-key>"
  echo "Available: LAURA, robo-LAURA, Claude"
  exit 1
fi

# Update active_voice in voices.json
cd "${CLAUDE_PLUGIN_ROOT}/server/config"
TMP_FILE=$(mktemp)
python3 << EOF
import json
with open('voices.json', 'r') as f:
    config = json.load(f)
config['active_voice'] = '$VOICE_KEY'
with open('$TMP_FILE', 'w') as f:
    json.dump(config, f, indent=2)
EOF

mv "$TMP_FILE" voices.json

# Reload voice in running server
curl -X POST http://localhost:5001/reload_voice 2>/dev/null || echo "Server not running"

echo "Voice switched to: $VOICE_KEY"
```
