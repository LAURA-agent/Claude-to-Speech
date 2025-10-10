#!/usr/bin/env python3
"""
Claude-to-Speech TTS Server
A lightweight HTTP server for text-to-speech using ElevenLabs API.
"""

import os
import sys
import time
import hashlib
import logging
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from elevenlabs import ElevenLabs, play
from elevenlabs.client import ElevenLabs as ElevenLabsClient

# Configuration from environment or config.py
try:
    from dotenv import load_dotenv
    plugin_root = Path(__file__).parent.parent
    env_file = plugin_root / '.env'
    if env_file.exists():
        load_dotenv(env_file)
except ImportError:
    pass

try:
    from config import ELEVENLABS_API_KEY, VOICE_ID
except ImportError:
    ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')
    VOICE_ID = os.environ.get('CLAUDE_VOICE_ID', 'uY96J30mUhYUIymmD5cu')

# Server configuration
PORT = int(os.environ.get('TTS_SERVER_PORT', '5000'))
HOST = os.environ.get('TTS_SERVER_HOST', '0.0.0.0')
CACHE_DIR = Path(os.environ.get('TTS_CACHE_DIR', './audio_cache'))

# Ensure cache directory exists
CACHE_DIR.mkdir(exist_ok=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Initialize ElevenLabs client
elevenlabs_client = None
if ELEVENLABS_API_KEY:
    try:
        elevenlabs_client = ElevenLabsClient(api_key=ELEVENLABS_API_KEY)
        logger.info("ElevenLabs client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize ElevenLabs client: {e}")
else:
    logger.warning("ElevenLabs API key not configured")

# Deduplication tracking
recent_messages = {}
MESSAGE_DEDUP_WINDOW = 2.0  # seconds


def clean_cache():
    """Clean old audio files from cache"""
    try:
        current_time = time.time()
        for audio_file in CACHE_DIR.glob("*.mp3"):
            file_age = current_time - audio_file.stat().st_mtime
            if file_age > 3600:  # Delete files older than 1 hour
                audio_file.unlink()
    except Exception as e:
        logger.warning(f"Error cleaning cache: {e}")


@app.route('/')
def home():
    return jsonify({
        "service": "Claude-to-Speech TTS Server",
        "status": "running",
        "endpoints": {
            "/tts": "POST - Convert text to speech",
            "/health": "GET - Server health check"
        }
    })


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "server": "Claude-to-Speech TTS Server",
        "version": "1.0.0",
        "elevenlabs_configured": elevenlabs_client is not None,
        "timestamp": time.time()
    })


@app.route('/tts', methods=['POST'])
def text_to_speech():
    """Convert text to speech using ElevenLabs"""
    global recent_messages

    if not elevenlabs_client:
        logger.error("ElevenLabs client not initialized")
        return jsonify({"success": False, "error": "TTS service not configured"}), 500

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        text = data.get('text', '')
        voice_id = data.get('voice', VOICE_ID)

        if not text.strip():
            return jsonify({"error": "No text provided"}), 400

        # Deduplication check
        current_time = time.time()
        text_hash = hashlib.md5(text.strip().encode()).hexdigest()

        # Clean old entries
        recent_messages = {k: v for k, v in recent_messages.items()
                          if current_time - v < MESSAGE_DEDUP_WINDOW}

        # Check for duplicate
        if text_hash in recent_messages:
            time_since = current_time - recent_messages[text_hash]
            logger.info(f"🔁 Duplicate TTS request (sent {time_since:.1f}s ago), skipping")
            return jsonify({"success": True, "message": "Duplicate message ignored"}), 200

        # Record this message
        recent_messages[text_hash] = current_time

        logger.info(f"🔊 Processing TTS: {len(text)} chars")

        # Generate audio using ElevenLabs
        audio = elevenlabs_client.generate(
            text=text,
            voice=voice_id,
            model="eleven_flash_v2_5"
        )

        # Save to cache
        audio_file = CACHE_DIR / f"tts_{int(time.time() * 1000)}_{text_hash[:8]}.mp3"

        # Write audio bytes to file
        with open(audio_file, 'wb') as f:
            for chunk in audio:
                f.write(chunk)

        # Play the audio
        play(audio)

        logger.info(f"✅ TTS completed: {audio_file.name}")

        return jsonify({
            "success": True,
            "processed": True,
            "audio_file": str(audio_file),
            "text_length": len(text)
        })

    except Exception as e:
        logger.error(f"❌ TTS error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.before_request
def before_request():
    """Clean cache periodically"""
    if request.endpoint == 'text_to_speech':
        clean_cache()


if __name__ == '__main__':
    logger.info(f"Starting Claude-to-Speech TTS Server on http://{HOST}:{PORT}")
    logger.info(f"Audio cache directory: {CACHE_DIR.absolute()}")
    logger.info(f"Voice ID: {VOICE_ID}")

    if not ELEVENLABS_API_KEY:
        logger.warning("⚠️  ElevenLabs API key not configured!")
        logger.warning("    Set ELEVENLABS_API_KEY environment variable or add to .env file")

    app.run(host=HOST, port=PORT, debug=False)
