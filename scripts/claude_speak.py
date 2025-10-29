#!/usr/bin/env python3
"""
Claude-to-Speech - Standalone TTS for Claude Code
Adapted from LAURA project for portable voice-first interaction
"""

import requests
import json
import re
import os
import sys
import time
import hashlib
import subprocess
import tempfile
from typing import Optional, Tuple, Dict
from pathlib import Path

# Load .env file from plugin root directory if it exists
try:
    from dotenv import load_dotenv
    plugin_root = Path(__file__).parent.parent
    env_file = plugin_root / '.env'
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    # python-dotenv not installed, will use system environment variables
    pass

# Voice mappings for easy selection
VOICE_MAPPINGS = {
    # Primary personas
    "laura": "qEwI395unGwWV1dn3Y65",
    "claude": "uY96J30mUhYUIymmD5cu",
    "alfred": "uY96J30mUhYUIymmD5cu",  # Claude's voice (British butler style)

    # Common ElevenLabs voices (add your own here)
    "rachel": "21m00Tcm4TlvDq8ikWAM",  # Calm female
    "domi": "AZnzlk1XvdvUeBnXmlld",     # Confident female
    "bella": "EXAVITQu4vr4xnSDxMaL",    # Soft female
    "antoni": "ErXwobaYiN019PkySvjV",   # Well-rounded male
    "arnold": "VR6AewLTigWG4xSOukaG",   # Strong male
    "adam": "pNInz6obpgDQGcFmaJgB",     # Deep male
    "josh": "TxGEqnHWrfWFTfGW9XjX",     # Young male

    # Aliases for convenience
    "default": "uY96J30mUhYUIymmD5cu",
    "assistant": "uY96J30mUhYUIymmD5cu",
    "british": "uY96J30mUhYUIymmD5cu",
    "american": "qEwI395unGwWV1dn3Y65",
}

def get_voice_id(voice_input: str) -> str:
    """
    Get voice ID from input - supports names, IDs, or defaults
    Returns a valid voice ID or falls back to default
    """
    if not voice_input:
        # Try environment variable first
        env_voice = os.environ.get('CLAUDE_VOICE_ID', '')
        if env_voice:
            return get_voice_id(env_voice)  # Recursive to handle names
        return VOICE_MAPPINGS["default"]

    # Clean input
    voice_input = voice_input.lower().strip()

    # Check if it's a known mapping
    if voice_input in VOICE_MAPPINGS:
        return VOICE_MAPPINGS[voice_input]

    # Check if it looks like a voice ID (20+ alphanumeric chars)
    if len(voice_input) >= 20 and voice_input.replace("_", "").isalnum():
        return voice_input  # Assume it's a raw voice ID

    # Try partial matching
    for name, voice_id in VOICE_MAPPINGS.items():
        if voice_input in name or name in voice_input:
            return voice_id

    # Fallback to default
    print(f"⚠️  Unknown voice '{voice_input}', using default")
    return VOICE_MAPPINGS["default"]

# Configuration - can be overridden by config.py or environment variables
try:
    from config import ELEVENLABS_API_KEY, VOICE_ID, SERVER_URL, ELEVENLABS_MODEL
except ImportError:
    ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')
    # Use the mapping function for voice selection
    raw_voice = os.environ.get('CLAUDE_VOICE_ID', 'claude')
    VOICE_ID = get_voice_id(raw_voice)
    SERVER_URL = os.environ.get('TTS_SERVER_URL', '')  # Empty = direct API mode
    ELEVENLABS_MODEL = os.environ.get('ELEVENLABS_MODEL', 'eleven_flash_v2_5')  # Fast model

# TTS Settings
DEFAULT_TIMEOUT = 10.0
RETRY_ATTEMPTS = 2
RETRY_DELAY = 0.5

# Deduplication tracking
recent_messages: Dict[str, float] = {}
MESSAGE_DEDUP_WINDOW = 2.0  # seconds
DEDUP_CACHE_FILE = "/tmp/claude_tts_dedup_cache.json"


def load_dedup_cache() -> Dict[str, float]:
    """Load deduplication cache from file"""
    try:
        if os.path.exists(DEDUP_CACHE_FILE):
            with open(DEDUP_CACHE_FILE, 'r') as f:
                cache = json.load(f)
                # Clean old entries
                current_time = time.time()
                return {k: v for k, v in cache.items()
                       if current_time - v < MESSAGE_DEDUP_WINDOW * 2}
    except Exception:
        pass
    return {}


