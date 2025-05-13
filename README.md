# Claude-to-Speech

A Chrome extension that converts Claude AI's text responses to speech using ElevenLabs' text-to-speech API.

## Overview

Claude-to-Speech adds a floating control panel to Claude's web interface, allowing you to:

- Detect Claude's responses automatically
- Convert responses to speech with a single click
- Enable "Conversation Mode" to automatically speak Claude's responses
- Process responses in real-time with streaming support

## Features

- **Response Detection**: Automatically identifies Claude's responses in the DOM
- **Text Processing**: Strips code blocks and UI elements from responses
- **Streaming TTS**: Can process responses in chunks as Claude generates them
- **Conversation Mode**: Automatically converts responses to speech
- **ElevenLabs Integration**: Uses ElevenLabs' high-quality voices

## Installation

### Prerequisites

- Chrome/Chromium browser
- Python 3.7+ with pip
- An ElevenLabs API key

### Setup

1. Clone this repository:
   ```
   git clone https://github.com/LAURA-agent/Claude-to-Speech.git
   cd Claude-to-Speech
   ```

2. Install the Python requirements:
   ```
   pip install elevenlabs quart quart-cors
   ```

3. Update ElevenLabs API key:
   - Open `claude_tts_bridge.py` or `tts_server.py`
   - Replace the placeholder API key with your own

4. Install the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `/plugin` directory within this repository

5. Run the TTS server:
   ```
   python tts_server.py
   ```

## Usage

1. Visit Claude at https://claude.ai
2. You'll see a floating control panel in the bottom right
3. After Claude responds, click "Detect Claude Response"
4. Click "Voice with ElevenLabs" to hear the response
5. Toggle "Conversation Mode" to automatically speak all responses

## How it Works

The extension uses a combination of JavaScript and Python:

1. The Chrome extension injects content scripts into Claude's web interface
2. These scripts detect Claude's responses using DOM selectors
3. The background script sends text to a local TTS server
4. The TTS server generates audio using ElevenLabs API
5. Audio is played through your computer's speakers

## Files and Structure

- **Chrome Extension** (in the `/plugin` directory):
  - `manifest.json`: Extension configuration
  - `content.js`: Injected into Claude pages, handles response detection
  - `background.js`: Communicates with the TTS server
  - `icons/`: Extension icons

- **TTS Server**:
  - `tts_server.py`: Local server that handles TTS requests
  - `claude_tts_bridge.py`: Alternative messaging bridge
  - `run_bridge.sh`: Helper script for the bridge

## Configuration

You can customize several aspects of the extension:

- Voice selection (in `tts_server.py` or `claude_tts_bridge.py`)
- TTS model selection
- Audio caching behavior

## Troubleshooting

- **No audio playing**: Ensure the TTS server is running
- **Response detection issues**: Use the "Debug Response Detection" button
- **Page refresh required**: Reload the Claude page if the extension doesn't appear

## License

[MIT License](LICENSE)

## Acknowledgments

- ElevenLabs for their TTS API
- Anthropic for Claude AI
- LAURA for inspiration and guidance