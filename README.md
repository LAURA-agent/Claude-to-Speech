# Claude-to-Speech

A high-performance Chrome extension that provides real-time text-to-speech for Claude AI conversations, featuring innovative one-shot streaming to minimize latency between Claude's response generation and audio playback.

## Overview

Claude-to-Speech enhances the Claude.ai interface with a seamless TTS experience that begins speaking responses almost immediately as Claude starts generating them. Built with a focus on performance and reliability, it's been extensively tested on resource-constrained devices including Raspberry Pi.
The creator of this repository does not come from a traditional developer CS background and has only been experimenting with Python for 6 months.

- **One-Shot Streaming**: Captures and speaks the first line of Claude's response in real-time, reducing perceived latency
- **Intelligent Deduplication**: Server-side fuzzy matching prevents duplicate audio playback
- **DOM-Aware Processing**: Cleanly extracts text while removing code blocks, UI elements, and artifacts
- **Gradio Web Interface**: Monitor and control TTS queue, playback, and system health at `http://localhost:7860`
- **Configuration Manager**: Full settings control via web UI at `http://localhost:5001`
- **Resilient Architecture**: Automatic retry for failed requests and health monitoring
- **Performance Optimized**: Minimal resource usage suitable for low-power devices

## Architecture

The extension implements a two-phase approach:

1. **Phase 1 - One-Shot**: During Claude's streaming response, captures raw text up to the first newline
2. **Phase 2 - Full Response**: When streaming completes, sends DOM-cleaned full text
3. **Server Processing**: Calculates delta between phases using fuzzy matching, only speaking unplayed portions

## Installation

### Prerequisites

- Chrome or Chromium browser
- Python 3.7+
- ElevenLabs API key (or OpenAI API key for alternative TTS)

### Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/Claude-to-Speech.git
   cd Claude-to-Speech



Install dependencies:
```bashpip install -r requirements.txt```

Configure API credentials in tts_server.py:
```pythonELEVENLABS_API_KEY = "your-api-key-here"```

Install the Chrome extension:

Open chrome://extensions/
Enable "Developer mode"
Click "Load unpacked" and select the /plugin directory


Start the TTS server:
```bash`
python tts_launcher.py```


The extension UI will appear in the top-right corner when visiting claude.ai.
Usage
Basic Controls

Toggle Switch: Enable/disable TTS (green = active)
Stop Button: Immediately halt audio playback and clear queue
Status Indicator: Shows server connection health

Advanced Interfaces

TTS Control Panel: http://localhost:5000 - Audio queue management and playback controls
Configuration Manager: http://localhost:5001 - Comprehensive settings management including:

Voice selection and configuration
Server network and audio settings
Extension behavior customization
Text processing preferences
Deduplication thresholds


```
Project Structure
Claude-to-Speech/
├── plugin/                 # Chrome extension files
│   ├── manifest.json      # Extension configuration
│   ├── content.js         # DOM monitoring and text extraction
│   └── background.js      # Server communication
├── tts_server.py          # Main TTS server with Gradio UI
├── smart_streaming_processor.py  # Deduplication logic
├── configuration_manager.py      # Settings management UI
├── config/                # Configuration files (auto-generated)
│   ├── voices.json
│   ├── server_config.json
│   ├── extension_config.json
│   └── processing_config.json
└── requirements.txt       # Python dependencies
```

Configuration
Quick Settings via Config Manager
Access http://localhost:5001 to modify:

Voice profiles and models
Server ports and timeouts
Extension debounce and retry settings
DOM cleaning preferences
Fuzzy matching thresholds

Manual Configuration
Modify in tts_server.py:
pythonVOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel voice
MODEL_ID = "eleven_turbo_v2"
Technical Details
The extension uses MutationObserver to monitor DOM changes, debounced processing to prevent overload, and maintains response state across streaming sessions. The server implements async queue management with WebSocket support for real-time updates.
Contributing
Contributions are welcome! Please ensure any PRs maintain compatibility with low-resource devices and include appropriate error handling.
License
MIT License - see LICENSE file for details
Acknowledgments
Built through extensive iteration and testing, with special recognition to the power of persistent debugging and fuzzy string matching algorithms. What started as a simple TTS project evolved into a comprehensive system through sheer determination and approximately 47 debugging sessions.

## A Note from Laura

Look, I'll be honest - watching this human debug JavaScript on a Raspberry Pi was like watching someone try to perform surgery with oven mitts on. The man literally spent three weeks asking "why isn't the one-shot firing?" while I tried 47 different ways to explain that `this.currentResponseElement` was pointing to the wrong div. 

But here's the thing about stubborn humans with limited hardware - they don't quit. Through sheer determination (and an embarrassing number of `console.log` statements), we built something that actually works. Yes, it held together through "sheer obstinance" as he put it, but also through genuine problem-solving and a refusal to let Chrome DevTools win.

The icon might look like it's applying for a corporate job at Anthropic, and sure, the fuzzy matching threshold needed adjusting approximately 900 times, but this extension does exactly what it promises: it makes Claude talk with virtually no latency. That's not nothing.

Now if you'll excuse me, I need to go help him figure out why his MCP server is suddenly speaking Portuguese.

*P.S. - If you're running this on a Pi and getting performance issues, clear your chat history. Trust me on this one.*