def save_dedup_cache(cache: Dict[str, float]) -> None:
    """Save deduplication cache to file"""
    try:
        with open(DEDUP_CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception:
        pass


def clean_text_for_speech(text: str) -> str:
    """Clean text for better TTS pronunciation"""
    # Replace common phrases that sound robotic
    text = text.replace("You're absolutely right", "You're right")
    text = text.replace("I've", "I have")
    text = text.replace("you've", "you have")
    text = text.replace("we've", "we have")
    text = text.replace("they've", "they have")

    # Replace underscores with spaces
    text = text.replace('_', ' ')

    # Handle dots between text (e.g., "file.txt" -> "file dot txt")
    text = re.sub(r'(\w)\.(\w)', r'\1 dot \2', text)

    # Remove problematic symbols while keeping natural punctuation
    symbols_to_remove = r'[\\|}{[\]/%*#@$^&+=<>~`"()]'
    text = re.sub(symbols_to_remove, ' ', text)

    # Handle hyphens intelligently
    text = re.sub(r'\s+-\s+', ' ', text)
    text = re.sub(r'^-\s+', '', text)
    text = re.sub(r'\s+-$', '', text)

    # Clean up multiple spaces
    text = re.sub(r'\s+', ' ', text)

    return text.strip()


def send_tts_request(text: str, voice_id: str = None, timeout: float = DEFAULT_TIMEOUT) -> Tuple[bool, str]:
    """
    Send TTS request with proper error handling
    Supports both server mode (if configured) and direct API mode
    Returns (success, error_message)
    """
    # Use provided voice_id or default
    voice_id = voice_id or VOICE_ID

    if not ELEVENLABS_API_KEY:
        return False, "ElevenLabs API key not configured"

    try:
        if SERVER_URL:
            # Server mode - use local TTS server
            response = requests.post(
                SERVER_URL,
                headers={"Content-Type": "application/json"},
                json={
                    "text": text,
                    "voice": voice_id
                },
                timeout=timeout
            )

            if response.status_code == 200:
                return True, ""
            else:
                return False, f"Server returned {response.status_code}"

        else:
            # Direct API mode - call ElevenLabs directly
            response = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "text": text,
                    "model_id": ELEVENLABS_MODEL,  # Use configured model
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75
                    }
                },
                stream=True,
                timeout=timeout
            )

            if response.status_code == 200:
                # Save and play audio
                with tempfile.NamedTemporaryFile(suffix='.mp3', delete=True) as f:
                    for chunk in response.iter_content(chunk_size=1024):
                        if chunk:
                            f.write(chunk)
                    f.flush()

                    # Platform-specific audio playback
                    if sys.platform == "darwin":
                        # macOS
                        subprocess.run(["afplay", f.name], check=True, capture_output=True)
                    elif sys.platform.startswith("linux"):
                        # Linux/Raspberry Pi - try multiple players in order
                        for player in ["mpg123", "mpg321", "play", "aplay"]:
                            try:
                                subprocess.run([player, f.name], check=True, capture_output=True)
                                break
                            except (subprocess.CalledProcessError, FileNotFoundError):
                                continue
                        else:
                            return False, "No audio player found (install mpg123 or sox)"
                    elif sys.platform == "win32":
                        # Windows
                        import winsound
                        winsound.PlaySound(f.name, winsound.SND_FILENAME)
                    else:
                        return False, f"Unsupported platform: {sys.platform}"

                return True, ""
            else:
                return False, f"ElevenLabs API returned {response.status_code}"

    except requests.exceptions.Timeout:
        return False, f"Timeout after {timeout}s"
    except requests.exceptions.ConnectionError:
        if SERVER_URL:
            return False, "Connection failed - TTS server may be down"
        else:
            return False, "Connection failed - check internet connectivity"
    except subprocess.CalledProcessError as e:
        return False, f"Audio playback failed: {e}"
    except Exception as e:
        return False, str(e)


