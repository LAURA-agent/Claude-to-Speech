# Claude-to-Speech Installation Guide

Complete self-contained TTS system for Claude Code. One git clone, one API key, done.

## Quick Start (2 Minutes)

### 1. Clone the Repository

```bash
git clone https://github.com/LAURA-agent/Claude-to-Speech.git
cd Claude-to-Speech
```

### 2. Run Setup Script

```bash
./setup.sh
```

The script will:
- Install Python dependencies
- Prompt for your ElevenLabs API key
- Configure all necessary files
- Make hooks executable

**Get an API key:** https://elevenlabs.io → Profile → API Keys

### 3. Start the TTS Server

```bash
cd ../..  # Back to claude-to-speech root
python3 server/tts_server.py
```

You should see:
```
✅ Loaded from tts_config: Voice=43WCRcu4Axd2KIaxt4M7, Model=eleven_flash_v2_5
🎵 Pygame audio mixer initialized successfully!
Starting Claude-to-Speech TTS Server on http://0.0.0.0:5001
```

### 5. Install Plugin in Claude Code

**Option A: Symlink (recommended for development)**
```bash
ln -s /full/path/to/claude-to-speech ~/.claude/plugins/claude-to-speech
```

**Option B: Copy to plugins directory**
```bash
cp -r /full/path/to/claude-to-speech ~/.claude/plugins/
```

Make hooks executable:
```bash
chmod +x hooks/stop.sh
```

### 6. Restart Claude Code

```bash
# Exit Claude Code completely
/exit

# Start again
claude
```

### 7. Enable Voice Mode

```
/speak
```

Done! Claude will now speak responses automatically.

---

## What's Included

```
claude-to-speech/
├── server/                    # TTS Server (runs on port 5001)
│   ├── tts_server.py         # Main server
│   ├── audio_manager_plugin.py  # Audio playback
│   ├── smart_streaming_processor.py  # Text processing
│   └── config/
│       ├── voices.json       # Voice definitions
│       ├── tts_config.py     # Config loader
│       └── secret.example.py # API key template
├── scripts/                   # Plugin scripts
│   ├── claude_speak.py       # TTS interface
│   └── config.py             # Plugin config
├── commands/
│   └── speak.md              # /speak command
├── hooks/
│   ├── hooks.json            # Hook registration
│   └── stop.sh               # Stop hook (extracts TTS markers)
├── requirements.txt          # All dependencies
└── INSTALL.md                # This file
```

---

## Testing

### Test Server

```bash
curl http://localhost:5001/health
```

Should return:
```json
{
  "status": "ok",
  "server": "Claude-to-Speech TTS Server",
  "audio_manager": "ready"
}
```

### Test TTS

```bash
curl -X POST http://localhost:5001/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from the server"}'
```

Should hear audio.

### Test Plugin

```bash
cd scripts
python3 claude_speak.py "Hello from the plugin"
```

Should hear audio.

### Test End-to-End

In Claude Code:
```
/speak
```

Then ask Claude a question. Should hear the response.

---

## Configuration

### Change Voice

Edit `server/config/voices.json`:

```json
{
  "active_voice": "LAURA",
  "voices": {
    "LAURA": {
      "name": "qEwI395unGwWV1dn3Y65",
      "model": "eleven_flash_v2_5",
      "persona": "laura"
    }
  }
}
```

Reload without restarting:
```bash
curl -X POST http://localhost:5001/reload_voice
```

### Add Custom Voice

1. Get voice ID from https://elevenlabs.io/voice-library
2. Add to `voices.json`:
```json
{
  "active_voice": "my-voice",
  "voices": {
    "my-voice": {
      "name": "your_voice_id_here",
      "model": "eleven_flash_v2_5",
      "persona": "custom"
    }
  }
}
```
3. Reload: `curl -X POST http://localhost:5001/reload_voice`

### Network Access

The server listens on `0.0.0.0:5001` by default, making it accessible from other devices.

**Find your server IP:**
```bash
ifconfig | grep "inet "  # macOS/Linux
ipconfig                  # Windows
```

**Connect from another device:**

Edit `scripts/config.py` on the client:
```python
SERVER_URL = "http://192.168.1.100:5001/tts"  # Your server IP
```

---

## Running as a Service

### Linux/Raspberry Pi (systemd)

Create `/etc/systemd/system/claude-tts.service`:

```ini
[Unit]
Description=Claude TTS Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/claude-to-speech/server
ExecStart=/usr/bin/python3 /home/pi/claude-to-speech/server/tts_server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-tts
sudo systemctl start claude-tts
sudo systemctl status claude-tts
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.claude.tts.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.tts</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/full/path/to/claude-to-speech/server/tts_server.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/full/path/to/claude-to-speech/server</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load:
```bash
launchctl load ~/Library/LaunchAgents/com.claude.tts.plist
```

---

## Troubleshooting

### Server won't start

**Error: `Port 5001 already in use`**
```bash
lsof -i :5001
kill -9 <PID>
```

**Error: `ELEVENLABS_API_KEY must be set`**
- Check `server/config/secret.py` exists
- Verify API key is correct

**Error: `No module named 'quart'`**
```bash
pip install -r requirements.txt
```

### No audio output

**Check pygame:**
```bash
python3 -c "import pygame; pygame.mixer.init(); print('OK')"
```

**Check system audio:**
- Verify volume is up
- Check default audio output device

**Check server logs:**
```bash
tail -f server/tts_server.log
```

### Plugin not working

**Check server is running:**
```bash
curl http://localhost:5001/health
```

**Check hook is firing:**
```bash
tail -f /tmp/claude_stop_hook.log
```

**Check hook is executable:**
```bash
chmod +x hooks/stop.sh
```

**Verify plugin config:**
```bash
cat scripts/config.py
```

Should have:
```python
SERVER_URL = "http://localhost:5001/tts"
```

---

## Platform-Specific Notes

### Raspberry Pi

**Install system dependencies:**
```bash
sudo apt update
sudo apt install python3-pip mpg123 portaudio19-dev
```

**For headless setup (no audio output):**
The server will still generate audio files even without speakers. You can:
- Use remote audio (send to another device)
- Use a Bluetooth speaker
- Use HDMI audio

### macOS

Audio playback uses `afplay` (built-in).

### Windows

Requires Python 3.7+ from python.org. Audio uses `winsound` (built-in).

### Linux Desktop

Install audio player:
```bash
sudo apt install mpg123  # or sox
```

---

## Updating

```bash
git pull
pip install -r requirements.txt --upgrade
# Restart server
```

---

## Support

**Check logs:**
- Server: `server/tts_server.log`
- Plugin hook: `/tmp/claude_stop_hook.log`

**Common issues:**
- Wrong API key → Check `server/config/secret.py`
- Port in use → Kill existing server
- No audio → Check pygame and system audio
- Plugin not firing → Restart Claude Code, check hooks

---

## License

MIT

---

## Credits

Built for the LAURA AI project by Carson.
