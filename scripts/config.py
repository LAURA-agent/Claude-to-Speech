"""
Configuration for Claude-to-Speech Plugin

This is the actual config file used by the plugin.
Copy config.example.py if you need to reset these values.
"""

# REQUIRED: Your ElevenLabs API key
ELEVENLABS_API_KEY = "sk_71deb8ef98e4c08b3cfc8911970e381472a67099a184681f"

# Voice ID - can be a name (laura, claude, etc.) or raw ElevenLabs voice ID
# The claude_speak.py script will resolve names to IDs automatically
VOICE_ID = "robo-LAURA"  # Maps to voice ID: 43WCRcu4Axd2KIaxt4M7

# ElevenLabs Model
# Options: eleven_flash_v2_5 (fastest), eleven_turbo_v2, eleven_multilingual_v2
ELEVENLABS_MODEL = "eleven_flash_v2_5"

# TTS Server URL (optional)
# If you're running the local TTS server, set this to the server URL
# Example: "http://localhost:5001/tts"
# Leave empty to use direct ElevenLabs API mode
SERVER_URL = "http://localhost:5001/tts"

# Voice mappings (extended in claude_speak.py)
# You can add custom voices here:
CUSTOM_VOICES = {
    "robo-LAURA": "43WCRcu4Axd2KIaxt4M7",
}