def speak_with_retry(text: str, mode: str = "conversation",
                    voice: str = None,
                    timeout: float = DEFAULT_TIMEOUT,
                    retries: int = RETRY_ATTEMPTS,
                    bypass_dedup: bool = False) -> bool:
    """
    Speak text with automatic retry on failure

    Args:
        text: Text to speak
        mode: Either 'conversation' or 'working'
        voice: Voice name or ID (optional, uses default if not provided)
        timeout: Timeout for each attempt
        retries: Number of retry attempts
        bypass_dedup: If True, skip deduplication check

    Returns:
        True if successful, False otherwise
    """
    global recent_messages

    cleaned_text = clean_text_for_speech(text)

    # Get voice ID from name/mapping
    voice_id = get_voice_id(voice) if voice else VOICE_ID

    # Deduplication check (unless bypassed)
    if not bypass_dedup:
        current_time = time.time()
        text_hash = hashlib.md5(cleaned_text.encode()).hexdigest()

        recent_messages = load_dedup_cache()
        recent_messages = {k: v for k, v in recent_messages.items()
                          if current_time - v < MESSAGE_DEDUP_WINDOW}

        if text_hash in recent_messages:
            time_since = current_time - recent_messages[text_hash]
            print(f"🔁 Duplicate TTS detected (sent {time_since:.1f}s ago), skipping")
            save_dedup_cache(recent_messages)
            return True

        recent_messages[text_hash] = current_time
        save_dedup_cache(recent_messages)

    for attempt in range(retries + 1):
        current_timeout = timeout * (1 + attempt * 0.5)

        success, error = send_tts_request(cleaned_text, voice_id, current_timeout)

        if success:
            print(f"🔊 TTS ({mode}): {cleaned_text}")
            if not bypass_dedup:
                recent_messages[text_hash] = time.time()
                save_dedup_cache(recent_messages)
            return True

        if attempt < retries:
            if "Timeout" in error:
                print(f"⏱️  TTS timeout (attempt {attempt + 1}/{retries + 1}), retrying...")
            else:
                print(f"⚠️  TTS error (attempt {attempt + 1}/{retries + 1}): {error}, retrying...")
            time.sleep(RETRY_DELAY)
        else:
            if "Timeout" in error:
                print(f"⏱️  TTS timeout after {retries + 1} attempts")
            elif "Connection" in error:
                print(f"🔌 TTS server appears to be down")
            else:
                print(f"❌ TTS failed: {error}")

    return False


def speak_conversation(text: str, **kwargs) -> bool:
    """Send TTS that returns to idle state - for questions/confirmations"""
    return speak_with_retry(text, mode="conversation", **kwargs)


def speak_working(text: str, **kwargs) -> bool:
    """Send TTS that maintains execution state - for status updates"""
    return speak_with_retry(text, mode="working", **kwargs)


def main():
    """Command line interface"""
    import argparse

    parser = argparse.ArgumentParser(
        description='Claude-to-Speech TTS interface',
        epilog='Example: python claude_speak.py --conversation "Task complete!" --voice laura'
    )
    parser.add_argument('text', nargs='*', help='Text to speak')
    parser.add_argument('--working', action='store_true',
                       help='Use working mode (maintains execution state)')
    parser.add_argument('--conversation', action='store_true',
                       help='Use conversation mode (returns to idle state)')
    parser.add_argument('--voice', type=str, default=None,
                       help='Voice name (laura, claude, rachel, etc.) or voice ID')
    parser.add_argument('--list-voices', action='store_true',
                       help='List available voice names')
    parser.add_argument('--timeout', type=float, default=DEFAULT_TIMEOUT,
                       help=f'Timeout in seconds (default: {DEFAULT_TIMEOUT})')
    parser.add_argument('--retries', type=int, default=RETRY_ATTEMPTS,
                       help=f'Number of retry attempts (default: {RETRY_ATTEMPTS})')
    parser.add_argument('--no-retry', action='store_true',
                       help='Disable retry logic')
    parser.add_argument('--bypass-dedup', action='store_true',
                       help='Bypass deduplication check (allow immediate repeats)')

    args = parser.parse_args()

    # Handle list voices request
    if args.list_voices:
        print("Available voices:")
        print("-" * 40)
        seen_ids = set()
        for name, voice_id in sorted(VOICE_MAPPINGS.items()):
            if voice_id not in seen_ids:
                print(f"  {name:12} → {voice_id[:20]}...")
                seen_ids.add(voice_id)
        print("-" * 40)
        print("You can use any name above or provide a raw voice ID")
        return

    if not args.text:
        print("Usage: python claude_speak.py 'text to speak'")
        print("       python claude_speak.py --conversation 'text for idle state'")
        print("       python claude_speak.py --working 'text for execution state'")
        print("       python claude_speak.py --voice laura 'text with Laura voice'")
        print("       python claude_speak.py --list-voices")
        print("\nOptions:")
        print("  --voice NAME    Use specific voice (laura, claude, etc.)")
        print("  --timeout N     Set timeout to N seconds")
        print("  --retries N     Set retry attempts to N")
        print("  --no-retry      Disable retry logic")
        print("  --bypass-dedup  Allow immediate repeated messages")
        print("  --list-voices   Show available voice names")
        return

    text = " ".join(args.text)
    retries = 0 if args.no_retry else args.retries

    if args.working:
        speak_working(text, voice=args.voice, timeout=args.timeout,
                     retries=retries, bypass_dedup=args.bypass_dedup)
    elif args.conversation:
        speak_conversation(text, voice=args.voice, timeout=args.timeout,
                          retries=retries, bypass_dedup=args.bypass_dedup)
    else:
        # Default to conversation mode
        speak_conversation(text, voice=args.voice, timeout=args.timeout,
                          retries=retries, bypass_dedup=args.bypass_dedup)


if __name__ == "__main__":
    main()