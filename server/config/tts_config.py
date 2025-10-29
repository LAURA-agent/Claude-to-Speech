import os
import json
from pathlib import Path

# Load voices configuration
VOICES_FILE = Path(__file__).parent / "voices.json"
try:
    with open(VOICES_FILE, 'r') as f:
        VOICES_DATA = json.load(f)
    ACTIVE_VOICE = VOICES_DATA.get("active_voice", "L.A.U.R.A.")
except Exception as e:
    print(f"Error loading voices: {e}")
    ACTIVE_VOICE = "L.A.U.R.A."
    VOICES_DATA = {}

# Import API key securely
try:
    from .secret import ELEVENLABS_API_KEY
except ImportError:
    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY required in secret.py or environment")
