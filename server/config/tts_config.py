import json
import os
from pathlib import Path

# Load voices configuration (following your personalities.json pattern)
VOICES_FILE = Path(__file__).parent / "voices.json"
try:
    with open(VOICES_FILE, 'r') as f:
        VOICES_DATA = json.load(f)
    ACTIVE_VOICE_ID = VOICES_DATA.get("active_voice", "L.A.U.R.A.")
    VOICE_SETTINGS = VOICES_DATA.get("voices", {}).get(ACTIVE_VOICE_ID, {})
except Exception as e:
    print(f"Error loading voices configuration: {e}")
    ACTIVE_VOICE_ID = "L.A.U.R.A."
    VOICE_SETTINGS = {"name": "L.A.U.R.A.", "model": "eleven_flash_v2_5"}

# Map to your existing personalities system
PERSONA_VOICE_MAPPING = {
    "laura": "L.A.U.R.A.",
    "max": "alfred"
}

def get_voice_for_persona(persona):
    return PERSONA_VOICE_MAPPING.get(persona, "L.A.U.R.A.")

# TTS Settings
ELEVENLABS_MODEL = VOICE_SETTINGS.get("model", "eleven_flash_v2_5")
VOICE_NAME = VOICE_SETTINGS.get("name", "L.A.U.R.A.")
AUDIO_CACHE_DIR = os.path.expanduser("~/LAURA/audio_cache")
os.makedirs(AUDIO_CACHE_DIR, exist_ok=True)

# Import API key securely (following your secret.py pattern)
try:
    from .secret import ELEVENLABS_API_KEY
except ImportError:
    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY not found in secret.py or environment variables")
