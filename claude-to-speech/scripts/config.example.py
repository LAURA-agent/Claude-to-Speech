"""
Configuration for Claude-to-Speech TTS System

SETUP INSTRUCTIONS:
1. Copy this file to 'config.py' in the same directory
2. Add your ElevenLabs API key below
3. (Optional) Customize voice ID and server URL

Get your API key:
- Sign up at https://elevenlabs.io
- Go to Profile → API Keys
- Generate a new key and paste it below
"""

# REQUIRED: Your ElevenLabs API key
ELEVENLABS_API_KEY = "your_elevenlabs_api_key_here"

# OPTIONAL: Voice configuration
# Default is Claude Code voice (British male)
# Find more voices at https://elevenlabs.io/voice-library
VOICE_ID = "uY96J30mUhYUIymmD5cu"

# OPTIONAL: TTS server URL
# If you're running a local TTS server, specify the URL here
# Default expects server on localhost:5000
SERVER_URL = "http://localhost:5000/tts"

# Alternative voice options (uncomment to use):
# VOICE_ID = "qEwI395unGwWV1dn3Y65"  # Bubbly female voice (LAURA)
# VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel (calm female)
# VOICE_ID = "AZnzlk1XvdvUeBnXmlld"  # Domi (confident female)
