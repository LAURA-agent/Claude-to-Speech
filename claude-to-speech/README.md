# Claude-to-Speech

Voice-first interaction mode for Claude Code with automatic text-to-speech via ElevenLabs.

## Overview

Claude-to-Speech is a plugin that enables automatic voice output for Claude Code responses. Instead of manually triggering TTS, Claude includes invisible markers in responses that are automatically extracted and spoken by a Stop hook.

## Features

- **Automatic TTS**: Claude's responses are spoken automatically via TTS markers
- **Smart Defaults**: Silent for code dumps, vocal for questions and confirmations
- **Multiple Voice Options**: Choose from ElevenLabs voices or use custom voice IDs
- **Dual Mode Support**:
  - Direct ElevenLabs API (no server required)
  - Local TTS server integration
- **Deduplication**: Prevents repeated messages within 2-second window
- **Cross-Platform**: Works on macOS, Linux (including Raspberry Pi), and Windows

## Installation

### Prerequisites

- Claude Code 2.0+
- ElevenLabs API key ([get one here](https://elevenlabs.io))
- Python 3.7+
- `requests` library: `pip install requests`
- (Optional) `python-dotenv`: `pip install python-dotenv`

### Via Claude Code Plugin System

1. Clone or download this repository
2. Add to your Claude Code plugins directory:
   ```bash
   mkdir -p ~/.claude/plugins/repos
   cd ~/.claude/plugins/repos
   git clone https://github.com/yourusername/claude-to-speech.git
   ```
3. Install the plugin:
   ```bash
   claude plugin install ./claude-to-speech
   ```
4. Configure your `.env` file (see Configuration below)
5. Restart Claude Code

### Manual Installation

1. Copy the plugin directory to your Claude Code plugins location
2. Create a `.env` file based on `.env.example`
3. Add your ElevenLabs API key
4. Run `/plugin` in Claude Code to refresh
5. Restart Claude Code

## Configuration

Create a `.env` file in the plugin root directory:

```bash
# REQUIRED: ElevenLabs API Key
ELEVENLABS_API_KEY=your_api_key_here

# Voice ID (optional - defaults to Claude voice)
# Available names: laura, claude, rachel, domi, bella, antoni, arnold, adam, josh
# Or use a raw ElevenLabs voice ID
CLAUDE_VOICE_ID=claude

# ElevenLabs Model (optional - defaults to eleven_flash_v2_5)
# Options: eleven_flash_v2_5 (fastest), eleven_turbo_v2, eleven_multilingual_v2
ELEVENLABS_MODEL=eleven_flash_v2_5

# TTS Server URL (optional - leave empty for direct API mode)
# If you have a local TTS server, specify it here
TTS_SERVER_URL=

# Debug mode (optional - set to 1 to enable debug logging)
DEBUG=0
```

### Voice Options

The plugin includes these pre-configured voices:

- `claude` / `assistant` - British male voice (default)
- `laura` - American female voice
- `rachel` - Calm female
- `domi` - Confident female
- `bella` - Soft female
- `antoni` - Well-rounded male
- `arnold` - Strong male
- `adam` - Deep male
- `josh` - Young male

You can also use any ElevenLabs voice ID directly.

### TTS Server Mode vs Direct API Mode

The plugin supports two operational modes:

#### Direct API Mode (Default)
**When to use:** Simple setup, single-user, occasional TTS use

- Calls ElevenLabs API directly from the plugin
- No additional server setup required
- Each TTS request goes through the internet to ElevenLabs
- Best for: Getting started, testing, low-volume usage

**Configuration:**
```bash
TTS_SERVER_URL=  # Leave empty
```

#### Local TTS Server Mode (Recommended for Power Users)
**When to use:** Multi-device setup, high-volume usage, local network integration

- Runs a persistent TTS server on your local network
- Multiple devices can share the same server (desktop, mobile, Raspberry Pi)
- Audio caching reduces API calls and speeds up repeated phrases
- Centralized voice configuration across all clients
- Lower latency for local playback
- Enables offline caching for frequently used phrases
- Best for: LAURA-style multi-device AI systems, development, production use

**Configuration:**
```bash
TTS_SERVER_URL=http://localhost:5001/tts  # Or your server IP
```

**Setting up a TTS server:**

The plugin includes `scripts/tts_server.py` - a Flask-based TTS server:

```bash
# Install dependencies
pip install flask requests

# Run the server
cd scripts
python3 tts_server.py
```

The server listens on `http://0.0.0.0:5001` by default. Point multiple Claude Code instances, mobile apps, or other devices to this server for centralized TTS.

**Benefits for LAURA-style systems:**
- **Consistency:** Same voice across desktop, mobile, and embedded devices
- **Efficiency:** Cached audio for common responses ("I don't understand", "Working on it", etc.)
- **Scalability:** One API key serves multiple devices
- **Control:** Centralized voice/model switching without reconfiguring clients

## Usage

### Enable Voice Mode

Run the `/claude-to-speech:speak` command (or `/speak` for short):

```
/speak
```

This activates voice-first mode where Claude will include TTS markers in responses.

### How It Works

1. **You enable voice mode** with `/speak`
2. **Claude includes markers** in responses:
   ```html
   <!-- TTS: "This will be spoken aloud" -->
   ```
3. **Stop hook automatically extracts** the marker from Claude's response
4. **TTS is triggered** via ElevenLabs API or your local server
5. **Audio plays** through your system's default audio output

### TTS Marker Protocol

Claude uses three marker patterns:

#### Active Speech (for important updates)
```html
<!-- TTS: "Task completed successfully" -->
```
Used for: Questions, confirmations, warnings, status updates

#### Explicit Silence (for code-heavy content)
```html
<!-- TTS: SILENT -->
```
Used for: Code dumps, long explanations, documentation

#### No Marker (defaults to silent)
When Claude omits the marker, no TTS is triggered.

### Example Interaction

```
You: Fix the authentication bug

Claude: I found the null pointer exception in `auth_handler.py` line 47.
The user object wasn't being checked before accessing properties.
Here's the fix:

[code block]

<!-- TTS: "Found the bug in the auth handler. It's a missing null check on line 47." -->
```

You hear: *"Found the bug in the auth handler. It's a missing null check on line 47."*

## Architecture

### Components

- **`/commands/speak.md`** - Slash command that enables voice-first mode
- **`/hooks/stop.sh`** - Stop hook that extracts TTS markers from responses
- **`/scripts/claude_speak.py`** - TTS interface script for ElevenLabs
- **`.env`** - Configuration file (user-created, not tracked in git)

### How the Stop Hook Works

1. Hook receives JSON input with `transcript_path`
2. Reads the last message from the Claude Code transcript file
3. Extracts the `message.content[0].text` field (Claude's response)
4. Uses regex to find `<!-- TTS: "..." -->` markers (handles escaped HTML)
5. Calls `claude_speak.py` with the extracted text
6. Audio is played via system audio player

### Audio Playback

The plugin uses platform-specific audio players:
- **macOS**: `afplay`
- **Linux**: `mpg123`, `mpg321`, `play`, or `aplay` (auto-detects)
- **Windows**: `winsound`

## Troubleshooting

### No audio is playing

1. Check if the Stop hook is enabled:
   ```bash
   cat /tmp/claude_stop_hook.log
   ```
   If the file doesn't exist, the hook isn't firing.

2. Enable debug mode in `.env`:
   ```bash
   DEBUG=1
   ```
   Restart Claude Code and check the log file.

3. Test the TTS script directly:
   ```bash
   python3 scripts/claude_speak.py --conversation "Test message"
   ```

### TTS is too slow

Use the faster model in `.env`:
```bash
ELEVENLABS_MODEL=eleven_flash_v2_5
```

### Audio cuts off mid-sentence

Increase timeout in `claude_speak.py` (default is 10 seconds):
```python
DEFAULT_TIMEOUT = 15.0
```

### Duplicate messages

The plugin has built-in deduplication (2-second window). If you need to bypass:
```bash
python3 scripts/claude_speak.py --bypass-dedup "Your message"
```

### Hook isn't extracting markers

The hook handles both escaped (`<\!--`) and unescaped (`<!--`) HTML comments. If markers still aren't extracted, check the debug log:

```bash
tail -50 /tmp/claude_stop_hook.log
```

## Development

### File Structure

```
claude-to-speech/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/
│   └── speak.md             # /speak slash command
├── hooks/
│   ├── hooks.json           # Hook registration
│   └── stop.sh              # Stop hook script
├── scripts/
│   └── claude_speak.py      # TTS interface
├── .env.example             # Example configuration
├── .gitignore               # Excludes .env from git
└── README.md                # This file
```

### Testing Changes

After modifying files:
1. Run `/plugin` in Claude Code to update
2. Restart Claude Code completely
3. Test with a simple interaction

### Adding New Voices

Edit `claude_speak.py` and add to `VOICE_MAPPINGS`:

```python
VOICE_MAPPINGS = {
    "your_voice_name": "elevenlabs_voice_id_here",
    # ...
}
```

## License

MIT

## Credits

Built for the LAURA AI project. Inspired by the vision of voice-first AI interaction and accessibility.

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

For bugs or feature requests, open an issue on GitHub.
